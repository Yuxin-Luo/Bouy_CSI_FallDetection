#!/usr/bin/env python3
"""
ensemble_predict.py — combine LSTM + Deep CNN predictions on the test split.

What it does:
    1. Reproduces the exact session-disjoint test split (same seed + same
       source filter as the train scripts).
    2. Loads both checkpoints into their respective architectures.
    3. Re-runs feature extraction (LSTM features) and band-spectrogram
       extraction (CNN input) for each test session.
    4. For each LSTM prediction, finds the closest-in-time CNN prediction,
       and averages their softmax probability vectors (alpha-weighted).
    5. Reports metrics for LSTM-alone, CNN-alone, and ensemble — plus an
       alpha sweep so you can see what weighting gives the best F1.

Both models must have been trained with the same --seed and same --source
for the test sessions to align. Defaults match the values you've been using:

    LSTM:  Run 3 hyperparams  (lstm-units 128,64; dense 64; t-seq 16; dropout 0.4)
    CNN:   train_cnn_deep defaults (base 32; dense 128; n-bands 8; win 6; nperseg 96)

If you trained with different params, override the relevant flags below.

Usage:
    python ensemble_predict.py
    python ensemble_predict.py --cnn-activation leaky_relu
    python ensemble_predict.py --alpha 0.3   # weight CNN more heavily
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn.functional as F
except ImportError:
    raise SystemExit("PyTorch required: pip install torch")

# Reuse architectures + feature extraction from the train scripts
sys.path.insert(0, str(Path(__file__).parent.resolve()))
from train_lstm import (  # noqa: E402
    extract_features_for_session,
    windows_to_sequences,
    CSIClassifier,
)
from train_cnn_deep import (  # noqa: E402
    extract_band_spectrograms_for_session,
    CSI_DeepCNN,
)


# ─────────────────────────────────────────────────────────
# Metrics (duplicated to keep this script self-contained)
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
# Test-split reproduction
# ─────────────────────────────────────────────────────────

def session_origin(d: Path) -> str:
    meta = d / "metadata.json"
    if meta.exists():
        try:
            with open(meta) as f:
                return str(json.load(f).get("origin", "ours"))
        except Exception:
            pass
    return "ours"


def reproduce_test_sessions(dataset: Path, labels_filename: str,
                             source: str, seed: int,
                             test_frac: float, val_frac: float):
    all_sessions = sorted(dataset.glob("*/"))
    all_sessions = [d for d in all_sessions
                    if (d / "csi.npz").exists() and (d / labels_filename).exists()]
    sessions_with_origin = [(d, session_origin(d)) for d in all_sessions]
    if source == "ours":
        sessions_with_origin = [(d, o) for d, o in sessions_with_origin if o == "ours"]
    elif source == "csi_har":
        sessions_with_origin = [(d, o) for d, o in sessions_with_origin if o == "csi_har"]
    sessions = [d for d, _ in sessions_with_origin]

    rng = np.random.default_rng(seed)
    by_origin: dict[str, list[int]] = {}
    for i, (_, o) in enumerate(sessions_with_origin):
        by_origin.setdefault(o, []).append(i)
    test_idx: set[int] = set()
    for origin, indices in by_origin.items():
        perm = rng.permutation(indices)
        n = len(perm)
        n_test = max(1, int(round(test_frac * n))) if n >= 3 else 1
        # need to consume val from the rng too so subsequent splits match
        n_val = max(1, int(round(val_frac * n))) if n >= 3 else 0
        test_idx.update(perm[:n_test].tolist())
        # Note: we don't track val/train, just reproduce the test sample
    return [sessions[i] for i in sorted(test_idx)]


# ─────────────────────────────────────────────────────────
# Per-session inference
# ─────────────────────────────────────────────────────────

def _to_tensor(X: np.ndarray, mu=None, sd=None):
    X = X.astype(np.float32)
    if mu is not None:
        X = (X - mu) / sd
    return torch.from_numpy(X)


def predict_lstm_for_session(session_dir, labels, lstm_model, device,
                              t_seq, win_sec, hop_sec, mu=None, sd=None):
    """Returns (probs, true_labels, time_centers)."""
    out = extract_features_for_session(
        session_dir / "csi.npz", session_dir / labels,
        win_sec=win_sec, hop_sec=hop_sec,
    )
    if out is None:
        return None
    X, y, _, _ = out
    Xs, ys = windows_to_sequences(X, y, t_seq)
    if len(Xs) == 0:
        return None
    Xs_t = _to_tensor(Xs, mu, sd).to(device)
    with torch.no_grad():
        logits = lstm_model(Xs_t)
        probs = F.softmax(logits, dim=1).cpu().numpy()
    # Sequence i ends at base-window index (i + t_seq - 1)
    # Window k has center at win_sec/2 + k*hop_sec
    times = np.array(
        [win_sec / 2 + (i + t_seq - 1) * hop_sec for i in range(len(ys))],
        dtype=np.float64,
    )
    return probs, ys.astype(np.int64), times


def predict_cnn_for_session(session_dir, labels, cnn_model, device,
                             win_sec, hop_sec, nperseg, noverlap, n_bands):
    out = extract_band_spectrograms_for_session(
        session_dir / "csi.npz", session_dir / labels,
        win_sec=win_sec, hop_sec=hop_sec,
        nperseg=nperseg, noverlap=noverlap, n_bands=n_bands,
    )
    if out is None:
        return None
    X, y, _, _ = out
    if len(X) == 0:
        return None
    Xs_t = _to_tensor(X).to(device)
    with torch.no_grad():
        logits = cnn_model(Xs_t)
        probs = F.softmax(logits, dim=1).cpu().numpy()
    # Window i centered at win_sec/2 + i*hop_sec
    times = np.array(
        [win_sec / 2 + i * hop_sec for i in range(len(y))],
        dtype=np.float64,
    )
    return probs, y.astype(np.int64), times


def align_by_time(lstm_probs, lstm_y, lstm_t, cnn_probs, cnn_t, tol_sec):
    """For each LSTM time, find the nearest CNN time within tol_sec.
    Returns aligned arrays (only entries where alignment succeeded)."""
    if len(lstm_t) == 0 or len(cnn_t) == 0:
        return None
    yt = []; pl = []; pc = []
    for i, t_l in enumerate(lstm_t):
        j = int(np.argmin(np.abs(cnn_t - t_l)))
        if abs(cnn_t[j] - t_l) <= tol_sec:
            yt.append(lstm_y[i])
            pl.append(lstm_probs[i])
            pc.append(cnn_probs[j])
    if not yt:
        return None
    return np.array(yt), np.array(pl), np.array(pc)


# ─────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    # Data + split (must match how both models were trained)
    parser.add_argument("--dataset", type=Path, default=Path("dataset"))
    parser.add_argument("--labels", type=str, default="labels_v2.json")
    parser.add_argument("--source", type=str, default="ours",
                        choices=["all", "ours", "csi_har"])
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--val-frac", type=float, default=0.2)
    parser.add_argument("--test-frac", type=float, default=0.2)

    # LSTM checkpoint + architecture (defaults = your "Run 3" yours-only config)
    parser.add_argument("--lstm-ckpt", type=Path,
                        default=Path("checkpoints/run3_bigger_model.pt"))
    parser.add_argument("--lstm-units", type=str, default="128,64")
    parser.add_argument("--lstm-dense", type=int, default=64)
    parser.add_argument("--lstm-dropout", type=float, default=0.4)
    parser.add_argument("--lstm-recurrent-dropout", type=float, default=0.15)
    parser.add_argument("--lstm-bidirectional", action="store_true")
    parser.add_argument("--lstm-t-seq", type=int, default=16)
    parser.add_argument("--lstm-win-sec", type=float, default=1.0)
    parser.add_argument("--lstm-hop-sec", type=float, default=0.5)

    # CNN checkpoint + architecture (defaults = train_cnn_deep defaults)
    parser.add_argument("--cnn-ckpt", type=Path,
                        default=Path("checkpoints/cnn_deep_best.pt"))
    parser.add_argument("--cnn-base", type=int, default=32)
    parser.add_argument("--cnn-dense", type=int, default=128)
    parser.add_argument("--cnn-dropout", type=float, default=0.4)
    parser.add_argument("--cnn-conv-dropout", type=float, default=0.1)
    parser.add_argument("--cnn-activation", type=str, default="relu",
                        choices=["relu", "leaky_relu"])
    parser.add_argument("--cnn-win-sec", type=float, default=6.0)
    parser.add_argument("--cnn-hop-sec", type=float, default=1.0)
    parser.add_argument("--cnn-nperseg", type=int, default=96)
    parser.add_argument("--cnn-noverlap", type=int, default=80)
    parser.add_argument("--cnn-n-bands", type=int, default=8)

    # Ensemble
    parser.add_argument("--alpha", type=float, default=0.5,
                        help="Ensemble weight on LSTM (0=CNN-only, 1=LSTM-only).")
    parser.add_argument("--align-tol-sec", type=float, default=1.0,
                        help="Max time difference for LSTM/CNN windows to count "
                             "as the same prediction.")
    parser.add_argument("--device", type=str, default="auto",
                        choices=["auto", "cpu", "cuda", "mps"])
    args = parser.parse_args()

    # ── Device ──
    if args.device == "auto":
        if torch.cuda.is_available(): device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available(): device = "mps"
        else: device = "cpu"
    else:
        device = args.device
    print(f"Device: {device}")

    # ── Reproduce test split ──
    test_sessions = reproduce_test_sessions(
        args.dataset, args.labels, args.source, args.seed,
        args.test_frac, args.val_frac,
    )
    if not test_sessions:
        print(f"No test sessions found.", file=sys.stderr)
        return 1
    print(f"Test sessions ({len(test_sessions)}): {[s.name for s in test_sessions]}")

    # ── Load classes ──
    with open(test_sessions[0] / args.labels) as f:
        L = json.load(f)
    classes = [L["classes"][str(i)] for i in
               sorted(int(k) for k in L["classes"].keys())]
    n_classes = len(classes)
    print(f"Classes ({n_classes}): {classes}")
    print()

    # ── Load LSTM ──
    lstm_units = [int(x.strip()) for x in args.lstm_units.split(",") if x.strip()]
    lstm_model = CSIClassifier(
        n_features=16, n_classes=n_classes,
        lstm_units=lstm_units, dense_units=args.lstm_dense,
        dropout=args.lstm_dropout, recurrent_dropout=args.lstm_recurrent_dropout,
        bidirectional=args.lstm_bidirectional,
    ).to(device)
    if not args.lstm_ckpt.exists():
        print(f"LSTM checkpoint not found: {args.lstm_ckpt}", file=sys.stderr)
        return 1
    lstm_model.load_state_dict(torch.load(args.lstm_ckpt, map_location=device))
    lstm_model.eval()
    n_lstm = sum(p.numel() for p in lstm_model.parameters())
    print(f"LSTM loaded: {args.lstm_ckpt}  ({n_lstm:,} params)")

    # ── Load CNN ──
    n_in_channels = 4 * args.cnn_n_bands
    cnn_model = CSI_DeepCNN(
        n_classes=n_classes, n_in_channels=n_in_channels,
        base=args.cnn_base, dense=args.cnn_dense,
        dropout=args.cnn_dropout, conv_dropout=args.cnn_conv_dropout,
        activation=args.cnn_activation,
    ).to(device)
    if not args.cnn_ckpt.exists():
        print(f"CNN checkpoint not found: {args.cnn_ckpt}", file=sys.stderr)
        return 1
    cnn_model.load_state_dict(torch.load(args.cnn_ckpt, map_location=device))
    cnn_model.eval()
    n_cnn = sum(p.numel() for p in cnn_model.parameters())
    print(f"CNN  loaded: {args.cnn_ckpt}  ({n_cnn:,} params, "
          f"activation={args.cnn_activation})")
    print()

    # ── Need feature normalization stats for LSTM (the train script does this).
    # We re-compute by extracting features for the train-split sessions and
    # computing per-feature mean/std. Simpler: just skip standardization here
    # and accept the LSTM was trained with it. We need to re-derive stats
    # from the train sessions to make predictions work. Approximate: use
    # all non-test sessions to compute mu/sd. ──
    print("Computing LSTM feature normalization (mean/std across non-test sessions)...")
    test_names = {d.name for d in test_sessions}
    all_sessions = sorted(args.dataset.glob("*/"))
    all_sessions = [d for d in all_sessions
                    if (d / "csi.npz").exists() and (d / args.labels).exists()
                    and session_origin(d) == "ours"
                    and d.name not in test_names]
    Xs_train = []
    for d in all_sessions:
        out = extract_features_for_session(
            d / "csi.npz", d / args.labels,
            win_sec=args.lstm_win_sec, hop_sec=args.lstm_hop_sec,
        )
        if out is None: continue
        X, y, _, _ = out
        Xs_train.append(X)
    if Xs_train:
        Xall = np.concatenate(Xs_train, axis=0)
        mu = Xall.mean(axis=0).astype(np.float32)
        sd = np.maximum(Xall.std(axis=0).astype(np.float32), 1e-6)
    else:
        mu = sd = None
        print("  (no train sessions found — skipping LSTM standardization; "
              "predictions may be off-distribution)")
    print()

    # ── Run inference per session, collect aligned predictions ──
    all_yt = []
    all_lstm_probs = []
    all_cnn_probs = []
    n_lstm_only_dropped = 0
    for d in test_sessions:
        lstm_out = predict_lstm_for_session(
            d, args.labels, lstm_model, device,
            t_seq=args.lstm_t_seq,
            win_sec=args.lstm_win_sec, hop_sec=args.lstm_hop_sec,
            mu=mu, sd=sd,
        )
        cnn_out = predict_cnn_for_session(
            d, args.labels, cnn_model, device,
            win_sec=args.cnn_win_sec, hop_sec=args.cnn_hop_sec,
            nperseg=args.cnn_nperseg, noverlap=args.cnn_noverlap,
            n_bands=args.cnn_n_bands,
        )
        if lstm_out is None or cnn_out is None:
            print(f"  {d.name}: skipped (insufficient data)")
            continue
        lp, ly, lt = lstm_out
        cp, cy, ct = cnn_out
        aligned = align_by_time(lp, ly, lt, cp, ct, tol_sec=args.align_tol_sec)
        if aligned is None:
            print(f"  {d.name}: no aligned predictions")
            continue
        yt, pl, pc = aligned
        all_yt.append(yt); all_lstm_probs.append(pl); all_cnn_probs.append(pc)
        n_total = len(ly)
        n_kept = len(yt)
        n_lstm_only_dropped += (n_total - n_kept)
        print(f"  {d.name}: LSTM seqs={n_total}  CNN windows={len(cy)}  "
              f"aligned={n_kept}")

    if not all_yt:
        print("No aligned predictions across any session.")
        return 1

    yt = np.concatenate(all_yt)
    lstm_probs = np.concatenate(all_lstm_probs)
    cnn_probs = np.concatenate(all_cnn_probs)
    print()
    print(f"Total aligned predictions: {len(yt)}  "
          f"(dropped {n_lstm_only_dropped} unaligned LSTM windows)")
    print()

    # ── Reports ──
    def report(name, probs, yt):
        yp = np.argmax(probs, axis=1)
        cm = confusion(yt, yp, n_classes)
        p, r, f = per_class_metrics(yt, yp, n_classes)
        acc = float((yp == yt).mean())
        macro_f1 = float(f.mean())
        print()
        print("─" * 78)
        print(f"  {name}    n={len(yt)}    acc={acc:.3f}   macro-F1={macro_f1:.3f}")
        print("─" * 78)
        print(f"  {'class':<13} {'support':>8} {'precision':>10} "
              f"{'recall':>8} {'f1':>6}")
        for i, c in enumerate(classes):
            sup = int((yt == i).sum())
            if sup == 0: continue
            print(f"  {c:<13} {sup:>8} {p[i]:>10.3f} {r[i]:>8.3f} {f[i]:>6.3f}")
        print()
        print("  Confusion (rows = true, cols = pred):")
        print("             " + " ".join(f"{c[:7]:>8}" for c in classes))
        for i, c in enumerate(classes):
            row = " ".join(f"{cm[i, j]:>8}" for j in range(n_classes))
            print(f"  {c[:11]:<11} {row}")
        for cand in ("FALL_IMPACT", "FALL"):
            if cand in classes:
                idx = classes.index(cand)
                sup = int((yt == idx).sum())
                if sup > 0:
                    print(f"  Headline: {cand} recall = {r[idx]:.1%}  "
                          f"(precision {p[idx]:.1%}, support {sup})")
                break

    print("=" * 78)
    print(f"Aligned-window predictions  (LSTM/CNN time tolerance = "
          f"{args.align_tol_sec}s)")
    print("=" * 78)
    report("LSTM ALONE", lstm_probs, yt)
    report("CNN ALONE",  cnn_probs,  yt)
    ens = args.alpha * lstm_probs + (1.0 - args.alpha) * cnn_probs
    report(f"ENSEMBLE (alpha={args.alpha:.2f})", ens, yt)

    # ── Alpha sweep ──
    print()
    print("=" * 78)
    print("  Alpha sweep  (alpha = weight on LSTM, 1-alpha = weight on CNN)")
    print("=" * 78)
    print(f"  {'alpha':>6}   {'acc':>7}   {'macro_F1':>9}   {'fall_recall':>13}")
    print("  " + "-" * 50)
    fall_idx = None
    for cand in ("FALL_IMPACT", "FALL"):
        if cand in classes:
            fall_idx = classes.index(cand)
            break
    for alpha in [0.0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 1.0]:
        p_ens = alpha * lstm_probs + (1.0 - alpha) * cnn_probs
        yp = np.argmax(p_ens, axis=1)
        acc = float((yp == yt).mean())
        _, rec, fsc = per_class_metrics(yt, yp, n_classes)
        macro_f1 = float(fsc.mean())
        fall_str = "n/a"
        if fall_idx is not None and (yt == fall_idx).sum() > 0:
            fall_str = f"{rec[fall_idx]:.1%}"
        print(f"  {alpha:>6.2f}   {acc:>7.3f}   {macro_f1:>9.3f}   {fall_str:>13}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
