#!/usr/bin/env python3
"""
train_cnn_deep.py — Deep ResNet-style CNN on per-subcarrier-band spectrograms.

What's different from train_cnn.py:

    1. Richer input: instead of subcarrier-mean amplitude per RX (one channel
       per RX), split each RX's 192 subcarriers into N_BANDS bands, take the
       band-mean amplitude per band, and compute a spectrogram per band.
       Input becomes (n_rx * n_bands, F, T) — preserves spatial-frequency
       diversity that mean-aggregation throws away.

       Default n_bands=8 → 4 RXs × 8 bands = 32 input channels per window.
       Plus optional log-amplitude raw subcarrier deltas as extra channels.

    2. Deeper model: ResNet-style with skip connections (~1.5M params).
       Three down-sampling stages, two residual blocks each. Skip connections
       let us actually train deep without vanishing gradients on this data
       size.

    3. Longer windows (default 6s, 1s hop) so the spectrogram time axis has
       enough resolution to be interesting after pooling.

    4. Optional augmentation: SpecAugment-style frequency/time masking
       during training. Helps with overfitting on small data.

Caching:
    Per-session  .deep_spec_cache_<labels>_w<win>_h<hop>_n<nperseg>_o<noverlap>_b<bands>.npz

Usage:
    python train_cnn_deep.py --labels labels_v2.json --source ours
    python train_cnn_deep.py --labels labels_v2.json --source all --device cuda
    python train_cnn_deep.py --labels labels_v2.json --source ours \\
        --win-sec 6.0 --hop-sec 1.0 --nperseg 96 --noverlap 80 \\
        --n-bands 8 --epochs 300 --patience 25 --batch-size 32 --lr 5e-4 \\
        --dropout 0.4 --augment

Hardware:
    --device auto picks CUDA → MPS → CPU.
    On MPS / Mac M-series: ~2-5 min/epoch (this model is bigger).
    On Colab T4: ~30 sec/epoch.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
    from torch.utils.data import Dataset, DataLoader
except ImportError:
    raise SystemExit("PyTorch required:  pip install torch")

try:
    from scipy.signal import stft
except ImportError:
    raise SystemExit("scipy required:  pip install scipy")


# ─────────────────────────────────────────────────────────
# Per-band spectrogram extraction
# ─────────────────────────────────────────────────────────

def extract_band_spectrograms_for_session(
    csi_path: Path, labels_path: Path,
    win_sec: float = 6.0, hop_sec: float = 1.0,
    nperseg: int = 96, noverlap: int = 80,
    n_bands: int = 8,
):
    """
    Returns (X, y, classes, rx_names) where:
        X: (N_windows, n_rx*n_bands, F, T) float32
        y: (N_windows,) int64

    Pipeline per (window, RX, band):
        amplitudes (T_pkts, 192) → split 192 subs into n_bands bands
        per band → mean across band's subs → 1D time series
        STFT → magnitude → (F, T)
        log1p + per-(window,channel) z-score
    """
    csi = np.load(csi_path)
    with open(labels_path) as f:
        L = json.load(f)
    rx_names = [str(n) for n in csi["rx_names"]]
    if len(rx_names) < 1:
        return None
    class_to_idx = {v: int(k) for k, v in L["classes"].items()}
    classes = [L["classes"][str(i)] for i in sorted(class_to_idx.values())]

    anchor = rx_names[0]
    t_anchor = csi[f"timestamps_{anchor}"]
    if len(t_anchor) < 100:
        return None
    t_start, t_end = float(t_anchor[0]), float(t_anchor[-1])

    windows: list[tuple[float, float]] = []
    t = t_start
    while t + win_sec <= t_end:
        windows.append((t, t + win_sec))
        t += hop_sec
    n_win = len(windows)
    if n_win < 1:
        return None

    # Band partitions: 192 subs / n_bands. Pad if not divisible.
    rx_data: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    fs_per_rx: dict[str, float] = {}
    for name in rx_names:
        ts = csi[f"timestamps_{name}"]
        amps = csi[f"amplitudes_{name}"].astype(np.float32)
        if len(ts) < 5 or amps.ndim != 2:
            return None
        rx_data[name] = (ts, amps)
        fs_per_rx[name] = len(ts) / max(ts[-1] - ts[0], 1e-9)

    n_subs = next(iter(rx_data.values()))[1].shape[1]
    band_edges = np.linspace(0, n_subs, n_bands + 1, dtype=int)

    # Canonical (F, T) from configured params, NOT from data — same trick
    # as train_cnn.py to keep cross-session shapes consistent.
    NOMINAL_RATE_HZ = 70.0
    F_dim = nperseg // 2 + 1
    N_target = int(win_sec * NOMINAL_RATE_HZ)
    T_dim = max(1, (N_target - noverlap) // (nperseg - noverlap))
    if F_dim < 4 or T_dim < 4:
        return None

    n_rx = len(rx_names)
    n_channels = n_rx * n_bands
    X = np.zeros((n_win, n_channels, F_dim, T_dim), dtype=np.float32)

    for w_idx, (t_lo, t_hi) in enumerate(windows):
        ch = 0
        for r_idx, name in enumerate(rx_names):
            ts, amps = rx_data[name]
            mask = (ts >= t_lo) & (ts < t_hi)
            amps_win = amps[mask]
            if amps_win.shape[0] < nperseg:
                ch += n_bands
                continue
            for b in range(n_bands):
                band_lo, band_hi = band_edges[b], band_edges[b + 1]
                band_amps = amps_win[:, band_lo:band_hi]
                if band_amps.size == 0:
                    ch += 1
                    continue
                band_series = band_amps.mean(axis=1).astype(np.float32)
                if len(band_series) < nperseg:
                    ch += 1
                    continue
                try:
                    _, _, Zxx = stft(
                        band_series, fs=fs_per_rx[name],
                        nperseg=nperseg, noverlap=noverlap,
                        boundary=None, padded=False,
                    )
                    spec = np.abs(Zxx).astype(np.float32)
                    ff = min(F_dim, spec.shape[0])
                    tt = min(T_dim, spec.shape[1])
                    X[w_idx, ch, :ff, :tt] = spec[:ff, :tt]
                except Exception:
                    pass
                ch += 1

    # log1p + per-(window, channel) z-score
    X = np.log1p(X)
    means = X.mean(axis=(2, 3), keepdims=True)
    stds = X.std(axis=(2, 3), keepdims=True) + 1e-6
    X = ((X - means) / stds).astype(np.float32)

    # Per-window labels (window center → segment lookup)
    y = np.full(n_win, -1, dtype=np.int64)
    segs = L["segments"]
    for w_idx, (t_lo, t_hi) in enumerate(windows):
        t_center = (t_lo + t_hi) / 2
        for s in segs:
            if s["t_start"] <= t_center < s["t_end"]:
                y[w_idx] = class_to_idx[s["class"]]
                break
    keep = y >= 0
    return X[keep], y[keep], classes, rx_names


# ─────────────────────────────────────────────────────────
# Cache
# ─────────────────────────────────────────────────────────

def cache_path_for(session_dir: Path, labels_filename: str,
                   win_sec: float, hop_sec: float,
                   nperseg: int, noverlap: int, n_bands: int) -> Path:
    stem = Path(labels_filename).stem
    return (session_dir
            / f".deep_spec_cache_{stem}_w{win_sec}_h{hop_sec}"
              f"_n{nperseg}_o{noverlap}_b{n_bands}.npz")


def is_cache_valid(cache_path: Path, csi_path: Path, labels_path: Path) -> bool:
    if not cache_path.exists():
        return False
    cache_mtime = cache_path.stat().st_mtime
    return (csi_path.stat().st_mtime <= cache_mtime
            and labels_path.stat().st_mtime <= cache_mtime)


def load_cache(cache_path: Path):
    d = np.load(cache_path, allow_pickle=False)
    return (d["X"].astype(np.float32),
            d["y"].astype(np.int64),
            [str(c) for c in d["classes"]],
            [str(n) for n in d["rx_names"]])


def save_cache(cache_path: Path, X, y, classes, rx_names):
    np.savez_compressed(
        cache_path,
        X=X.astype(np.float32),
        y=y.astype(np.int64),
        classes=np.array(classes, dtype="U24"),
        rx_names=np.array(rx_names, dtype="U16"),
    )


# Worker for parallel feature extraction
def _extract_one(job):
    csi_path = Path(job["csi_path"])
    labels_path = Path(job["labels_path"])
    cache_path = Path(job["cache_path"])

    if (job["use_cache"] and not job["rebuild_cache"]
            and is_cache_valid(cache_path, csi_path, labels_path)):
        try:
            X, y, classes, rx_names = load_cache(cache_path)
            return {"status": "cached", "session_name": job["session_name"],
                    "X": X, "y": y, "classes": classes, "rx_names": rx_names}
        except Exception:
            pass

    out = extract_band_spectrograms_for_session(
        csi_path, labels_path,
        win_sec=job["win_sec"], hop_sec=job["hop_sec"],
        nperseg=job["nperseg"], noverlap=job["noverlap"],
        n_bands=job["n_bands"],
    )
    if out is None:
        return {"status": "skipped", "session_name": job["session_name"]}
    X, y, classes, rx_names = out
    if job["use_cache"]:
        try:
            save_cache(cache_path, X, y, classes, rx_names)
        except Exception:
            pass
    return {"status": "extracted", "session_name": job["session_name"],
            "X": X, "y": y, "classes": classes, "rx_names": rx_names}


# ─────────────────────────────────────────────────────────
# SpecAugment
# ─────────────────────────────────────────────────────────

class SpecAugment:
    """Frequency and time masking applied to a (C, F, T) tensor.
    Standard regularization technique from speech recognition; cheap and
    effective for CNN training on limited data."""

    def __init__(self, freq_mask_pct: float = 0.15, time_mask_pct: float = 0.15,
                 n_freq_masks: int = 2, n_time_masks: int = 2):
        self.fpct = freq_mask_pct
        self.tpct = time_mask_pct
        self.nf = n_freq_masks
        self.nt = n_time_masks

    def __call__(self, x: torch.Tensor) -> torch.Tensor:
        # x: (C, F, T)
        if not self.training:
            return x
        C, F_, T_ = x.shape
        x = x.clone()
        for _ in range(self.nf):
            mw = max(1, int(F_ * self.fpct * random.random()))
            f0 = random.randint(0, max(0, F_ - mw))
            x[:, f0:f0 + mw, :] = 0
        for _ in range(self.nt):
            mw = max(1, int(T_ * self.tpct * random.random()))
            t0 = random.randint(0, max(0, T_ - mw))
            x[:, :, t0:t0 + mw] = 0
        return x

    @property
    def training(self):
        return getattr(self, "_training", True)

    def train(self, mode: bool = True):
        self._training = mode
        return self

    def eval(self):
        return self.train(False)


# ─────────────────────────────────────────────────────────
# Dataset
# ─────────────────────────────────────────────────────────

class SpecDataset(Dataset):
    def __init__(self, X: np.ndarray, y: np.ndarray, augment: SpecAugment | None = None):
        self.X = torch.from_numpy(X)
        self.y = torch.from_numpy(y)
        self.augment = augment

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        x = self.X[idx]
        if self.augment is not None and self.augment.training:
            x = self.augment(x)
        return x, self.y[idx]


# ─────────────────────────────────────────────────────────
# Deep CNN with residual blocks
# ─────────────────────────────────────────────────────────

def _make_activation(name: str):
    """Activation module factory. Supports 'relu' and 'leaky_relu'."""
    if name == "leaky_relu":
        return nn.LeakyReLU(negative_slope=0.1, inplace=True)
    return nn.ReLU(inplace=True)


class ResBlock(nn.Module):
    """Two-conv residual block with optional downsample."""
    def __init__(self, in_ch, out_ch, stride=1, dropout=0.0, activation="relu"):
        super().__init__()
        self.conv1 = nn.Conv2d(in_ch, out_ch, kernel_size=3, padding=1,
                               stride=stride, bias=False)
        self.bn1 = nn.BatchNorm2d(out_ch)
        self.conv2 = nn.Conv2d(out_ch, out_ch, kernel_size=3, padding=1,
                               bias=False)
        self.bn2 = nn.BatchNorm2d(out_ch)
        self.act1 = _make_activation(activation)
        self.act2 = _make_activation(activation)
        self.drop = nn.Dropout2d(dropout) if dropout > 0 else nn.Identity()
        if stride != 1 or in_ch != out_ch:
            self.shortcut = nn.Sequential(
                nn.Conv2d(in_ch, out_ch, kernel_size=1, stride=stride, bias=False),
                nn.BatchNorm2d(out_ch),
            )
        else:
            self.shortcut = nn.Identity()

    def forward(self, x):
        identity = self.shortcut(x)
        out = self.act1(self.bn1(self.conv1(x)))
        out = self.drop(out)
        out = self.bn2(self.conv2(out))
        out = out + identity
        return self.act2(out)


class CSI_DeepCNN(nn.Module):
    """
    ResNet-style CNN for spectrogram classification.

    Stages:
        Stem        : Conv(in→base, 3x3) + BN + ReLU
        Stage 1     : 2x ResBlock(base, base)
        Stage 2     : 1x ResBlock(base, 2*base, stride=2) + 1x ResBlock(2*base, 2*base)
        Stage 3     : 1x ResBlock(2*base, 4*base, stride=2) + 1x ResBlock(4*base, 4*base)
        Stage 4     : 1x ResBlock(4*base, 4*base) [extra depth]
        Pool        : AdaptiveAvgPool2d(1)
        Head        : Linear(4*base → dense) + ReLU + Dropout
                      + Linear(dense → dense//2) + ReLU + Dropout
                      + Linear(dense//2 → n_classes)
    """
    def __init__(self, n_classes: int, n_in_channels: int = 32,
                 base: int = 32, dense: int = 128, dropout: float = 0.4,
                 conv_dropout: float = 0.1, activation: str = "relu"):
        super().__init__()
        self.stem = nn.Sequential(
            nn.Conv2d(n_in_channels, base, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm2d(base),
            _make_activation(activation),
        )
        self.stage1 = nn.Sequential(
            ResBlock(base, base, dropout=conv_dropout, activation=activation),
            ResBlock(base, base, dropout=conv_dropout, activation=activation),
        )
        self.stage2 = nn.Sequential(
            ResBlock(base, base * 2, stride=2, dropout=conv_dropout, activation=activation),
            ResBlock(base * 2, base * 2, dropout=conv_dropout, activation=activation),
        )
        self.stage3 = nn.Sequential(
            ResBlock(base * 2, base * 4, stride=2, dropout=conv_dropout, activation=activation),
            ResBlock(base * 4, base * 4, dropout=conv_dropout, activation=activation),
        )
        self.stage4 = ResBlock(base * 4, base * 4, dropout=conv_dropout, activation=activation)
        self.global_pool = nn.AdaptiveAvgPool2d(1)
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(base * 4, dense),
            _make_activation(activation),
            nn.Dropout(dropout),
            nn.Linear(dense, dense // 2),
            _make_activation(activation),
            nn.Dropout(dropout),
            nn.Linear(dense // 2, n_classes),
        )

    def forward(self, x):  # (B, C, F, T)
        x = self.stem(x)
        x = self.stage1(x)
        x = self.stage2(x)
        x = self.stage3(x)
        x = self.stage4(x)
        x = self.global_pool(x)
        return self.head(x)


# ─────────────────────────────────────────────────────────
# Metrics
# ─────────────────────────────────────────────────────────

def per_class_metrics(y_true, y_pred, n_classes):
    p = np.zeros(n_classes); r = np.zeros(n_classes); f = np.zeros(n_classes)
    for c in range(n_classes):
        tp = int(((y_pred == c) & (y_true == c)).sum())
        fp = int(((y_pred == c) & (y_true != c)).sum())
        fn = int(((y_pred != c) & (y_true == c)).sum())
        p[c] = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        r[c] = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f[c] = 2 * p[c] * r[c] / (p[c] + r[c]) if (p[c] + r[c]) > 0 else 0.0
    return p, r, f


def confusion(y_true, y_pred, n_classes):
    cm = np.zeros((n_classes, n_classes), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1
    return cm


# ─────────────────────────────────────────────────────────
# Train / eval loop
# ─────────────────────────────────────────────────────────

def fit(model, train_loader, val_loader, n_classes, class_weights,
        epochs, lr, device, ckpt_path,
        patience=20, lr_patience=8, lr_factor=0.5, min_lr=1e-6,
        weight_decay=1e-4, augment=None):
    crit = nn.CrossEntropyLoss(weight=class_weights.to(device))
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        opt, mode="min", factor=lr_factor, patience=lr_patience, min_lr=min_lr,
    )
    best_macro_f1 = -1.0
    epochs_since_best = 0

    for epoch in range(1, epochs + 1):
        model.train()
        if augment is not None:
            augment.train()
        train_loss = 0.0; n_train = 0
        for X, y in train_loader:
            X, y = X.to(device), y.to(device)
            opt.zero_grad()
            logits = model(X)
            loss = crit(logits, y)
            loss.backward()
            opt.step()
            train_loss += loss.item() * X.size(0)
            n_train += X.size(0)
        train_loss /= max(n_train, 1)

        model.eval()
        if augment is not None:
            augment.eval()
        all_p = []; all_t = []; val_loss = 0.0; n_val = 0
        with torch.no_grad():
            for X, y in val_loader:
                X, y = X.to(device), y.to(device)
                logits = model(X)
                loss = crit(logits, y)
                val_loss += loss.item() * X.size(0)
                n_val += X.size(0)
                all_p.append(logits.argmax(dim=1).cpu().numpy())
                all_t.append(y.cpu().numpy())
        val_loss /= max(n_val, 1)

        if all_p:
            yp = np.concatenate(all_p); yt = np.concatenate(all_t)
            _, _, f1 = per_class_metrics(yt, yp, n_classes)
            macro_f1 = float(np.mean(f1))
            acc = float((yp == yt).mean())
        else:
            macro_f1 = 0.0; acc = 0.0

        scheduler.step(val_loss)
        current_lr = opt.param_groups[0]["lr"]

        marker = ""
        if macro_f1 > best_macro_f1:
            best_macro_f1 = macro_f1
            ckpt_path.parent.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), ckpt_path)
            marker = "  ✓ saved (best)"
            epochs_since_best = 0
        else:
            epochs_since_best += 1

        print(f"  epoch {epoch:>3}  lr={current_lr:.1e}  "
              f"train_loss={train_loss:.4f}  val_loss={val_loss:.4f}  "
              f"val_acc={acc:.3f}  val_macro_f1={macro_f1:.3f}{marker}")

        if epochs_since_best >= patience:
            print(f"  ⏹ early stop: no val_macro_f1 improvement for "
                  f"{patience} epochs (best={best_macro_f1:.3f})")
            break

    return best_macro_f1


# ─────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # Data
    parser.add_argument("--dataset", type=Path, default=Path("dataset"))
    parser.add_argument("--labels", type=str, default="labels_v2.json")
    parser.add_argument("--source", type=str, default="all",
                        choices=["all", "ours", "csi_har"])

    # Spectrogram windowing
    parser.add_argument("--win-sec", type=float, default=6.0,
                        help="Window length in seconds (default 6.0).")
    parser.add_argument("--hop-sec", type=float, default=1.0)
    parser.add_argument("--nperseg", type=int, default=96,
                        help="STFT segment length (default 96 → F=49 freq bins).")
    parser.add_argument("--noverlap", type=int, default=80)
    parser.add_argument("--n-bands", type=int, default=8,
                        help="Subcarrier bands per RX (default 8). "
                             "Total input channels = n_rx * n_bands.")

    # Model
    parser.add_argument("--base", type=int, default=32,
                        help="Base conv channels (default 32 → "
                             "stages [32,64,128,128]).")
    parser.add_argument("--dense", type=int, default=128,
                        help="Dense head width (default 128 → 64 → out).")
    parser.add_argument("--dropout", type=float, default=0.4,
                        help="Dropout in dense head (default 0.4).")
    parser.add_argument("--conv-dropout", type=float, default=0.1,
                        help="Dropout2d between residual conv layers "
                             "(default 0.1).")
    parser.add_argument("--activation", type=str, default="relu",
                        choices=["relu", "leaky_relu"],
                        help="Activation function in conv blocks + dense head.")

    # Training
    parser.add_argument("--epochs", type=int, default=300,
                        help="Max epochs (early stop almost always trips first).")
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=5e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--augment", action="store_true",
                        help="Enable SpecAugment (freq + time masking).")

    # Schedule / early stop
    parser.add_argument("--patience", type=int, default=25)
    parser.add_argument("--lr-patience", type=int, default=8)
    parser.add_argument("--lr-factor", type=float, default=0.5)
    parser.add_argument("--min-lr", type=float, default=1e-6)

    # Splits / IO
    parser.add_argument("--val-frac", type=float, default=0.2)
    parser.add_argument("--test-frac", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--ckpt", type=Path, default=Path("checkpoints/cnn_deep_best.pt"))
    parser.add_argument("--force-test-session", type=str, default=None,
                        help="Force a specific session name to be the test set "
                             "(e.g. 'subj01_v2_session04'). Used by loocv_eval.py.")
    parser.add_argument("--results-json", type=Path, default=None,
                        help="If set, write a JSON file with the COMBINED test "
                             "metrics. Used by loocv_eval.py.")

    # Cache + parallel + device
    parser.add_argument("--no-cache", action="store_true")
    parser.add_argument("--rebuild-cache", action="store_true")
    parser.add_argument("--workers", type=int, default=0)
    parser.add_argument("--device", type=str, default="auto",
                        choices=["auto", "cpu", "cuda", "mps"])
    args = parser.parse_args()

    np.random.seed(args.seed); torch.manual_seed(args.seed); random.seed(args.seed)

    if args.device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = args.device
    print(f"Device: {device}")

    # ── Discover sessions ──
    def session_origin(d: Path) -> str:
        meta = d / "metadata.json"
        if meta.exists():
            try:
                with open(meta) as f:
                    return str(json.load(f).get("origin", "ours"))
            except Exception:
                pass
        return "ours"

    all_sessions = sorted(args.dataset.glob("*/"))
    all_sessions = [d for d in all_sessions
                    if (d / "csi.npz").exists() and (d / args.labels).exists()]
    sessions_with_origin = [(d, session_origin(d)) for d in all_sessions]
    if args.source == "ours":
        sessions_with_origin = [(d, o) for d, o in sessions_with_origin if o == "ours"]
    elif args.source == "csi_har":
        sessions_with_origin = [(d, o) for d, o in sessions_with_origin if o == "csi_har"]
    sessions = [d for d, _ in sessions_with_origin]
    if len(sessions) < 3:
        print(f"Need ≥3 sessions, found {len(sessions)}.", file=sys.stderr)
        return 1

    n_by_origin: dict[str, int] = {}
    for _, o in sessions_with_origin:
        n_by_origin[o] = n_by_origin.get(o, 0) + 1
    print(f"Found {len(sessions)} sessions  (filter={args.source})")
    for o, n in sorted(n_by_origin.items()):
        print(f"  origin={o}: {n}")
    print()

    # ── Extract band spectrograms ──
    workers = args.workers if args.workers > 0 else min(8, os.cpu_count() or 1)
    cache_mode = ("OFF" if args.no_cache
                  else "ON" + (" [rebuilding]" if args.rebuild_cache else ""))
    print(f"Computing band spectrograms (cache: {cache_mode}, workers: {workers})...")
    print(f"  win={args.win_sec}s  hop={args.hop_sec}s  "
          f"nperseg={args.nperseg}  noverlap={args.noverlap}  "
          f"n_bands={args.n_bands}")
    t0 = time.time()

    jobs = []
    for d in sessions:
        jobs.append({
            "session_name": d.name,
            "csi_path": str(d / "csi.npz"),
            "labels_path": str(d / args.labels),
            "cache_path": str(cache_path_for(d, args.labels, args.win_sec,
                                              args.hop_sec, args.nperseg,
                                              args.noverlap, args.n_bands)),
            "win_sec": args.win_sec, "hop_sec": args.hop_sec,
            "nperseg": args.nperseg, "noverlap": args.noverlap,
            "n_bands": args.n_bands,
            "use_cache": not args.no_cache,
            "rebuild_cache": args.rebuild_cache,
        })

    name_to_result: dict[str, dict] = {}
    name_to_origin: dict[str, str] = {d.name: session_origin(d) for d in sessions}

    if workers == 1:
        for i, job in enumerate(jobs):
            res = _extract_one(job)
            name_to_result[res["session_name"]] = res
            if (i < 3) or ((i + 1) % 50 == 0) or (i + 1 == len(jobs)):
                print(f"  [{i+1}/{len(jobs)}] {res['session_name']}  [{res['status']}]")
    else:
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_extract_one, j): j for j in jobs}
            done = 0
            for fut in as_completed(futures):
                done += 1
                res = fut.result()
                name_to_result[res["session_name"]] = res
                if (done <= 3) or (done % 50 == 0) or (done == len(jobs)):
                    print(f"  [{done}/{len(jobs)}] {res['session_name']}  "
                          f"[{res['status']}]")

    # Aggregate
    per_session: list[tuple[str, np.ndarray, np.ndarray, str]] = []
    classes_ref: list[str] | None = None
    spec_shape: tuple | None = None
    n_cached = 0; n_extracted = 0; n_skipped = 0
    for d in sessions:
        res = name_to_result.get(d.name)
        if res is None or res["status"] == "skipped":
            n_skipped += 1; continue
        if res["status"] == "cached":
            n_cached += 1
        else:
            n_extracted += 1
        X = res["X"]; y = res["y"]; classes = res["classes"]
        if classes_ref is None:
            classes_ref = classes
        elif classes != classes_ref:
            print(f"  {d.name}: WARNING — class set differs")
        if spec_shape is None and X.size:
            spec_shape = X.shape[1:]
        per_session.append((d.name, X, y, name_to_origin[d.name]))
    print(f"  ({time.time() - t0:.1f}s — {n_cached} cached, "
          f"{n_extracted} extracted, {n_skipped} skipped)\n")

    if not per_session or classes_ref is None or spec_shape is None:
        print("No usable sessions; aborting.", file=sys.stderr)
        return 1

    n_classes = len(classes_ref)
    n_in_channels, F_dim, T_dim = spec_shape
    print(f"  Spectrogram tensor per window: ({n_in_channels} ch, {F_dim} freq, {T_dim} time)")
    print(f"  classes ({n_classes}): {classes_ref}")
    print()

    # ── Origin-stratified split ──
    rng = np.random.default_rng(args.seed)
    by_origin: dict[str, list[int]] = {}
    for i, (_, _, _, origin) in enumerate(per_session):
        by_origin.setdefault(origin, []).append(i)
    train_idx: set[int] = set()
    val_idx:   set[int] = set()
    test_idx:  set[int] = set()

    # Optional LOOCV: force a named session into test, leave the rest for
    # train/val (using val_frac).
    forced_idx = None
    if args.force_test_session:
        for i, (name, _, _, _) in enumerate(per_session):
            if name == args.force_test_session:
                forced_idx = i
                break
        if forced_idx is None:
            available = [n for n, *_ in per_session]
            print(f"ERROR: --force-test-session '{args.force_test_session}' "
                  f"not found. Available sessions: {available}")
            return 2
        test_idx.add(forced_idx)
        print(f"  [LOOCV] Forced test session: "
              f"{args.force_test_session}  (origin={per_session[forced_idx][3]})")

    for origin, indices in by_origin.items():
        remaining = [i for i in indices if i not in test_idx]
        perm = rng.permutation(remaining)
        n = len(perm)
        if forced_idx is not None and origin == per_session[forced_idx][3]:
            n_val = max(1, int(round(args.val_frac * (n + 1)))) if n >= 2 else 0
            val_idx.update(perm[:n_val].tolist())
            train_idx.update(perm[n_val:].tolist())
        else:
            n_test = max(1, int(round(args.test_frac * n))) if n >= 3 else 1
            n_val  = max(1, int(round(args.val_frac  * n))) if n >= 3 else 0
            if args.force_test_session:
                n_test = 0
            test_idx.update(perm[:n_test].tolist())
            val_idx.update(perm[n_test:n_test + n_val].tolist())
            train_idx.update(perm[n_test + n_val:].tolist())

    def collect(idx_set):
        Xs = []; ys = []; names = []; origins = []; per_seq_origins = []
        for i in sorted(idx_set):
            name, X, y, origin = per_session[i]
            if X.size == 0: continue
            Xs.append(X); ys.append(y); names.append(name); origins.append(origin)
            per_seq_origins.append(np.full(len(y), origin, dtype=object))
        if not Xs:
            empty_X = np.empty((0, n_in_channels, F_dim, T_dim), dtype=np.float32)
            return (empty_X, np.empty((0,), dtype=np.int64),
                    np.empty((0,), dtype=object), names, origins)
        return (np.concatenate(Xs), np.concatenate(ys),
                np.concatenate(per_seq_origins), names, origins)

    Xtr, ytr, otr, tr_names, tr_origins = collect(train_idx)
    Xva, yva, ova, va_names, va_origins = collect(val_idx)
    Xte, yte, ote, te_names, te_origins = collect(test_idx)

    def _summarize(names, origins):
        if not names: return "(none)"
        groups: dict[str, list[str]] = {}
        for n, o in zip(names, origins):
            groups.setdefault(o, []).append(n)
        return "  ".join(f"{o}={len(v)}" for o, v in sorted(groups.items()))

    print(f"Split (session-disjoint, origin-stratified):")
    print(f"  train: {len(Xtr):>6} seq    {_summarize(tr_names, tr_origins)}")
    print(f"  val  : {len(Xva):>6} seq    {_summarize(va_names, va_origins)}")
    print(f"  test : {len(Xte):>6} seq    {_summarize(te_names, te_origins)}")
    print(f"    test sessions: {te_names}")
    print()

    if len(Xtr) == 0 or len(Xva) == 0 or len(Xte) == 0:
        print("Empty split.", file=sys.stderr); return 1

    # Class weights from train
    class_counts = np.array([(ytr == c).sum() for c in range(n_classes)],
                            dtype=np.float32)
    class_counts = np.maximum(class_counts, 1.0)
    inv = 1.0 / class_counts
    class_weights_np = inv / inv.sum() * n_classes
    class_weights = torch.from_numpy(class_weights_np.astype(np.float32))
    print("Class distribution in train:")
    for i, c in enumerate(classes_ref):
        print(f"  {c:<13} {int(class_counts[i]):>6}   weight={class_weights_np[i]:.2f}")
    print()

    # ── DataLoaders ──
    augment = SpecAugment() if args.augment else None
    def make_loader(X, y, shuffle, with_aug=False):
        ds = SpecDataset(X, y, augment=(augment if with_aug else None))
        return DataLoader(ds, batch_size=args.batch_size, shuffle=shuffle,
                          num_workers=0)
    train_loader = make_loader(Xtr, ytr, shuffle=True, with_aug=True)
    val_loader   = make_loader(Xva, yva, shuffle=False)
    test_loader  = make_loader(Xte, yte, shuffle=False)

    # ── Model ──
    model = CSI_DeepCNN(
        n_classes=n_classes,
        n_in_channels=n_in_channels,
        base=args.base,
        dense=args.dense,
        dropout=args.dropout,
        conv_dropout=args.conv_dropout,
        activation=args.activation,
    ).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Model: CSI_DeepCNN  base={args.base}  dense={args.dense}  "
          f"act={args.activation}  dropout={args.dropout}  "
          f"conv_drop={args.conv_dropout}  augment={'ON' if args.augment else 'OFF'}")
    print(f"  params={n_params:,}   input=({n_in_channels},{F_dim},{T_dim})")
    print()

    print(f"Training up to {args.epochs} epochs on {device} "
          f"(early stop patience={args.patience}, "
          f"ReduceLROnPlateau patience={args.lr_patience}, "
          f"factor={args.lr_factor}, min_lr={args.min_lr})...")
    best_f1 = fit(
        model, train_loader, val_loader, n_classes, class_weights,
        epochs=args.epochs, lr=args.lr, device=device, ckpt_path=args.ckpt,
        patience=args.patience, lr_patience=args.lr_patience,
        lr_factor=args.lr_factor, min_lr=args.min_lr,
        weight_decay=args.weight_decay, augment=augment,
    )
    print()
    print(f"Best val macro-F1: {best_f1:.3f}   checkpoint: {args.ckpt}")

    # ── Test eval ──
    model.load_state_dict(torch.load(args.ckpt, map_location=device))
    model.eval()
    all_p = []; all_t = []
    with torch.no_grad():
        for X, y in test_loader:
            X = X.to(device)
            logits = model(X)
            all_p.append(logits.argmax(dim=1).cpu().numpy())
            all_t.append(y.numpy())
    if not all_p:
        print("No test sequences."); return 0
    yp = np.concatenate(all_p); yt = np.concatenate(all_t)

    def _report(label, yt_sub, yp_sub):
        if len(yt_sub) == 0:
            print(f"  ({label}: no sequences)"); return
        cm = confusion(yt_sub, yp_sub, n_classes)
        p, r, f = per_class_metrics(yt_sub, yp_sub, n_classes)
        acc = float((yp_sub == yt_sub).mean())
        macro_f1 = float(f.mean())
        print(); print("─" * 78)
        print(f"  {label}    n={len(yt_sub)}    acc={acc:.3f}   "
              f"macro-F1={macro_f1:.3f}")
        print("─" * 78)
        print(f"  {'class':<13} {'support':>8} {'precision':>10} "
              f"{'recall':>8} {'f1':>6}")
        for i, c in enumerate(classes_ref):
            sup = int((yt_sub == i).sum())
            if sup == 0: continue
            print(f"  {c:<13} {sup:>8} {p[i]:>10.3f} {r[i]:>8.3f} {f[i]:>6.3f}")
        print()
        print(f"  Confusion (rows = true, cols = pred):")
        print("             " + " ".join(f"{c[:7]:>8}" for c in classes_ref))
        for i, c in enumerate(classes_ref):
            row = " ".join(f"{cm[i, j]:>8}" for j in range(n_classes))
            print(f"  {c[:11]:<11} {row}")
        for cand in ("FALL_IMPACT", "FALL"):
            if cand in classes_ref:
                idx = classes_ref.index(cand)
                sup = int((yt_sub == idx).sum())
                if sup > 0:
                    print(f"  Headline: {cand} recall = {r[idx]:.1%}  "
                          f"(precision {p[idx]:.1%}, support {sup})")
                break

    print(); print("=" * 78)
    print("Test results (session-disjoint hold-out)")
    print("=" * 78)
    print(f"  Test sessions: {te_names}")
    print(f"  Origin breakdown: {_summarize(te_names, te_origins)}")

    _report("COMBINED test set (all sources mixed)", yt, yp)
    unique_origins = sorted(set(ote.tolist())) if len(ote) else []
    if len(unique_origins) > 1:
        for origin in unique_origins:
            mask = (ote == origin)
            _report(f"{origin.upper()}-ONLY slice of test set",
                    yt[mask], yp[mask])

    if args.results_json is not None:
        cm_combined = confusion(yt, yp, n_classes)
        p, r, f = per_class_metrics(yt, yp, n_classes)
        acc = float((yp == yt).mean())
        macro_f1 = float(f.mean())
        per_class = {}
        for i, c in enumerate(classes_ref):
            per_class[c] = {
                "support": int((yt == i).sum()),
                "precision": float(p[i]),
                "recall": float(r[i]),
                "f1": float(f[i]),
            }
        results = {
            "model": "cnn_deep",
            "test_sessions": list(te_names),
            "val_sessions": list(va_names),
            "train_sessions": list(tr_names),
            "n_test": int(len(yt)),
            "acc": acc,
            "macro_f1": macro_f1,
            "per_class": per_class,
            "best_val_macro_f1": float(best_f1),
            "checkpoint": str(args.ckpt),
            "classes": list(classes_ref),
            "confusion": cm_combined.tolist(),
        }
        args.results_json.parent.mkdir(parents=True, exist_ok=True)
        with open(args.results_json, "w") as fp:
            json.dump(results, fp, indent=2)
        print(f"\n  ✓ wrote results JSON → {args.results_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
