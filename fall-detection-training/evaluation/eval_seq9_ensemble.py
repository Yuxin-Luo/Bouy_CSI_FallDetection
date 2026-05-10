#!/usr/bin/env python3
"""
eval_seq9_ensemble.py — evaluate the shipped fall_impact_seq9_ensemble TorchScript
model against every recorded session in dataset_v2_high_tx/.

The model expects sequences of 9 consecutive band-spectrogram windows shaped
(9, 32, 49, 21). We build those sequences by reusing the spectrogram pipeline
from train_cnn_deep.py (so the windowing, STFT params, and per-channel
normalization match what the model was trained on).

Reports two metric families per session:

    Window-level
        precision / recall / F1 for FALL_IMPACT at each suggested threshold
        (0.50 = balanced demo, 0.84 = low-false-alert).

    Event-level (deployment metric)
        Each contiguous run of true FALL_IMPACT windows is one fall event.
        Each predicted alert is collapsed via the model's post-processing
        (merge_gap_sec, cooldown_sec). An alert counts as a true positive if
        its time falls within the model's window_duration_sec of any true
        event center, otherwise it's a false positive. Misses → false
        negatives.

No model weights are modified. Only inference + scoring.

Usage:
    .venv/bin/python eval_seq9_ensemble.py
    .venv/bin/python eval_seq9_ensemble.py --dataset dataset_v2_high_tx \\
        --model fall_impact_seq9_ensemble/fall_impact_seq9_ensemble.ts.pt \\
        --config fall_impact_seq9_ensemble/config.json
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch

# Reuse the exact spectrogram pipeline used during training.
from train_cnn_deep import extract_band_spectrograms_for_session


# ─────────────────────────────────────────────────────────────────────────────
# Sequence + label construction
# ─────────────────────────────────────────────────────────────────────────────

def build_sequences(X: np.ndarray, y_binary: np.ndarray, seq_len: int):
    """
    X         : (n_win, 32, 49, 21)
    y_binary  : (n_win,) ∈ {0, 1}; 1 = FALL_IMPACT
    seq_len   : 9 (per the shipped model)

    Returns:
        seqs        : (n_seq, seq_len, 32, 49, 21) float32
        seq_labels  : (n_seq,) — the label of the last window in each sequence
                                  (the "current time" the sequence predicts)
        seq_window_idx_end : (n_seq,) — index of the last window in each sequence
    """
    n_win = X.shape[0]
    n_seq = n_win - seq_len + 1
    if n_seq <= 0:
        return None
    # As-strided would be faster but float32 spectrograms are small here.
    seqs = np.stack([X[i:i + seq_len] for i in range(n_seq)]).astype(np.float32)
    seq_labels = y_binary[seq_len - 1:].astype(np.int64)
    seq_idx_end = np.arange(seq_len - 1, n_win, dtype=np.int64)
    return seqs, seq_labels, seq_idx_end


def window_centers(n_win: int, win_sec: float, hop_sec: float) -> np.ndarray:
    """Centers of the n_win consecutive windows, in seconds."""
    return win_sec * 0.5 + hop_sec * np.arange(n_win, dtype=np.float64)


# ─────────────────────────────────────────────────────────────────────────────
# Inference
# ─────────────────────────────────────────────────────────────────────────────

def run_inference(model, seqs: np.ndarray, device: str, batch_size: int = 32) -> np.ndarray:
    """
    Returns FALL_IMPACT probability per sequence (n_seq,).
    The TorchScript model is documented to return calibrated probabilities,
    so we just read column 1 (positive_class_index).
    """
    model.eval()
    out_probs = []
    with torch.no_grad():
        for i in range(0, len(seqs), batch_size):
            batch = torch.from_numpy(seqs[i:i + batch_size]).to(device)
            logits_or_probs = model(batch)
            arr = logits_or_probs.detach().cpu().float().numpy()
            # If the model returned logits instead of probs, softmax them.
            if arr.ndim != 2 or arr.shape[1] != 2:
                raise RuntimeError(f"Unexpected model output shape: {arr.shape}")
            row_sums = arr.sum(axis=1)
            looks_like_probs = (
                np.all(arr >= -1e-6) and np.all(arr <= 1.0 + 1e-6)
                and np.allclose(row_sums, 1.0, atol=1e-3)
            )
            if not looks_like_probs:
                # Model emitted logits — softmax them
                shifted = arr - arr.max(axis=1, keepdims=True)
                expd = np.exp(shifted)
                arr = expd / expd.sum(axis=1, keepdims=True)
            out_probs.append(arr[:, 1])
    return np.concatenate(out_probs)


# ─────────────────────────────────────────────────────────────────────────────
# Window-level metrics
# ─────────────────────────────────────────────────────────────────────────────

def window_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """Binary metrics for FALL_IMPACT (positive class = 1)."""
    tp = int(((y_true == 1) & (y_pred == 1)).sum())
    fp = int(((y_true == 0) & (y_pred == 1)).sum())
    fn = int(((y_true == 1) & (y_pred == 0)).sum())
    tn = int(((y_true == 0) & (y_pred == 0)).sum())
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    acc = (tp + tn) / max(1, tp + fp + fn + tn)
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn,
            "precision": p, "recall": r, "f1": f1, "accuracy": acc,
            "support_pos": tp + fn, "support_neg": tn + fp}


# ─────────────────────────────────────────────────────────────────────────────
# Event-level metrics (this is the deployment metric)
# ─────────────────────────────────────────────────────────────────────────────

def true_event_centers(seq_labels: np.ndarray, seq_times: np.ndarray) -> list[float]:
    """
    Group contiguous runs of FALL_IMPACT-labeled sequences into events.
    Returns a list of event centers (mean time of the run) in seconds.
    """
    events = []
    i = 0
    n = len(seq_labels)
    while i < n:
        if seq_labels[i] != 1:
            i += 1; continue
        j = i
        while j < n and seq_labels[j] == 1:
            j += 1
        events.append(float(seq_times[i:j].mean()))
        i = j
    return events


def collapse_alerts(seq_times: np.ndarray, seq_probs: np.ndarray, threshold: float,
                    merge_gap_sec: float, cooldown_sec: float) -> list[float]:
    """
    Apply the model's documented post-processing:
      1. Window predictions ≥ threshold are "raw alerts".
      2. Merge alerts whose times are within merge_gap_sec.
      3. After firing an alert, suppress new alerts for cooldown_sec.

    Returns a list of fired alert times (one per alert event).
    """
    raw_idx = np.where(seq_probs >= threshold)[0]
    if len(raw_idx) == 0:
        return []
    raw_times = seq_times[raw_idx]

    # Merge: walk through raw_times, group those within merge_gap of the
    # previous one's group.
    groups: list[list[float]] = [[float(raw_times[0])]]
    for t in raw_times[1:]:
        if t - groups[-1][-1] <= merge_gap_sec:
            groups[-1].append(float(t))
        else:
            groups.append([float(t)])
    merged_times = [g[0] for g in groups]  # use the first (earliest) of each group

    # Cooldown: walk merged alerts in time order, fire the first, suppress
    # any that fall inside cooldown_sec of the last fired.
    fired: list[float] = []
    last_fire = -1e9
    for t in merged_times:
        if t - last_fire >= cooldown_sec:
            fired.append(t)
            last_fire = t
    return fired


def event_metrics(true_events: list[float], fired_alerts: list[float],
                  match_tolerance_sec: float = 6.0) -> dict:
    """
    For each fired alert: TP if any true event is within match_tolerance_sec,
    else FP. Each true event is matched at most once. Unmatched true events
    are FN.

    match_tolerance_sec defaults to 6.0 (= win_sec) — the alert is "right"
    if any part of its 6-second window overlaps the fall.
    """
    matched_truth = set()
    tp = 0
    fp = 0
    for t in fired_alerts:
        match = -1
        for j, te in enumerate(true_events):
            if j in matched_truth:
                continue
            if abs(te - t) <= match_tolerance_sec:
                match = j; break
        if match >= 0:
            matched_truth.add(match)
            tp += 1
        else:
            fp += 1
    fn = len(true_events) - len(matched_truth)
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    return {"tp": tp, "fp": fp, "fn": fn,
            "precision": p, "recall": r, "f1": f1,
            "n_true_events": len(true_events),
            "n_fired_alerts": len(fired_alerts)}


# ─────────────────────────────────────────────────────────────────────────────
# Per-session evaluation
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_session(session_dir: Path, labels_file: str, model, device: str,
                     cfg: dict) -> dict | None:
    """Returns metrics dict or None if session has no fall windows / too short."""
    csi_path = session_dir / "csi.npz"
    labels_path = session_dir / labels_file
    if not csi_path.exists() or not labels_path.exists():
        return None

    spec = extract_band_spectrograms_for_session(
        csi_path, labels_path,
        win_sec=cfg["post_processing"]["window_duration_sec"],
        hop_sec=cfg["post_processing"]["window_hop_sec"],
        nperseg=96, noverlap=80, n_bands=8,
    )
    if spec is None:
        return None
    X, y, classes, rx_names = spec

    if "FALL_IMPACT" not in classes:
        return None
    fall_idx = classes.index("FALL_IMPACT")
    y_binary = (y == fall_idx).astype(np.int64)

    seq_len = cfg["post_processing"]["seq_len"]
    win_sec = cfg["post_processing"]["window_duration_sec"]
    hop_sec = cfg["post_processing"]["window_hop_sec"]
    merge_gap = cfg["post_processing"]["merge_gap_sec"]
    cooldown = cfg["post_processing"]["cooldown_sec"]

    built = build_sequences(X, y_binary, seq_len)
    if built is None:
        return None
    seqs, seq_labels, seq_idx_end = built
    centers = window_centers(X.shape[0], win_sec, hop_sec)
    seq_times = centers[seq_idx_end]  # time at end-of-sequence (the "now" the model predicts)

    probs = run_inference(model, seqs, device=device)

    true_events = true_event_centers(seq_labels, seq_times)

    out: dict = {
        "session": session_dir.name,
        "n_seq": int(len(seq_labels)),
        "n_pos_seq": int(seq_labels.sum()),
        "n_true_events": len(true_events),
        "thresholds": {},
    }
    for thr_name, thr in cfg["thresholds"].items():
        y_pred = (probs >= thr).astype(np.int64)
        win_m = window_metrics(seq_labels, y_pred)
        fired = collapse_alerts(seq_times, probs, thr, merge_gap, cooldown)
        evt_m = event_metrics(true_events, fired, match_tolerance_sec=win_sec)
        out["thresholds"][thr_name] = {
            "threshold": thr,
            "window": win_m,
            "event": evt_m,
            "n_fired_alerts": len(fired),
        }
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Aggregate + pretty print
# ─────────────────────────────────────────────────────────────────────────────

def fmt_pct(x: float) -> str:
    return f"{100*x:5.1f}%"


def print_per_threshold_table(results: list[dict], thr_name: str, level: str):
    """Print per-session table at a given threshold for either 'window' or 'event'."""
    print()
    print("=" * 96)
    print(f"  {level.upper()}-LEVEL  •  threshold = {thr_name} "
          f"({results[0]['thresholds'][thr_name]['threshold']:.2f})")
    print("=" * 96)
    if level == "event":
        hdr = f"  {'session':<28} {'n_true':>7} {'fired':>6} {'TP':>4} {'FP':>4} {'FN':>4}  {'prec':>6} {'rec':>6} {'F1':>6}"
    else:
        hdr = f"  {'session':<28} {'n_pos':>7} {'TP':>4} {'FP':>4} {'FN':>4} {'TN':>5}  {'prec':>6} {'rec':>6} {'F1':>6}"
    print(hdr)
    print("-" * 96)

    precs, recs, f1s = [], [], []
    tot_tp = tot_fp = tot_fn = 0
    for r in results:
        m = r["thresholds"][thr_name][level]
        if level == "event":
            n_true = m["n_true_events"]
            fired = m["n_fired_alerts"]
            print(f"  {r['session']:<28} {n_true:>7} {fired:>6} "
                  f"{m['tp']:>4} {m['fp']:>4} {m['fn']:>4}  "
                  f"{fmt_pct(m['precision'])} {fmt_pct(m['recall'])} {fmt_pct(m['f1'])}")
        else:
            n_pos = m["support_pos"]
            print(f"  {r['session']:<28} {n_pos:>7} "
                  f"{m['tp']:>4} {m['fp']:>4} {m['fn']:>4} {m['tn']:>5}  "
                  f"{fmt_pct(m['precision'])} {fmt_pct(m['recall'])} {fmt_pct(m['f1'])}")
        precs.append(m["precision"]); recs.append(m["recall"]); f1s.append(m["f1"])
        tot_tp += m["tp"]; tot_fp += m["fp"]; tot_fn += m["fn"]

    def stat(values):
        if not values:
            return ("—", "—")
        n = len(values); mean = sum(values) / n
        std = (sum((v - mean) ** 2 for v in values) / max(1, n - 1)) ** 0.5
        return (f"{mean*100:5.1f}%", f"±{std*100:4.1f}%")

    p_mean, p_std = stat(precs); r_mean, r_std = stat(recs); f_mean, f_std = stat(f1s)
    print("-" * 96)
    print(f"  {'PER-SESSION MEAN':<28} {'':>7} {'':>6} {'':>4} {'':>4} {'':>4}  "
          f"{p_mean:>6} {r_mean:>6} {f_mean:>6}")
    print(f"  {'PER-SESSION STD ':<28} {'':>7} {'':>6} {'':>4} {'':>4} {'':>4}  "
          f"{p_std:>6} {r_std:>6} {f_std:>6}")
    # Pooled (micro) — sum TP/FP/FN across sessions, then compute
    p_pool = tot_tp / (tot_tp + tot_fp) if (tot_tp + tot_fp) else 0
    r_pool = tot_tp / (tot_tp + tot_fn) if (tot_tp + tot_fn) else 0
    f_pool = 2 * p_pool * r_pool / (p_pool + r_pool) if (p_pool + r_pool) else 0
    print(f"  {'POOLED (micro)':<28} {'':>7} {'':>6} "
          f"{tot_tp:>4} {tot_fp:>4} {tot_fn:>4} {'':>5}  "
          f"{fmt_pct(p_pool)} {fmt_pct(r_pool)} {fmt_pct(f_pool)}")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset", type=Path, default=Path("dataset_v2_high_tx"))
    p.add_argument("--labels", type=str, default="labels_v2.json")
    p.add_argument("--model", type=Path,
                   default=Path("fall_impact_seq9_ensemble/fall_impact_seq9_ensemble.ts.pt"))
    p.add_argument("--config", type=Path,
                   default=Path("fall_impact_seq9_ensemble/config.json"))
    p.add_argument("--device", type=str, default="auto",
                   choices=["auto", "cpu", "mps", "cuda"])
    p.add_argument("--batch-size", type=int, default=32)
    p.add_argument("--out", type=Path, default=Path("eval_seq9_ensemble_results.json"),
                   help="Write per-session metrics JSON here.")
    args = p.parse_args()

    if not args.model.exists():
        print(f"ERROR: model not found at {args.model}", file=sys.stderr)
        return 2
    if not args.config.exists():
        print(f"ERROR: config not found at {args.config}", file=sys.stderr)
        return 2

    cfg = json.load(open(args.config))
    print(f"Model: {args.model}")
    print(f"  classes:           {cfg['classes']}")
    print(f"  positive class:    {cfg['classes'][cfg['positive_class_index']]}")
    print(f"  input shape:       {cfg['input_shape']}")
    print(f"  thresholds:        {cfg['thresholds']}")
    print(f"  post_processing:   {cfg['post_processing']}")
    if "evaluation_summary" in cfg:
        print(f"  shipped eval (window_test_default at 0.50):")
        s = cfg["evaluation_summary"]["window_test_default"]
        print(f"    impact P/R/F1 = {s['impact_precision']:.3f} / "
              f"{s['impact_recall']:.3f} / {s['impact_f1']:.3f}, "
              f"macro-F1 {s['macro_f1']:.3f}")
    print()

    device = args.device
    if device == "auto":
        # Prefer CUDA → MPS → CPU. The shipped model has float64 constants
        # which MPS can't host, so MPS attempts will fall back to CPU.
        if torch.cuda.is_available(): device = "cuda"
        elif torch.backends.mps.is_available(): device = "mps"
        else: device = "cpu"
    print(f"Device: {device}")

    try:
        model = torch.jit.load(str(args.model), map_location=device)
    except (TypeError, RuntimeError) as exc:
        print(f"  ({device} load failed: {type(exc).__name__}: {str(exc)[:120]})")
        print(f"  → falling back to CPU")
        device = "cpu"
        model = torch.jit.load(str(args.model), map_location="cpu")
    model.eval()
    print(f"Model loaded. Evaluating sessions in {args.dataset}/ ...")
    print()

    sessions = sorted([d for d in args.dataset.iterdir()
                       if d.is_dir() and d.name.startswith("subj")])
    if not sessions:
        print(f"No sessions found.", file=sys.stderr); return 2

    results = []
    t0 = time.time()
    for s in sessions:
        # Skip sessions with no FALL_IMPACT — they won't have any positives
        labels_path = s / args.labels
        if not labels_path.exists():
            print(f"  ({s.name}: skip — no {args.labels})"); continue
        with open(labels_path) as f:
            L = json.load(f)
        n_falls = sum(1 for seg in L["segments"]
                      if seg["class"] in ("FALL", "FALL_IMPACT"))
        if n_falls == 0:
            print(f"  ({s.name}: skip — 0 fall events)"); continue

        print(f"  → {s.name} ...", end=" ", flush=True)
        r = evaluate_session(s, args.labels, model, device, cfg)
        if r is None:
            print("(no result)"); continue
        results.append(r)
        print(f"n_seq={r['n_seq']}  n_true_events={r['n_true_events']}")

    print(f"\nEvaluated {len(results)} sessions in {time.time()-t0:.1f}s")

    # Pretty tables
    for thr_name in cfg["thresholds"]:
        print_per_threshold_table(results, thr_name, level="event")
        print_per_threshold_table(results, thr_name, level="window")

    # Save JSON
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "w") as f:
        json.dump({"config": cfg, "per_session": results}, f, indent=2)
    print(f"\n  ✓ wrote per-session metrics → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
