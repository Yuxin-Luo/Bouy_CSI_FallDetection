#!/usr/bin/env python3
"""
infer_loop_ensemble.py — Live inference: self-trained LSTM (16 hand-crafted
features × 16-frame sequence) + CNN (6 s band-spectrogram) with alpha-weighted
fusion, fed by receiver.py's NPZ chunks.

What this does vs. shipped `infer_loop.py`:
  - shipped loads 1 TorchScript ensemble (CNN+Transformer+LSTM in 1 file) that
    takes a 9-chunk spectrogram stack (1, 9, 32, 49, 21) and outputs binary
    FALL_IMPACT prob.
  - this script loads 2 separate PyTorch checkpoints — LSTM (uses
    extract_features_for_session) + CNN (uses compute_band_spectrogram) —
    and emulates ensemble_predict.py's alpha-weighted fusion adapted to a
    live chunk stream.
  - Inherits the 6-class taxonomy (EMPTY/STILL/WALKING/TRANSITION/FALL_IMPACT/
    FLOORED) the LSTM and CNN were trained on.

Pipeline per new receiver chunk:
  1. List new chunks under --live-dir (default <project>/data/live/).
  2. For each new chunk (6 s CSI):
     a. CNN: compute (32, 49, 21) spectrogram → forward → 6-class prob
     b. LSTM: compute 16 features per 1 s window over the chunk →
        chain up to 16 windows → forward → 6-class prob
     c. Time-align the two probs (CNN center = chunk midpoint, LSTM center =
        sequence midpoint) → alpha-weighted fusion
     d. Print prob[6] + argmax class to stdout

Cold start:
  - CNN: first chunk → first prob (~6 s after receiver start)
  - LSTM: needs ≥16 windows of 0.5 s hop = 8 s of CSI; first fused prob is
    typically ~14 s after receiver start.

Usage:
    # Default paths (auto from __file__):
    conda activate dac_dev
    python infer_loop_ensemble.py

    # Overrides:
    python infer_loop_ensemble.py --alpha 0.5 --device cpu \\
        --live-dir /path/to/data/live \\
        --lstm-ckpt /path/to/lstm.pt \\
        --cnn-ckpt /path/to/cnn.pt

Run alongside the receiver:
    # Terminal 1
    python src/pc_tools/receiver/receiver.py
    # Terminal 2
    python src/pc_tools/inference/infer_loop_ensemble.py
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import deque
from pathlib import Path

# Make pc_tools/ importable so common/state.py is reachable.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
import torch
import torch.nn.functional as F
from scipy.signal import stft as scipy_stft

# Make fall-detection-training/ importable so we can reuse its training helpers
# without modifying the upstream scripts.
sys.path.insert(0, str(
    Path(__file__).resolve().parent.parent.parent.parent
    / "fall-detection-training" / "training"
))

from common.state import load_state                     # noqa: E402

# Reuse training helpers (intentional duplication of work we already wrote):
#   - extract_features_for_session: full-session feature matrix (we re-implement
#     the per-window logic below for live chunking; import is here for
#     consistent mu/sd recompute + sanity checks).
#   - CSIClassifier: LSTM nn.Module definition.
#   - CSI_DeepCNN:   CNN nn.Module definition.
#   - extract_band_spectrograms_for_session: similar story for CNN.
from train_lstm import (                              # noqa: E402
    CSIClassifier, extract_features_for_session, robust_variance,
    spectral_centroid_in_band, windows_to_sequences,
)
from train_cnn_deep import CSI_DeepCNN                 # noqa: E402

# Per (window, channel) spectrogram + z-score — reused from shipped-style
# infer_loop.py for the CNN path. Same constants ship in train_cnn_deep too.
NPERSEG = 96
NOVERLAP = 80
N_BANDS = 8
NOMINAL_RATE_HZ = 70.0
F_DIM = NPERSEG // 2 + 1      # 49
T_DIM = 21                     # (6s × 70Hz - 80 overlap) // (96-80) = 21

# LSTM feature pipeline constants (must match train_lstm.py).
LSTM_WIN_SEC = 1.0
LSTM_HOP_SEC = 0.5
LSTM_T_SEQ = 16
LSTM_N_FEAT_PER_RX = 4        # var, delta_var, mean_amp, spectral_centroid

# ─────────────────────────────────────────────────────────────────────────────
# Project-root anchored defaults (no cwd dependency — see D.6/D.7/D.13.3).
#   <project>/src/pc_tools/inference/infer_loop_ensemble.py
#   <project>/data/live/                       ← receiver.py writes here
#   <project>/fall-detection-training/training/checkpoints/{lstm,cnn}.pt
#   <project>/dataset/                         ← trained sessions (for mu/sd)
# ─────────────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DEFAULT_LIVE_DIR    = _PROJECT_ROOT / "data" / "live"
_DEFAULT_LSTM_CKPT   = _PROJECT_ROOT / "fall-detection-training" / "training" / "checkpoints" / "lstm.pt"
_DEFAULT_CNN_CKPT    = _PROJECT_ROOT / "fall-detection-training" / "training" / "checkpoints" / "cnn.pt"
_DEFAULT_DATASET_DIR = _PROJECT_ROOT / "dataset"


# ─────────────────────────────────────────────────────────────────────────────
# RX presence check (per user 2026-07-01 policy — see dev_doc/7)
# A chunk's `rx_names` array declares which RX boards the receiver expected.
# If `amplitudes_<name>` or `timestamps_<name>` is absent for any of them,
# the RX board went offline at some point — this is a HARDWARE issue
# (USB cable / board power / chip) that the agent cannot fix. We hard-fail
# in main loop rather than silently degrading the inference (filling 0,
# skipping the chunk, or falling back to CNN-only) — that would mask the
# hardware problem and produce garbage predictions that look like real ones.
# ─────────────────────────────────────────────────────────────────────────────
def check_rx_presence(chunk_path: Path) -> tuple[list[str], list[str]]:
    """Return (present, missing) RX names for one chunk.
    present = rx names that have BOTH `amplitudes_<name>` and `timestamps_<name>`
    missing = rx names in rx_names that lack either of those arrays
    """
    csi = np.load(chunk_path)
    rx_names = [str(n) for n in csi["rx_names"]]
    present = [n for n in rx_names
               if f"amplitudes_{n}" in csi.files
               and f"timestamps_{n}" in csi.files]
    missing = [n for n in rx_names if n not in present]
    return present, missing


# ─────────────────────────────────────────────────────────────────────────────
# Per-chunk CNN spectrogram (1 CNN window = 1 receiver chunk)
# Mirrors compute_band_spectrogram() in infer_loop.py.
# ─────────────────────────────────────────────────────────────────────────────
def chunk_to_cnn_spectrogram(chunk_path: Path) -> np.ndarray | None:
    """Load one 6-s NPZ chunk, return (32, 49, 21) float32 spectrogram.
    Returns None on insufficient data. Same normalization as
    extract_band_spectrograms_for_session (log1p + per-channel z-score)."""
    csi = np.load(chunk_path)
    rx_names = [str(n) for n in csi["rx_names"]]
    if not rx_names:
        return None
    n_rx = len(rx_names)
    n_subs = csi[f"amplitudes_{rx_names[0]}"].shape[1]
    band_edges = np.linspace(0, n_subs, N_BANDS + 1, dtype=int)

    spec = np.zeros((n_rx * N_BANDS, F_DIM, T_DIM), dtype=np.float32)
    for r_idx, name in enumerate(rx_names):
        if f"amplitudes_{name}" not in csi.files:
            continue
        ts = csi[f"timestamps_{name}"]
        amps = csi[f"amplitudes_{name}"].astype(np.float32)
        if len(ts) < NPERSEG:
            continue
        fs = len(ts) / max(ts[-1] - ts[0], 1e-9)
        for b in range(N_BANDS):
            ch = r_idx * N_BANDS + b
            band_lo, band_hi = int(band_edges[b]), int(band_edges[b + 1])
            band_amps = amps[:, band_lo:band_hi]
            if band_amps.size == 0:
                continue
            band_series = band_amps.mean(axis=1).astype(np.float32)
            if len(band_series) < NPERSEG:
                continue
            try:
                _, _, Zxx = scipy_stft(
                    band_series, fs=fs, nperseg=NPERSEG, noverlap=NOVERLAP,
                    boundary=None, padded=False,
                )
                mag = np.abs(Zxx).astype(np.float32)
                ff = min(F_DIM, mag.shape[0])
                tt = min(T_DIM, mag.shape[1])
                spec[ch, :ff, :tt] = mag[:ff, :tt]
            except Exception:
                pass

    spec = np.log1p(spec)
    means = spec.mean(axis=(1, 2), keepdims=True)
    stds = spec.std(axis=(1, 2), keepdims=True) + 1e-6
    return ((spec - means) / stds).astype(np.float32)


# ─────────────────────────────────────────────────────────────────────────────
# Per-chunk LSTM features → sequence → prob
# Mirrors the per-window logic in extract_features_for_session (L128-L151)
# but operating on raw NPZ (no labels) inside one receiver chunk.
# ─────────────────────────────────────────────────────────────────────────────
def chunk_to_lstm_features(chunk_path: Path,
                           abs_t_offset: float) -> tuple[np.ndarray, np.ndarray]:
    """Return (X, t_centers) for a single 6 s chunk.

    X:           (n_windows_in_chunk, n_features) float32
    t_centers:   (n_windows_in_chunk,) absolute session-relative seconds
                 (so multiple chunks chain together)

    abs_t_offset is this chunk's earliest timestamp (in some global reference).
    Live streaming: use chunk filenames' monotonic increment as abs_t_offset;
    each chunk's internal timestamp is relative to its own RX clock, so we
    re-base onto abs_t_offset.
    """
    csi = np.load(chunk_path)
    rx_names = [str(n) for n in csi["rx_names"]]
    if len(rx_names) == 0:
        return np.zeros((0, LSTM_N_FEAT_PER_RX * len(rx_names)), dtype=np.float32), \
               np.zeros((0,), dtype=np.float64)

    # Anchor RX = first one (mirrors extract_features_for_session:106-110).
    anchor = rx_names[0]
    t_anchor = csi[f"timestamps_{anchor}"]
    if len(t_anchor) < 5:
        return np.zeros((0, LSTM_N_FEAT_PER_RX * len(rx_names)), dtype=np.float32), \
               np.zeros((0,), dtype=np.float64)

    t_start = float(t_anchor[0]) + abs_t_offset
    t_end   = float(t_anchor[-1]) + abs_t_offset

    # Build window centers (1 s win, 0.5 s hop), clipped to chunk range.
    centers = []
    t = t_start
    while t + LSTM_WIN_SEC <= t_end:
        centers.append(t + LSTM_WIN_SEC / 2)
        t += LSTM_HOP_SEC

    n_rx = len(rx_names)
    n_features = LSTM_N_FEAT_PER_RX * n_rx
    X = np.zeros((len(centers), n_features), dtype=np.float32)

    # delta_var across windows within this chunk (so prev_var resets per chunk
    # — matches behavior of feeding chunk-by-chunk; cross-chunk delta_var loss
    # is acceptable for live reasoning since session-level smoothing happens
    # at the LSTM layer).
    prev_var = {name: 0.0 for name in rx_names}

    for w_idx, t_center_abs in enumerate(centers):
        t_lo = t_center_abs - LSTM_WIN_SEC / 2
        t_hi = t_center_abs + LSTM_WIN_SEC / 2
        col = 0
        for name in rx_names:
            ts = csi[f"timestamps_{name}"] + abs_t_offset  # re-base
            amps = csi[f"amplitudes_{name}"].astype(np.float32)
            mask = (ts >= t_lo) & (ts < t_hi)
            chunk = amps[mask]
            if chunk.shape[0] < 5:
                col += LSTM_N_FEAT_PER_RX
                continue
            chunk_ts = ts[mask]
            fs = len(chunk_ts) / (chunk_ts[-1] - chunk_ts[0]) \
                if len(chunk_ts) > 1 else NOMINAL_RATE_HZ
            v = robust_variance(chunk)
            dv = v - prev_var[name]
            prev_var[name] = v
            mean_amp = float(chunk.mean())
            sc = spectral_centroid_in_band(chunk, fs)
            X[w_idx, col + 0] = v
            X[w_idx, col + 1] = dv
            X[w_idx, col + 2] = mean_amp
            X[w_idx, col + 3] = sc
            col += LSTM_N_FEAT_PER_RX

    return X, np.array(centers, dtype=np.float64)


def features_to_lstm_sequence(ring: deque) -> np.ndarray | None:
    """Take the trailing (LSTM_T_SEQ) feature windows from the ring buffer and
    stack into (LSTM_T_SEQ, n_features). Returns None if not enough yet.
    ring stores (X_window (n_features,), t_center)."""
    if len(ring) < LSTM_T_SEQ:
        return None
    seq = np.stack([w for (w, _) in list(ring)[-LSTM_T_SEQ:]], axis=0).astype(
        np.float32
    )
    return seq


# ─────────────────────────────────────────────────────────────────────────────
# LSTM / CNN checkpoint loaders
# Architecture defaults must match what we trained with (see D.21):
#   - lstm-units  = 64           (single-layer)
#   - dense-units = 32           (--dense-units vs --lstm-dense naming diff)
#   - lstm-t-seq  = 16
#   - cnn-base    = 32
#   - cnn-dense   = 128
#   - cnn-n-bands = 8
# ─────────────────────────────────────────────────────────────────────────────
def load_lstm(ckpt: Path, n_classes: int, device: str,
              lstm_units="64", lstm_dense=32, lstm_dropout=0.3,
              lstm_recurrent_dropout=0.1) -> CSIClassifier:
    units = [int(x.strip()) for x in lstm_units.split(",") if x.strip()]
    model = CSIClassifier(
        n_features=LSTM_N_FEAT_PER_RX * 4,    # 4 RX — receiver always emits 4
        n_classes=n_classes,
        lstm_units=units, dense_units=lstm_dense,
        dropout=lstm_dropout,
        recurrent_dropout=lstm_recurrent_dropout,
    ).to(device)
    if not ckpt.exists():
        raise FileNotFoundError(f"LSTM checkpoint not found: {ckpt}")
    model.load_state_dict(torch.load(ckpt, map_location=device))
    model.eval()
    return model


def load_cnn(ckpt: Path, n_classes: int, device: str) -> CSI_DeepCNN:
    model = CSI_DeepCNN(
        n_classes=n_classes, n_in_channels=4 * N_BANDS,
        base=32, dense=128, dropout=0.4, conv_dropout=0.1,
        activation="relu",
    ).to(device)
    if not ckpt.exists():
        raise FileNotFoundError(f"CNN checkpoint not found: {ckpt}")
    model.load_state_dict(torch.load(ckpt, map_location=device))
    model.eval()
    return model


def pick_device(requested: str) -> str:
    if requested == "auto":
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"
    return requested


# ─────────────────────────────────────────────────────────────────────────────
# Fast re-implementation of train_lstm.extract_features_for_session with
# HOISTED npz access. Upstream calls csi[f"amplitudes_{name}"].astype(...) inside
# a per-window × per-RX inner loop, so npz decompression repeats ~3700 times per
# session and the function takes 40-220 s. Hoisting cuts this to <1 s and
# produces a bit-identical X matrix (verified: max abs diff = 0.0).
# We mirror the upstream logic instead of editing train_lstm.py per CLAUDE.md
# (don't modify upstream scripts).
# ─────────────────────────────────────────────────────────────────────────────
def extract_features_fast(csi_path: Path, labels_path: Path,
                          win_sec: float = 1.0, hop_sec: float = 0.5):
    csi = np.load(csi_path)
    with open(labels_path) as f:
        L = json.load(f)
    rx_names = [str(n) for n in csi["rx_names"]]
    class_to_idx = {v: int(k) for k, v in L["classes"].items()}
    classes = [L["classes"][str(i)] for i in sorted(class_to_idx.values())]

    # Hoist: load + astype ONCE per RX (the slow path repeats this every window).
    amps_dict = {n: csi[f"amplitudes_{n}"].astype(np.float32) for n in rx_names}
    ts_dict = {n: csi[f"timestamps_{n}"] for n in rx_names}

    anchor = rx_names[0]
    t_anchor = ts_dict[anchor]
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

    F_per_rx = 4
    F = F_per_rx * len(rx_names)
    X = np.zeros((n_win, F), dtype=np.float32)

    prev_var = {name: 0.0 for name in rx_names}
    for w_idx, t_center in enumerate(windows):
        t_lo, t_hi = t_center - win_sec / 2, t_center + win_sec / 2
        col = 0
        for name in rx_names:
            ts = ts_dict[name]
            amps = amps_dict[name]
            mask = (ts >= t_lo) & (ts < t_hi)
            chunk = amps[mask]
            if chunk.shape[0] < 5:
                col += F_per_rx
                continue
            chunk_ts = ts[mask]
            fs = len(chunk_ts) / (chunk_ts[-1] - chunk_ts[0]) \
                if len(chunk_ts) > 1 else NOMINAL_RATE_HZ
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

    y = np.full(n_win, -1, dtype=np.int64)
    segs = L["segments"]
    for w_idx, t_center in enumerate(windows):
        for s in segs:
            if s["t_start"] <= t_center < s["t_end"]:
                y[w_idx] = class_to_idx[s["class"]]
                break

    return X, y, classes, rx_names


# ─────────────────────────────────────────────────────────────────────────────
# Recompute mu/sd from training sessions (matches ensemble_predict.py:323-348).
# The LSTM was trained on z-scored features; we recover stats from the same
# "ours" sessions that produced the checkpoint. Slight drift vs the LOOCV
# fold-private stats is acceptable (≤0.01 F1, see D.22.7).
# ─────────────────────────────────────────────────────────────────────────────
def recover_feature_stats(dataset_dir: Path) -> tuple[np.ndarray, np.ndarray] | None:
    if not dataset_dir.exists():
        return None
    sessions = sorted([d for d in dataset_dir.glob("*/")
                       if (d / "csi.npz").exists()
                       and (d / "labels_v2.json").exists()])
    if not sessions:
        return None
    Xs = []
    t_start_total = time.time()
    for d in sessions:
        ts = time.time()
        out = extract_features_fast(d / "csi.npz", d / "labels_v2.json",
                                    win_sec=LSTM_WIN_SEC, hop_sec=LSTM_HOP_SEC)
        if out is None:
            continue
        X, _, _, _ = out
        Xs.append(X)
        print(f"  recover stats {d.name}: X={X.shape} took {time.time()-ts:.2f}s",
              flush=True)
    if not Xs:
        return None
    Xall = np.concatenate(Xs, axis=0)
    mu = Xall.mean(axis=0).astype(np.float32)
    sd = np.maximum(Xall.std(axis=0).astype(np.float32), 1e-6)
    print(f"  recover_feature_stats total: {time.time()-t_start_total:.2f}s "
          f"({len(sessions)} sessions, Xall.shape={Xall.shape})", flush=True)
    return mu, sd


# ─────────────────────────────────────────────────────────────────────────────
# Class-name discovery (reads labels_v2.json from a training session, like
# ensemble_predict.py:275-281).
# ─────────────────────────────────────────────────────────────────────────────
def classes_from_dataset(dataset_dir: Path) -> list[str] | None:
    for d in sorted(dataset_dir.glob("*/")):
        p = d / "labels_v2.json"
        if p.exists():
            L = json.load(open(p))
            return [L["classes"][str(i)] for i in
                    sorted(int(k) for k in L["classes"].keys())]
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--live-dir", type=Path, default=_DEFAULT_LIVE_DIR)
    ap.add_argument("--lstm-ckpt", type=Path, default=_DEFAULT_LSTM_CKPT)
    ap.add_argument("--cnn-ckpt",  type=Path, default=_DEFAULT_CNN_CKPT)
    ap.add_argument("--dataset",   type=Path, default=_DEFAULT_DATASET_DIR,
                    help="Training sessions (for mu/sd + class names).")
    ap.add_argument("--alpha", type=float, default=None,
                    help="Weight on LSTM (1-alpha on CNN). Default = state.json.")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    ap.add_argument("--poll-sec", type=float, default=0.5)
    ap.add_argument("--allow-missing-rxs", action="store_true",
                    help="Opt-in to lenient mode: warn + skip on missing RX "
                         "boards. DEFAULT is STRICT — any missing RX triggers "
                         "a hard-fail (sys.exit(2)) because the agent cannot "
                         "fix the hardware issue. Use this flag only for "
                         "offline replay on historical chunks with known gaps; "
                         "do NOT use in live mode.")
    args = ap.parse_args()

    if not args.live_dir.exists():
        print(f"ERROR: live dir does not exist: {args.live_dir}", file=sys.stderr)
        print(f"       (start receiver.py first, or pass --live-dir)",
              file=sys.stderr)
        return 1

    classes = classes_from_dataset(args.dataset)
    if not classes:
        print(f"ERROR: no labels_v2.json under {args.dataset}/", file=sys.stderr)
        return 1
    n_classes = len(classes)

    device = pick_device(args.device)
    print(f"Classes ({n_classes}): {classes}")
    print(f"Device    : {device}")
    print(f"Live dir  : {args.live_dir}  (poll every {args.poll_sec}s)")
    print(f"LSTM ckpt : {args.lstm_ckpt}")
    print(f"CNN  ckpt : {args.cnn_ckpt}")
    print(f"Loading models...")

    lstm_model = load_lstm(args.lstm_ckpt, n_classes, device)
    cnn_model  = load_cnn(args.cnn_ckpt, n_classes, device)

    stats = recover_feature_stats(args.dataset)
    if stats is None:
        print("WARNING: could not recover mu/sd — LSTM may be off-distribution.",
              file=sys.stderr)
        mu, sd = None, None
    else:
        mu, sd = stats
        print(f"Feature stats recovered from {args.dataset}/ (mu/sd shape={mu.shape})")

    print("Models loaded. Watching for new chunks... (Ctrl-C to stop)\n")

    seen: set[str] = set()
    feature_ring: deque = deque(maxlen=LSTM_T_SEQ)   # (X_window, t_center)
    t_offset = 0.0                                    # chunk-base timestamp
    state = {"alpha": args.alpha}

    try:
        while True:
            # hot-reload alpha from state.json (see D.9)
            runtime = load_state()
            if runtime.get("alpha") is not None and state["alpha"] is None:
                state["alpha"] = runtime["alpha"]
            alpha = state["alpha"] if state["alpha"] is not None else \
                    runtime.get("alpha", 0.5)
            if alpha is None:
                alpha = 0.5   # D.22.4 best

            chunks = sorted(args.live_dir.glob("chunk_*.npz"))
            new_chunks = [p for p in chunks if p.name not in seen]
            for ck in new_chunks:
                seen.add(ck.name)

                # ── RX presence check (user 2026-07-01 policy) ──
                # Per-chunk: if any RX in rx_names is missing both arrays,
                # hard-fail with a clear FATAL banner. This is a hardware
                # issue the agent cannot fix — see dev_doc/7.
                present_rx, missing_rx = check_rx_presence(ck)
                if missing_rx and not args.allow_missing_rxs:
                    print("\n" + "=" * 72, file=sys.stderr, flush=True)
                    print("  [FATAL] RX BOARD DISCONNECT DETECTED",
                          file=sys.stderr, flush=True)
                    print("=" * 72, file=sys.stderr, flush=True)
                    print(f"  Chunk  : {ck.name}",
                          file=sys.stderr, flush=True)
                    print(f"  RX declared in chunk (rx_names): "
                          f"{present_rx + missing_rx}",
                          file=sys.stderr, flush=True)
                    print(f"  RX present : {present_rx}",
                          file=sys.stderr, flush=True)
                    print(f"  RX MISSING : {missing_rx}",
                          file=sys.stderr, flush=True)
                    print("", file=sys.stderr, flush=True)
                    print("  This is a HARDWARE issue "
                          "(USB cable / board power / chip).",
                          file=sys.stderr, flush=True)
                    print("  Agent cannot fix it. Please check the physical setup,",
                          file=sys.stderr, flush=True)
                    print("  re-plug the missing board, and re-run.",
                          file=sys.stderr, flush=True)
                    print("  To replay partial historical data, pass "
                          "--allow-missing-rxs", file=sys.stderr, flush=True)
                    print("  (NOT recommended for live use).",
                          file=sys.stderr, flush=True)
                    print("=" * 72 + "\n", file=sys.stderr, flush=True)
                    return 2
                elif missing_rx:
                    print(f"[warn {ck.name}] missing RX {missing_rx} "
                          f"(continuing in lenient mode)")

                try:
                    spec = chunk_to_cnn_spectrogram(ck)
                except Exception as exc:
                    print(f"[skip {ck.name}] CNN spec failed: {type(exc).__name__}",
                          file=sys.stderr)
                    continue

                cnn_prob = None
                cnn_time = None
                if spec is not None:
                    # CNN window covers whole 6 s chunk; center at +3 s offset.
                    x = torch.from_numpy(spec).unsqueeze(0).to(device)
                    with torch.no_grad():
                        logits = cnn_model(x)
                        cnn_prob = F.softmax(logits, dim=1)[0].cpu().numpy()
                    cnn_time = t_offset + 3.0

                # LSTM: compute features per 1 s window inside this chunk.
                try:
                    X_chunk, t_chunk = chunk_to_lstm_features(ck, t_offset)
                except Exception as exc:
                    print(f"[skip {ck.name}] LSTM feat failed: {type(exc).__name__}",
                          file=sys.stderr)
                    X_chunk = np.zeros((0,))

                for w_idx in range(len(X_chunk)):
                    feature_ring.append((X_chunk[w_idx], t_chunk[w_idx]))

                lstm_prob = None
                lstm_time = None
                seq = features_to_lstm_sequence(feature_ring)
                if seq is not None and mu is not None:
                    seq_norm = (seq - mu) / sd
                    x = torch.from_numpy(seq_norm).unsqueeze(0).to(device)
                    with torch.no_grad():
                        logits = lstm_model(x)
                        lstm_prob = F.softmax(logits, dim=1)[0].cpu().numpy()
                    lstm_time = feature_ring[-1][1]   # last window's center

                # Fuse: emit only when both available.
                if cnn_prob is not None and lstm_prob is not None:
                    ens = alpha * lstm_prob + (1.0 - alpha) * cnn_prob
                    cls = classes[int(np.argmax(ens))]
                    p_str = " ".join(f"{c[:5]:>5}={p:.3f}"
                                     for c, p in zip(classes, ens))
                    print(f"[{time.strftime('%H:%M:%S')}] "
                          f"LSTM(t={lstm_time:.1f}) CNN(t={cnn_time:.1f})  "
                          f"α={alpha:.2f}  cls={cls:<10}  {p_str}")
                elif cnn_prob is not None:
                    cls = classes[int(np.argmax(cnn_prob))]
                    p_str = " ".join(f"{c[:5]:>5}={p:.3f}"
                                     for c, p in zip(classes, cnn_prob))
                    print(f"[{time.strftime('%H:%M:%S')}] "
                          f"CNN-only (LSTM warming up t={cnn_time:.1f})  "
                          f"cls={cls:<10}  {p_str}")
                # else: nothing emitted this chunk (only happens if both paths
                # failed; very rare).

                t_offset += 6.0    # receiver writes non-overlapping 6 s chunks

            time.sleep(args.poll_sec)

    except KeyboardInterrupt:
        print("\n(stopped)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
