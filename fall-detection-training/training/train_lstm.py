#!/usr/bin/env python3
"""
train_lstm.py — feature extraction + LSTM training + evaluation.

Pipeline:
    NPZ + labels.json
        ↓ (feature extraction: 1s windows, 0.5s hop)
    (N_windows, F=16) feature matrix per session
        ↓ (sequence formation: T_seq=8 windows = 4s context)
    (N_seq, T=8, F=16) sequences per session
        ↓ (session-disjoint split)
    train / val / test
        ↓
    LSTM (1 layer, 64 hidden) → linear → 5 or 6 classes
        ↓ (weighted CrossEntropy + AdamW)
    checkpoint + confusion matrix + per-class metrics

Usage:
    python train_lstm.py
    python train_lstm.py --labels labels_v2.json   # 6-class FALL split
    python train_lstm.py --epochs 100 --batch-size 64
    python train_lstm.py --hidden 128 --t-seq 10

Reads from dataset/*/csi.npz + dataset/*/<labels-file>.
Writes checkpoints/best.pt and prints metrics to stdout.

Hardware: CPU is fine. 80 min of data ≈ 5–15 min wall-clock to train on
an M-series Mac. No GPU required.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn as nn
    from torch.utils.data import Dataset, DataLoader
except ImportError:
    raise SystemExit(
        "PyTorch is required. Install with:\n"
        "    pip install torch\n"
        "(CPU-only is fine; the model is small.)"
    )


# ─────────────────────────────────────────────────────────
# Feature extraction
# ─────────────────────────────────────────────────────────

def robust_variance(amps_window: np.ndarray, k_sigma: float = 3.0) -> float:
    if amps_window.shape[0] < 5:
        return 0.0
    detrended = amps_window - amps_window.mean(axis=0, keepdims=True)
    mad = np.median(np.abs(detrended), axis=0, keepdims=True)
    clip = k_sigma * 1.4826 * np.maximum(mad, 1e-6)
    detrended = np.clip(detrended, -clip, clip)
    return float(np.mean(detrended * detrended))


def spectral_centroid_in_band(amps_window: np.ndarray, fs: float,
                              fmin: float = 0.5, fmax: float = 5.0) -> float:
    """Frequency-weighted center of mass in the motion band, averaged across subs."""
    if amps_window.shape[0] < 8:
        return 0.0
    # Detrend per subcarrier
    a = amps_window - amps_window.mean(axis=0, keepdims=True)
    n = a.shape[0]
    spec = np.abs(np.fft.rfft(a, axis=0)) ** 2  # (F, S)
    freqs = np.fft.rfftfreq(n, d=1.0 / fs)
    band = (freqs >= fmin) & (freqs <= fmax)
    if band.sum() == 0:
        return 0.0
    band_spec = spec[band].mean(axis=1)  # average across subs
    band_freqs = freqs[band]
    if band_spec.sum() < 1e-9:
        return 0.0
    return float((band_freqs * band_spec).sum() / band_spec.sum())


def extract_features_for_session(csi_path: Path, labels_path: Path,
                                 win_sec: float = 1.0, hop_sec: float = 0.5):
    """
    Returns:
        X: (N_windows, F)  float32 feature matrix
        y: (N_windows,)    int label indices  (or -1 for unlabeled windows)
        class_names: list of class strings (label index → name)
        rx_names: list of RX names (for diagnostics)
    """
    csi = np.load(csi_path)
    with open(labels_path) as f:
        L = json.load(f)
    rx_names = [str(n) for n in csi["rx_names"]]
    class_to_idx = {v: int(k) for k, v in L["classes"].items()}
    classes = [L["classes"][str(i)] for i in sorted(class_to_idx.values())]

    # Build a unified time grid using the densest RX
    # (all RXs have similar packet rates; use RX1 as anchor)
    anchor = rx_names[0]
    t_anchor = csi[f"timestamps_{anchor}"]
    if len(t_anchor) < 50:
        return None
    t_start, t_end = float(t_anchor[0]), float(t_anchor[-1])

    windows = []
    t = t_start
    while t + win_sec <= t_end:
        windows.append(t + win_sec / 2)
        t += hop_sec
    n_win = len(windows)
    if n_win < 8:
        return None

    # Compute features per window per RX
    F_per_rx = 4  # var, delta_var, mean_amp, spectral_centroid
    F = F_per_rx * len(rx_names)
    X = np.zeros((n_win, F), dtype=np.float32)

    prev_var = {name: 0.0 for name in rx_names}
    for w_idx, t_center in enumerate(windows):
        t_lo, t_hi = t_center - win_sec / 2, t_center + win_sec / 2
        col = 0
        for name in rx_names:
            ts = csi[f"timestamps_{name}"]
            amps = csi[f"amplitudes_{name}"].astype(np.float32)
            mask = (ts >= t_lo) & (ts < t_hi)
            chunk = amps[mask]
            if chunk.shape[0] < 5:
                X[w_idx, col:col + F_per_rx] = 0.0
                col += F_per_rx
                continue
            chunk_ts = ts[mask]
            fs = len(chunk_ts) / (chunk_ts[-1] - chunk_ts[0]) if len(chunk_ts) > 1 else 70.0
            v = robust_variance(chunk)
            dv = v - prev_var[name]
            prev_var[name] = v
            mean_amp = float(chunk.mean())
            sc = spectral_centroid_in_band(chunk, fs)
            X[w_idx, col + 0] = v
            X[w_idx, col + 1] = dv
            X[w_idx, col + 2] = mean_amp
            X[w_idx, col + 3] = sc
            col += F_per_rx

    # Labels: majority class active during each window
    y = np.full(n_win, -1, dtype=np.int64)
    segs = L["segments"]
    for w_idx, t_center in enumerate(windows):
        for s in segs:
            if s["t_start"] <= t_center < s["t_end"]:
                y[w_idx] = class_to_idx[s["class"]]
                break

    return X, y, classes, rx_names


# ─────────────────────────────────────────────────────────
# Feature cache  (avoid re-extraction across hyperparam sweeps)
# ─────────────────────────────────────────────────────────

def cache_path_for(session_dir: Path, labels_filename: str,
                   win_sec: float, hop_sec: float) -> Path:
    labels_stem = Path(labels_filename).stem
    return session_dir / f".features_cache_{labels_stem}_w{win_sec}_h{hop_sec}.npz"


def is_cache_valid(cache_path: Path, csi_path: Path, labels_path: Path) -> bool:
    """Cache is valid only if it exists and is newer than both source files."""
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


def save_cache(cache_path: Path, X: np.ndarray, y: np.ndarray,
               classes: list[str], rx_names: list[str]) -> None:
    np.savez_compressed(
        cache_path,
        X=X.astype(np.float32),
        y=y.astype(np.int64),
        classes=np.array(classes, dtype="U24"),
        rx_names=np.array(rx_names, dtype="U16"),
    )


# ─────────────────────────────────────────────────────────
# Worker for parallel feature extraction
# (top-level so it pickles for ProcessPoolExecutor on macOS spawn)
# ─────────────────────────────────────────────────────────

def _extract_one(job: dict) -> dict:
    """Extract or load-cached features for one session."""
    csi_path = Path(job["csi_path"])
    labels_path = Path(job["labels_path"])
    cache_path = Path(job["cache_path"])
    win_sec = job["win_sec"]
    hop_sec = job["hop_sec"]
    use_cache = job["use_cache"]
    rebuild = job["rebuild_cache"]

    if use_cache and not rebuild and is_cache_valid(cache_path, csi_path, labels_path):
        try:
            X, y, classes, rx_names = load_cache(cache_path)
            return {"status": "cached", "session_name": job["session_name"],
                    "X": X, "y": y, "classes": classes, "rx_names": rx_names}
        except Exception:
            pass  # fall through to re-extract

    out = extract_features_for_session(
        csi_path, labels_path, win_sec=win_sec, hop_sec=hop_sec
    )
    if out is None:
        return {"status": "skipped", "session_name": job["session_name"]}
    X, y, classes, rx_names = out
    if use_cache:
        try:
            save_cache(cache_path, X, y, classes, rx_names)
        except Exception as exc:
            return {"status": "extracted_no_cache",
                    "session_name": job["session_name"],
                    "X": X, "y": y, "classes": classes, "rx_names": rx_names,
                    "warn": f"cache save failed: {exc}"}
    return {"status": "extracted", "session_name": job["session_name"],
            "X": X, "y": y, "classes": classes, "rx_names": rx_names}


# ─────────────────────────────────────────────────────────
# Sequence formation
# ─────────────────────────────────────────────────────────

def windows_to_sequences(X: np.ndarray, y: np.ndarray, t_seq: int):
    """Stack consecutive windows into LSTM input sequences.
    Each output sequence's label = label of the *last* window."""
    if len(X) < t_seq:
        return np.empty((0, t_seq, X.shape[1]), dtype=np.float32), np.empty((0,), dtype=np.int64)
    n = len(X) - t_seq + 1
    Xs = np.stack([X[i : i + t_seq] for i in range(n)], axis=0).astype(np.float32)
    ys = y[t_seq - 1:]
    # Drop sequences whose target label is unlabeled
    keep = ys >= 0
    return Xs[keep], ys[keep]


# ─────────────────────────────────────────────────────────
# Dataset / DataLoader
# ─────────────────────────────────────────────────────────

class SeqDataset(Dataset):
    def __init__(self, X: np.ndarray, y: np.ndarray):
        self.X = torch.from_numpy(X)
        self.y = torch.from_numpy(y)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


# ─────────────────────────────────────────────────────────
# Model
# ─────────────────────────────────────────────────────────

class CSIClassifier(nn.Module):
    """
    Stacked LSTM with optional dense head.

    Args:
        n_features: input feature dim per timestep
        n_classes: output classes
        lstm_units: list of hidden sizes per LSTM layer, e.g. [64, 32]
        dense_units: dense head width before classifier (0 = skip dense)
        dropout: dropout in head + between LSTM layers (0.2–0.4 typical)
        recurrent_dropout: applied between LSTM layers (0.0–0.2 typical)

    Note on recurrent dropout: PyTorch's nn.LSTM applies dropout *between*
    stacked LSTM layers, not on the recurrent connections inside a layer.
    Real per-step recurrent dropout requires a custom cell (e.g. weight-drop)
    and is rarely worth it for a model this small. We use the between-layer
    dropout, which is the standard interpretation in practice.
    """
    def __init__(self, n_features: int, n_classes: int,
                 lstm_units: list[int],
                 dense_units: int = 0,
                 dropout: float = 0.2,
                 recurrent_dropout: float = 0.0,
                 bidirectional: bool = False):
        super().__init__()
        assert len(lstm_units) >= 1, "lstm_units must have at least one entry"
        self.bidirectional = bidirectional
        # Build a stack of (possibly different-sized) LSTM layers manually,
        # since nn.LSTM with num_layers>1 requires uniform hidden size.
        self.lstm_stack = nn.ModuleList()
        in_size = n_features
        for h in lstm_units:
            self.lstm_stack.append(
                nn.LSTM(in_size, h, num_layers=1, batch_first=True,
                        bidirectional=bidirectional)
            )
            in_size = h * (2 if bidirectional else 1)
        self.between_lstm_dropout = nn.Dropout(recurrent_dropout)

        last_hidden = lstm_units[-1] * (2 if bidirectional else 1)
        head_layers: list[nn.Module] = [
            nn.LayerNorm(last_hidden),
            nn.Dropout(dropout),
        ]
        if dense_units > 0:
            head_layers += [
                nn.Linear(last_hidden, dense_units),
                nn.ReLU(),
                nn.Dropout(dropout),
                nn.Linear(dense_units, n_classes),
            ]
        else:
            head_layers += [nn.Linear(last_hidden, n_classes)]
        self.head = nn.Sequential(*head_layers)

    def forward(self, x):  # (B, T, F)
        for i, lstm in enumerate(self.lstm_stack):
            x, _ = lstm(x)
            if i < len(self.lstm_stack) - 1:
                x = self.between_lstm_dropout(x)
        return self.head(x[:, -1, :])


# ─────────────────────────────────────────────────────────
# Train + eval
# ─────────────────────────────────────────────────────────

def per_class_metrics(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int):
    """Returns (precision, recall, f1) per class as length-n_classes arrays."""
    p = np.zeros(n_classes); r = np.zeros(n_classes); f = np.zeros(n_classes)
    for c in range(n_classes):
        tp = int(((y_pred == c) & (y_true == c)).sum())
        fp = int(((y_pred == c) & (y_true != c)).sum())
        fn = int(((y_pred != c) & (y_true == c)).sum())
        p[c] = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        r[c] = tp / (tp + fn) if (tp + fn) > 0 else 0.0
        f[c] = 2 * p[c] * r[c] / (p[c] + r[c]) if (p[c] + r[c]) > 0 else 0.0
    return p, r, f


def confusion(y_true: np.ndarray, y_pred: np.ndarray, n_classes: int):
    cm = np.zeros((n_classes, n_classes), dtype=np.int64)
    for t, p in zip(y_true, y_pred):
        cm[t, p] += 1
    return cm


def fit(model, train_loader, val_loader, n_classes, class_weights,
        epochs: int, lr: float, device,
        ckpt_path: Path,
        early_stop_patience: int = 15,
        lr_patience: int = 5,
        lr_factor: float = 0.5,
        min_lr: float = 1e-5,
        weight_decay: float = 0.0):
    """
    Train with:
      • Adam optimizer (per spec)
      • ReduceLROnPlateau on val_loss  (factor=lr_factor, patience=lr_patience, min_lr=min_lr)
      • Early stopping on val_macro_f1 (patience=early_stop_patience)
      • Save best checkpoint by val_macro_f1
    """
    crit = nn.CrossEntropyLoss(weight=class_weights.to(device))
    opt = torch.optim.Adam(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
        opt, mode="min", factor=lr_factor, patience=lr_patience,
        min_lr=min_lr,
    )
    best_macro_f1 = -1.0
    epochs_since_best = 0
    history = []

    for epoch in range(1, epochs + 1):
        # ── Train ──
        model.train()
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

        # ── Val ──
        model.eval()
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

        # LR scheduler steps on val_loss
        scheduler.step(val_loss)
        current_lr = opt.param_groups[0]["lr"]

        history.append({
            "epoch": epoch, "train_loss": train_loss,
            "val_loss": val_loss, "val_macro_f1": macro_f1,
            "val_acc": acc, "lr": current_lr,
        })

        # Best-checkpoint tracking + early stop
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

        if epochs_since_best >= early_stop_patience:
            print(f"  ⏹ early stop: no val_macro_f1 improvement for "
                  f"{early_stop_patience} epochs (best={best_macro_f1:.3f})")
            break

    return history, best_macro_f1


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dataset", type=Path, default=Path("dataset"))
    parser.add_argument("--labels", type=str, default="labels.json",
                        help="Labels filename inside each session folder. "
                             "Use 'labels_v2.json' for the FALL-split 6-class set.")
    parser.add_argument("--win-sec", type=float, default=1.0)
    parser.add_argument("--hop-sec", type=float, default=0.5)
    parser.add_argument("--t-seq", type=int, default=8,
                        help="LSTM context length in windows (default 8 = 4s)")

    # ── Model architecture ──
    parser.add_argument("--lstm-units", type=str, default="64",
                        help="Comma-separated LSTM hidden sizes per layer. "
                             "Examples: '32', '64', '32,16', '64,32'.")
    parser.add_argument("--dense-units", type=int, default=32,
                        help="Dense layer width before output (0 = skip).")
    parser.add_argument("--dropout", type=float, default=0.3,
                        help="Head + recurrent-stack dropout (0.2–0.4).")
    parser.add_argument("--recurrent-dropout", type=float, default=0.1,
                        help="Dropout between stacked LSTM layers (0.0–0.2).")
    parser.add_argument("--bidirectional", action="store_true",
                        help="Use bidirectional LSTM (sees past + future). "
                             "Doubles last-hidden width.")

    # ── Training ──
    parser.add_argument("--epochs", type=int, default=200,
                        help="Max epochs (early stop usually triggers first).")
    parser.add_argument("--batch-size", type=int, default=32,
                        help="Recommended: 8 / 16 / 32.")
    parser.add_argument("--lr", type=float, default=1e-3,
                        help="Initial learning rate. Try 1e-4 / 5e-4 / 1e-3.")
    parser.add_argument("--weight-decay", type=float, default=0.0)

    # ── LR scheduler / early stop ──
    parser.add_argument("--patience", type=int, default=15,
                        help="Early-stop patience on val_macro_f1 (10–20).")
    parser.add_argument("--lr-patience", type=int, default=5,
                        help="ReduceLROnPlateau patience on val_loss.")
    parser.add_argument("--lr-factor", type=float, default=0.5,
                        help="ReduceLROnPlateau multiplier on plateau.")
    parser.add_argument("--min-lr", type=float, default=1e-5,
                        help="ReduceLROnPlateau floor.")

    # ── Splits / IO ──
    parser.add_argument("--val-frac", type=float, default=0.2)
    parser.add_argument("--test-frac", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--ckpt", type=Path, default=Path("checkpoints/best.pt"))
    parser.add_argument("--force-test-session", type=str, default=None,
                        help="Force a specific session name to be the test set "
                             "(e.g. 'subj01_v2_session04'). Overrides the random "
                             "session-disjoint split. Used by loocv_eval.py to do "
                             "leave-one-out cross-validation across sessions. "
                             "Val is picked deterministically from remaining "
                             "sessions of the same origin using --seed.")
    parser.add_argument("--results-json", type=Path, default=None,
                        help="If set, write a JSON file with the COMBINED test "
                             "metrics (acc, macro_f1, per-class p/r/f1, "
                             "support, test_session_names). Used by loocv_eval.py.")

    # ── Feature cache ──
    parser.add_argument("--no-cache", action="store_true",
                        help="Don't read or write the feature cache. Forces "
                             "extraction every run (slow).")
    parser.add_argument("--rebuild-cache", action="store_true",
                        help="Ignore existing cache and re-extract, but "
                             "do save the new cache for next time.")

    # ── Multi-source data filtering ──
    parser.add_argument("--source", type=str, default="all",
                        choices=["all", "ours", "csi_har"],
                        help="Filter sessions by origin. 'ours' = only "
                             "subj01_* sessions; 'csi_har' = only adapted "
                             "CSI-HAR sessions; 'all' = both (default).")
    parser.add_argument("--workers", type=int, default=0,
                        help="Parallel feature-extraction workers. 0 = auto "
                             "(min(8, cpu_count)). 1 = serial. Cached sessions "
                             "get loaded in workers too — still parallel-friendly.")
    args = parser.parse_args()

    # Parse lstm-units string -> list[int]
    try:
        lstm_units = [int(x.strip()) for x in args.lstm_units.split(",") if x.strip()]
    except ValueError:
        print(f"Bad --lstm-units '{args.lstm_units}'. Use comma-separated ints "
              f"like '64' or '64,32'.")
        return 2
    if not lstm_units:
        print("--lstm-units must have at least one number.")
        return 2

    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    # ── Discover sessions ──
    def session_origin(session_dir: Path) -> str:
        """Read metadata.json's 'origin' field; default 'ours' if absent."""
        meta_path = session_dir / "metadata.json"
        if meta_path.exists():
            try:
                with open(meta_path) as f:
                    meta = json.load(f)
                return str(meta.get("origin", "ours"))
            except Exception:
                pass
        return "ours"

    all_sessions = sorted(args.dataset.glob("*/"))
    all_sessions = [d for d in all_sessions if (d / "csi.npz").exists()
                                            and (d / args.labels).exists()]
    # Tag each with origin
    sessions_with_origin = [(d, session_origin(d)) for d in all_sessions]

    # Apply --source filter
    if args.source == "ours":
        sessions_with_origin = [(d, o) for d, o in sessions_with_origin if o == "ours"]
    elif args.source == "csi_har":
        sessions_with_origin = [(d, o) for d, o in sessions_with_origin if o == "csi_har"]

    sessions = [d for d, o in sessions_with_origin]
    if len(sessions) < 3:
        print(f"Need at least 3 sessions; found {len(sessions)} with "
              f"{args.labels}  (source filter: {args.source})", flush=True)
        return 1

    n_by_origin: dict[str, int] = {}
    for _, o in sessions_with_origin:
        n_by_origin[o] = n_by_origin.get(o, 0) + 1
    print(f"Found {len(sessions)} sessions using labels file '{args.labels}' "
          f"(filter: {args.source})")
    for origin, n in sorted(n_by_origin.items()):
        print(f"  origin={origin}: {n} session(s)")
    print()

    # ── Extract features per session (with disk cache + multiprocessing) ──
    workers = args.workers
    if workers <= 0:
        workers = min(8, os.cpu_count() or 1)
    cache_mode = ("OFF" if args.no_cache
                  else "ON" + (" [rebuilding]" if args.rebuild_cache else ""))
    print(f"Extracting features  (cache: {cache_mode}, workers: {workers})...")
    t0 = time.time()

    # Build job list
    jobs = []
    for d in sessions:
        jobs.append({
            "session_name": d.name,
            "csi_path": str(d / "csi.npz"),
            "labels_path": str(d / args.labels),
            "cache_path": str(cache_path_for(d, args.labels,
                                             args.win_sec, args.hop_sec)),
            "win_sec": args.win_sec,
            "hop_sec": args.hop_sec,
            "use_cache": not args.no_cache,
            "rebuild_cache": args.rebuild_cache,
        })

    # session_name → result (preserve order at end)
    name_to_result: dict[str, dict] = {}
    name_to_origin: dict[str, str] = {d.name: session_origin(d) for d in sessions}

    if workers == 1:
        # Serial path — useful for debugging
        for i, job in enumerate(jobs):
            res = _extract_one(job)
            name_to_result[res["session_name"]] = res
            verbose = (i < 3) or ((i + 1) % 50 == 0) or (i + 1 == len(jobs))
            if verbose:
                print(f"  [{i+1}/{len(jobs)}] {res['session_name']}  [{res['status']}]")
    else:
        # Parallel path
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_extract_one, j): j for j in jobs}
            done = 0
            for fut in as_completed(futures):
                done += 1
                res = fut.result()
                name_to_result[res["session_name"]] = res
                verbose = (done <= 3) or (done % 50 == 0) or (done == len(jobs))
                if verbose:
                    print(f"  [{done}/{len(jobs)}] {res['session_name']}  "
                          f"[{res['status']}]")

    # Assemble per_session in deterministic order, run windowing serially
    # (sequence formation is fast — no point parallelizing).
    per_session = []
    classes_ref = None
    n_cached = 0; n_extracted = 0; n_skipped = 0
    for d in sessions:
        res = name_to_result.get(d.name)
        if res is None or res["status"] == "skipped":
            n_skipped += 1
            continue
        if res["status"] == "cached":
            n_cached += 1
        else:
            n_extracted += 1
        X = res["X"]; y = res["y"]; classes = res["classes"]
        if classes_ref is None:
            classes_ref = classes
        elif classes != classes_ref:
            print(f"  {d.name}: WARNING — class set differs from first session")
        Xs, ys = windows_to_sequences(X, y, args.t_seq)
        per_session.append((d.name, Xs, ys, name_to_origin[d.name]))
    print(f"  ({time.time() - t0:.1f}s — {n_cached} cached, "
          f"{n_extracted} extracted, {n_skipped} skipped)\n")

    n_classes = len(classes_ref)
    n_features = per_session[0][1].shape[2]
    print(f"  features per window: {n_features}   classes: {n_classes} ({classes_ref})")
    print()

    # ── Session-disjoint, origin-stratified split ──
    # Splitting per-origin guarantees:
    #   • train always has both sources (when both are present)
    #   • test always contains at least one of YOUR sessions
    #   • we can also evaluate on a "your-data-only" test slice separately
    rng = np.random.default_rng(args.seed)

    by_origin: dict[str, list[int]] = {}
    for i, (_, _, _, origin) in enumerate(per_session):
        by_origin.setdefault(origin, []).append(i)

    train_idx: set[int] = set()
    val_idx:   set[int] = set()
    test_idx:  set[int] = set()

    # If --force-test-session is set, pin that session as the only test set.
    # The remaining sessions of the same origin go into train/val using
    # --val-frac; sessions of OTHER origins follow the normal random split.
    forced_idx = None
    if args.force_test_session:
        for i, (name, _, _, _) in enumerate(per_session):
            if name == args.force_test_session:
                forced_idx = i
                break
        if forced_idx is None:
            available = [n for n, *_ in per_session]
            print(f"ERROR: --force-test-session '{args.force_test_session}' "
                  f"not found. Available sessions: {available}", file=sys.stderr)
            return 2
        test_idx.add(forced_idx)
        forced_origin = per_session[forced_idx][3]
        print(f"  [LOOCV] Forced test session: "
              f"{args.force_test_session}  (origin={forced_origin})")

    for origin, indices in by_origin.items():
        # Filter out anything already forced into test
        remaining = [i for i in indices if i not in test_idx]
        perm = rng.permutation(remaining)
        n = len(perm)
        if origin == (per_session[forced_idx][3] if forced_idx is not None else None):
            # We've already taken our test from this origin; just split remaining
            # into train/val by val_frac.
            n_val = max(1, int(round(args.val_frac * (n + 1)))) if n >= 2 else 0
            val_idx.update(perm[:n_val].tolist())
            train_idx.update(perm[n_val:].tolist())
        else:
            n_test = max(1, int(round(args.test_frac * n))) if n >= 3 else 1
            n_val  = max(1, int(round(args.val_frac  * n))) if n >= 3 else 0
            if args.force_test_session:
                # Don't add more test sessions when LOOCV-forcing
                n_test = 0
            test_idx.update(perm[:n_test].tolist())
            val_idx.update(perm[n_test:n_test + n_val].tolist())
            train_idx.update(perm[n_test + n_val:].tolist())

    def collect(idx_set):
        Xs, ys, names, origins = [], [], [], []
        for i in sorted(idx_set):
            name, X, y, origin = per_session[i]
            Xs.append(X); ys.append(y); names.append(name); origins.append(origin)
        if not Xs:
            return (np.empty((0, args.t_seq, n_features), dtype=np.float32),
                    np.empty((0,), dtype=np.int64),
                    np.empty((0,), dtype=object),
                    names, origins)
        # Per-sequence origin tag so we can subset test by origin
        seq_origins = np.concatenate([
            np.full(len(per_session[i][1]), per_session[i][3], dtype=object)
            for i in sorted(idx_set)
        ])
        return (np.concatenate(Xs), np.concatenate(ys), seq_origins,
                names, origins)

    Xtr, ytr, otr, tr_names, tr_origins = collect(train_idx)
    Xva, yva, ova, va_names, va_origins = collect(val_idx)
    Xte, yte, ote, te_names, te_origins = collect(test_idx)

    def _summarize(names, origins):
        if not names:
            return "(none)"
        groups: dict[str, list[str]] = {}
        for n, o in zip(names, origins):
            groups.setdefault(o, []).append(n)
        return "  ".join(f"{o}={len(v)}" for o, v in sorted(groups.items()))

    print(f"Split (session-disjoint, origin-stratified):")
    print(f"  train: {len(Xtr):>5} seq    {_summarize(tr_names, tr_origins)}")
    print(f"  val  : {len(Xva):>5} seq    {_summarize(va_names, va_origins)}")
    print(f"  test : {len(Xte):>5} seq    {_summarize(te_names, te_origins)}")
    print(f"    train sessions: {tr_names}")
    print(f"    val   sessions: {va_names}")
    print(f"    test  sessions: {te_names}")
    print()

    # ── Per-feature standardization (using train stats only) ──
    mu = Xtr.reshape(-1, n_features).mean(axis=0).astype(np.float32)
    sd = Xtr.reshape(-1, n_features).std(axis=0).astype(np.float32)
    sd = np.maximum(sd, 1e-6)
    def norm(X): return (X - mu) / sd
    Xtr, Xva, Xte = norm(Xtr), norm(Xva), norm(Xte)

    # ── Class weights from train distribution ──
    class_counts = np.array([(ytr == c).sum() for c in range(n_classes)],
                            dtype=np.float32)
    class_counts = np.maximum(class_counts, 1.0)
    inv = 1.0 / class_counts
    class_weights_np = inv / inv.sum() * n_classes  # normalize so mean weight = 1
    class_weights = torch.from_numpy(class_weights_np.astype(np.float32))
    print("Class distribution in train:")
    for i, c in enumerate(classes_ref):
        print(f"  {c:<13} {int(class_counts[i]):>6} sequences   weight={class_weights_np[i]:.2f}")
    print()

    # ── DataLoaders ──
    def loader(X, y, shuffle):
        ds = SeqDataset(X, y)
        return DataLoader(ds, batch_size=args.batch_size, shuffle=shuffle,
                          num_workers=0)
    train_loader = loader(Xtr, ytr, shuffle=True)
    val_loader   = loader(Xva, yva, shuffle=False)
    test_loader  = loader(Xte, yte, shuffle=False)

    # ── Model ──
    device = "cpu"   # M-series CPU is plenty fast for this size
    model = CSIClassifier(
        n_features=n_features,
        n_classes=n_classes,
        lstm_units=lstm_units,
        dense_units=args.dense_units,
        dropout=args.dropout,
        recurrent_dropout=args.recurrent_dropout,
        bidirectional=args.bidirectional,
    ).to(device)
    n_params = sum(p.numel() for p in model.parameters())
    arch_desc = (f"LSTM stack {lstm_units}"
                 + (f" → Dense({args.dense_units},relu)" if args.dense_units > 0 else "")
                 + f" → Linear({n_classes})")
    print(f"Model: {arch_desc}")
    print(f"  params={n_params:,}   dropout={args.dropout}   "
          f"recurrent_dropout={args.recurrent_dropout}")
    print()

    # ── Train ──
    print(f"Training up to {args.epochs} epochs on CPU "
          f"(early stop patience={args.patience}, "
          f"ReduceLROnPlateau patience={args.lr_patience}, "
          f"factor={args.lr_factor}, min_lr={args.min_lr})...")
    history, best_f1 = fit(
        model, train_loader, val_loader, n_classes,
        class_weights, args.epochs, args.lr, device, args.ckpt,
        early_stop_patience=args.patience,
        lr_patience=args.lr_patience,
        lr_factor=args.lr_factor,
        min_lr=args.min_lr,
        weight_decay=args.weight_decay,
    )
    print()
    print(f"Best val macro-F1: {best_f1:.3f}   checkpoint: {args.ckpt}")

    # ── Test eval (load best ckpt) ──
    model.load_state_dict(torch.load(args.ckpt, map_location=device))
    model.eval()
    all_p, all_t = [], []
    with torch.no_grad():
        for X, y in test_loader:
            X = X.to(device)
            logits = model(X)
            all_p.append(logits.argmax(dim=1).cpu().numpy())
            all_t.append(y.numpy())
    if not all_p:
        print("No test sequences (test split empty). Skipping test metrics.")
        return 0
    yp = np.concatenate(all_p); yt = np.concatenate(all_t)

    def _report(label: str, yt_sub: np.ndarray, yp_sub: np.ndarray):
        if len(yt_sub) == 0:
            print(f"  ({label}: no sequences)")
            return
        cm = confusion(yt_sub, yp_sub, n_classes)
        p, r, f = per_class_metrics(yt_sub, yp_sub, n_classes)
        acc = float((yp_sub == yt_sub).mean())
        macro_f1 = float(f.mean())
        print()
        print("─" * 78)
        print(f"  {label}    n={len(yt_sub)}    acc={acc:.3f}   macro-F1={macro_f1:.3f}")
        print("─" * 78)
        print(f"  {'class':<13} {'support':>8} {'precision':>10} {'recall':>8} {'f1':>6}")
        for i, c in enumerate(classes_ref):
            sup = int((yt_sub == i).sum())
            if sup == 0:
                continue
            print(f"  {c:<13} {sup:>8} {p[i]:>10.3f} {r[i]:>8.3f} {f[i]:>6.3f}")
        print()
        print(f"  Confusion (rows = true, cols = pred):")
        print("             " + " ".join(f"{c[:7]:>8}" for c in classes_ref))
        for i, c in enumerate(classes_ref):
            row = " ".join(f"{cm[i, j]:>8}" for j in range(n_classes))
            print(f"  {c[:11]:<11} {row}")
        # Headline
        for cand in ("FALL_IMPACT", "FALL"):
            if cand in classes_ref:
                idx = classes_ref.index(cand)
                sup = int((yt_sub == idx).sum())
                if sup > 0:
                    print(f"  Headline: {cand} recall = {r[idx]:.1%}  "
                          f"(precision {p[idx]:.1%}, support {sup})")
                break

    print()
    print("=" * 78)
    print("Test results (session-disjoint hold-out)")
    print("=" * 78)
    print(f"  Test sessions: {te_names}")
    print(f"  Origin breakdown: {_summarize(te_names, te_origins)}")

    # Always report combined.
    _report("COMBINED test set (all sources mixed)", yt, yp)

    # Report per-origin slices when available.
    unique_origins = sorted(set(ote.tolist()))
    if len(unique_origins) > 1:
        for origin in unique_origins:
            mask = (ote == origin)
            _report(f"{origin.upper()}-ONLY slice of test set", yt[mask], yp[mask])

    # ── Optional: write JSON for downstream tools (loocv_eval.py) ──
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
            "model": "lstm",
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
