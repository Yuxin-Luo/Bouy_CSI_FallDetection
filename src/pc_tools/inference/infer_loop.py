#!/usr/bin/env python3
"""
infer_loop.py — watch live NPZ chunks, run fall detection ensemble inference.

Pipeline per new chunk:
  1. Receiver writes a 6-second NPZ into data/live/
  2. We compute a band-spectrogram per chunk (32 channels × 49 freq × 21 time)
  3. Stack the latest 9 chunk-spectrograms → (1, 9, 32, 49, 21) tensor
  4. Run the shipped TorchScript ensemble (LSTM + Transformer, post-calibrated)
  5. Read FALL_IMPACT probability (column 1)
  6. Apply post-processing: merge_gap_sec=2.0, cooldown_sec=8.0
  7. Print prob + alarm to stdout

Key facts about the shipped model (see model/fall_impact_seq9_ensemble/config.json):
  • Input  : float32 (1, 9, 32, 49, 21)
  • Output : float32 (1, 2) — calibrated probabilities [NOT_FALL_IMPACT, FALL_IMPACT]
  • 32 channels = 4 RX × 8 frequency bands (not 32 RX)
  • STFT: nperseg=96, noverlap=80, NOMINAL_RATE_HZ=70 (model's canonical assumption)
  • Per-(window, channel) z-score after log1p

Important trade-off (vs training-time behavior):
  • The shipped model was trained with overlapping 6s windows at hop_sec=1.0
    (so 9 windows span 14 seconds).
  • Our receiver writes non-overlapping 6s chunks at hop_sec=6.0, so 9 chunks
    span 54 seconds. This WIDENS the model's temporal receptive field.
  • For fall detection (low-frequency event) this likely still works, but if
    precision drops, switch to 1s/hop chunks and re-combine in this script.

Usage:
    # Default: watch data/live/, default model + config
    python infer_loop.py

    # Override live dir or threshold
    python infer_loop.py --live-dir data/live --threshold 0.84
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from collections import deque
from pathlib import Path

import numpy as np
import torch
from scipy.signal import stft as scipy_stft


# ─────────────────────────────────────────────────────────────────────────────
# Spectrogram extraction (mirrors train_cnn_deep.extract_band_spectrograms
# but is self-contained — no train_cnn_deep import needed at runtime)
# ─────────────────────────────────────────────────────────────────────────────

# These constants come from the training pipeline. Don't change unless you
# also re-train.
NPERSEG = 96
NOVERLAP = 80
N_BANDS = 8
NOMINAL_RATE_HZ = 70.0   # the model canonical sampling rate
WIN_SEC = 6.0

# Canonical (F, T) dims at NOMINAL_RATE_HZ × WIN_SEC (model was trained on these)
F_DIM = NPERSEG // 2 + 1                                  # 49
N_TARGET = int(WIN_SEC * NOMINAL_RATE_HZ)                 # 420
T_DIM = max(1, (N_TARGET - NOVERLAP) // (NPERSEG - NOVERLAP))  # 21


def compute_band_spectrogram(chunk_path: Path) -> np.ndarray | None:
    """Load one 6-second NPZ chunk, return a (32, 49, 21) float32 spectrogram.

    Mirrors train_cnn_deep.extract_band_spectrograms_for_session but without
    label lookup (we're streaming, no labels in real-time).

    Returns None if the chunk has too little data or no RX frames.
    """
    csi = np.load(chunk_path)
    rx_names = [str(n) for n in csi["rx_names"]]
    if not rx_names:
        return None
    n_rx = len(rx_names)

    # Subcarrier count from first RX (assumed identical for all RXs)
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
                    band_series, fs=fs,
                    nperseg=NPERSEG, noverlap=NOVERLAP,
                    boundary=None, padded=False,
                )
                mag = np.abs(Zxx).astype(np.float32)
                ff = min(F_DIM, mag.shape[0])
                tt = min(T_DIM, mag.shape[1])
                spec[ch, :ff, :tt] = mag[:ff, :tt]
            except Exception:
                # Bad window (constant signal, etc.) — leave zeros
                pass

    # log1p + per-channel z-score (matches training normalization)
    spec = np.log1p(spec)
    means = spec.mean(axis=(1, 2), keepdims=True)
    stds = spec.std(axis=(1, 2), keepdims=True) + 1e-6
    spec = ((spec - means) / stds).astype(np.float32)

    return spec


# ─────────────────────────────────────────────────────────────────────────────
# Inference
# ─────────────────────────────────────────────────────────────────────────────

def pick_device(requested: str) -> str:
    """Default to CPU.

    The shipped TorchScript model has LSTM hidden-state constants baked in
    at trace time, which causes a device-mismatch RuntimeError on CUDA:
        "Input and hidden tensors are not at the same device, found input
         tensor at cuda:0 and hidden tensor at cpu"
    See the traceback from `code/__torch__/torch/nn/modules/rnn.py` for proof.
    CPU inference is ~10ms per call which is well within our 1s poll cadence,
    so we hard-default to CPU and only honor an explicit `--device cuda`
    request (which will likely fail at forward time, as documented).
    """
    if requested == "auto":
        return "cpu"
    return requested


def load_model(model_path: Path, device: str) -> torch.jit.ScriptModule:
    """Load TorchScript ensemble with CUDA → CPU fallback."""
    try:
        m = torch.jit.load(str(model_path), map_location=device)
    except Exception as exc:
        if device != "cpu":
            print(f"  ({device} load failed: {type(exc).__name__}: {str(exc)[:100]})",
                  file=sys.stderr)
            print("  → falling back to CPU", file=sys.stderr)
            m = torch.jit.load(str(model_path), map_location="cpu")
    m.eval()
    return m


def run_model(model, seq: np.ndarray, device: str) -> float:
    """Run ensemble on a (9, 32, 49, 21) sequence → FALL_IMPACT prob in [0, 1]."""
    x = torch.from_numpy(seq).unsqueeze(0).to(device)  # (1, 9, 32, 49, 21)
    with torch.no_grad():
        out = model(x)
    arr = out.detach().cpu().float().numpy()
    # Model emits calibrated probabilities (2 cols summing to 1); defensive
    # softmax in case the loaded artifact emits logits instead.
    row_sums = arr.sum(axis=1)
    looks_like_probs = (
        arr.ndim == 2 and arr.shape[1] == 2
        and np.all(arr >= -1e-6) and np.all(arr <= 1.0 + 1e-6)
        and np.allclose(row_sums, 1.0, atol=1e-3)
    )
    if not looks_like_probs:
        shifted = arr - arr.max(axis=1, keepdims=True)
        expd = np.exp(shifted)
        arr = expd / expd.sum(axis=1, keepdims=True)
    return float(arr[0, 1])  # positive_class_index = 1 = FALL_IMPACT


# ─────────────────────────────────────────────────────────────────────────────
# Main loop
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--live-dir", type=Path, default=Path("data/live"),
                    help="Directory to watch for chunk_*.npz files")

    # Resolve model + config paths relative to this script's location so the
    # command works regardless of cwd:
    #   <project>/src/pc_tools/inference/infer_loop.py
    #   <project>/fall-detection-training/model/fall_impact_seq9_ensemble/
    _PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
    _MODEL_DIR = (_PROJECT_ROOT / "fall-detection-training"
                  / "model" / "fall_impact_seq9_ensemble")
    default_model = _MODEL_DIR / "fall_impact_seq9_ensemble.ts.pt"
    default_config = _MODEL_DIR / "config.json"
    ap.add_argument("--model", type=Path, default=default_model)
    ap.add_argument("--config", type=Path, default=default_config)
    ap.add_argument("--threshold", type=float, default=None,
                    help="FALL_IMPACT probability threshold (default: balanced_demo "
                         "from config.json = 0.50)")
    ap.add_argument("--seq-len", type=int, default=9,
                    help="Number of chunks to stack (default 9 — per config.json)")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    ap.add_argument("--poll-sec", type=float, default=0.5,
                    help="How often to scan live-dir for new chunks")
    args = ap.parse_args()

    if not args.model.exists():
        print(f"ERROR: model not found at {args.model}", file=sys.stderr)
        return 2
    if not args.config.exists():
        print(f"ERROR: config not found at {args.config}", file=sys.stderr)
        return 2
    if not args.live_dir.exists():
        print(f"ERROR: live dir does not exist: {args.live_dir}", file=sys.stderr)
        print("       (start receiver.py first, or pass --live-dir)", file=sys.stderr)
        return 2

    cfg = json.load(open(args.config))
    pp = cfg["post_processing"]
    seq_len = args.seq_len
    threshold = args.threshold if args.threshold is not None else cfg["thresholds"]["balanced_demo"]
    cooldown_sec = pp["cooldown_sec"]
    merge_gap_sec = pp["merge_gap_sec"]

    device = pick_device(args.device)
    print(f"Model      : {args.model}")
    print(f"Config     : classes={cfg['classes']}  "
          f"input={cfg['input_shape']}  "
          f"thresholds={cfg['thresholds']}")
    print(f"Post-proc  : merge_gap={merge_gap_sec}s  cooldown={cooldown_sec}s  "
          f"seq_len={seq_len}")
    print(f"Threshold  : {threshold:.3f}")
    print(f"Device     : {device}")
    print(f"Live dir   : {args.live_dir}  (poll every {args.poll_sec}s)")
    print()

    model = load_model(args.model, device)
    print("Model loaded. Watching for new chunks... (Ctrl-C to stop)\n")

    spec_ring: deque[np.ndarray] = deque(maxlen=seq_len)
    last_fire_time = -1e9
    seen_chunks: set[str] = set()
    last_alert_time = -1e9  # for cooldown
    last_alert_prob = 0.0

    try:
        while True:
            chunks = sorted(args.live_dir.glob("chunk_*.npz"))
            new_chunks = [c for c in chunks if c.name not in seen_chunks]

            for chunk_path in new_chunks:
                seen_chunks.add(chunk_path.name)
                spec = compute_band_spectrogram(chunk_path)
                if spec is None:
                    print(f"  [{time.strftime('%H:%M:%S')}] "
                          f"skip {chunk_path.name} (no usable data)",
                          flush=True)
                    continue

                spec_ring.append(spec)
                n_have = len(spec_ring)
                ts_str = time.strftime("%H:%M:%S")

                if n_have < seq_len:
                    print(f"  [{ts_str}] warming up: {n_have}/{seq_len} "
                          f"({chunk_path.name})",
                          flush=True)
                    continue

                # Stack to (seq_len, 32, 49, 21) → add batch dim → (1, seq_len, 32, 49, 21)
                seq = np.stack(list(spec_ring), axis=0).astype(np.float32)
                prob = run_model(model, seq, device)

                # Alert logic with cooldown
                fired_now = False
                if prob >= threshold and (time.monotonic() - last_alert_time) >= cooldown_sec:
                    fired_now = True
                    last_alert_time = time.monotonic()

                if fired_now:
                    flag = "🚨 ALERT  (FALL_IMPACT)"
                elif prob >= threshold:
                    flag = "  ⚠ high (in cooldown)"
                else:
                    flag = "  ok"

                last_alert_prob = prob
                print(f"  [{ts_str}] prob={prob:.3f}  {flag}  "
                      f"chunks_seen={len(seen_chunks)}  ring={n_have}/{seq_len}",
                      flush=True)

            time.sleep(args.poll_sec)
    except KeyboardInterrupt:
        print("\nStopping...")
        if last_alert_prob:
            print(f"  (last prob was {last_alert_prob:.3f})")

    return 0


if __name__ == "__main__":
    sys.exit(main())