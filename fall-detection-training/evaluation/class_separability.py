#!/usr/bin/env python3
"""
class_separability.py — quick statistical sanity check.

For every labeled session under dataset/, compute simple per-class features
and see whether the classes are even separable using basic statistics. If
the LSTM is going to work, at least *some* of these should show clean
class differences. If they're all flat, the model has a much harder job.

Computes per (class, RX) windowed:
    1. robust variance (Hampel-clipped — same as dashboard_multi)
    2. max delta-variance across the window (motion-energy proxy)
    3. mean amplitude (subcarrier-averaged)

Then aggregates across the whole dataset.

Output:
    - Per-class table: mean / p10 / p50 / p90 of each feature
    - Pairwise separability: how cleanly each class pair can be split by
      a simple threshold on each feature (Cohen's d)
"""
import json
import numpy as np
from collections import defaultdict
from pathlib import Path


def robust_variance(amps_window, k_sigma=3.0):
    if amps_window.shape[0] < 5:
        return 0.0
    detrended = amps_window - amps_window.mean(axis=0, keepdims=True)
    mad = np.median(np.abs(detrended), axis=0, keepdims=True)
    clip = k_sigma * 1.4826 * np.maximum(mad, 1e-6)
    detrended = np.clip(detrended, -clip, clip)
    return float(np.mean(detrended * detrended))


def windowed_features(ts, amps, win_sec=1.0):
    """Sliding 1s windows with 0.5s hop. Yields (t_center, var, mean_amp)."""
    if len(ts) < 5:
        return
    fs = len(ts) / (ts[-1] - ts[0])
    win = max(int(win_sec * fs), 5)
    hop = max(win // 2, 1)
    for i in range(0, len(ts) - win, hop):
        chunk = amps[i : i + win]
        t_center = ts[i + win // 2]
        var = robust_variance(chunk)
        mean_amp = float(chunk.mean())
        yield t_center, var, mean_amp


def class_at(t, segments):
    """Find which class is active at time t."""
    for s in segments:
        if s["t_start"] <= t < s["t_end"]:
            return s["class"]
    return None


def main():
    sessions = sorted(Path("dataset").glob("*/"))
    if not sessions:
        print("No sessions in dataset/")
        return

    # Per (class, RX) -> list of (variance, mean_amp) tuples
    by_class_rx = defaultdict(lambda: defaultdict(list))
    n_sessions = 0

    for d in sessions:
        try:
            csi = np.load(d / "csi.npz")
            with open(d / "labels.json") as f:
                L = json.load(f)
        except FileNotFoundError:
            continue
        segments = L["segments"]
        rx_names = [str(n) for n in csi["rx_names"]]

        for name in rx_names:
            ts_key = f"timestamps_{name}"
            amp_key = f"amplitudes_{name}"
            if ts_key not in csi:
                continue
            ts = csi[ts_key]
            amps = csi[amp_key].astype(np.float32)
            for t_center, var, mean_amp in windowed_features(ts, amps):
                cls = class_at(t_center, segments)
                if cls is None:
                    continue
                by_class_rx[cls][name].append((var, mean_amp))

        n_sessions += 1

    classes = ["EMPTY", "STILL", "WALKING", "TRANSITION", "FALL"]
    rx_names_all = sorted({rx for cls in by_class_rx.values() for rx in cls})

    # ── Per-class, per-RX variance summary ──
    print(f"\nDataset: {n_sessions} sessions, {len(rx_names_all)} RXs")
    print()
    print("Per-class robust-variance summary — windowed (1s, 0.5s hop), median across subs")
    print("=" * 90)
    print(f"  {'class':<11} {'RX':<5} {'n_win':>6} {'p10':>8} {'p50':>8} {'p90':>8} {'mean':>8}  bar (relative to overall median)")
    print("-" * 90)

    # Compute global median for scaling
    all_vars = [v for cls in by_class_rx.values()
                for rx in cls.values() for v, _ in rx]
    global_med = float(np.median(all_vars)) if all_vars else 1.0

    for cls in classes:
        if cls not in by_class_rx:
            continue
        for rx in rx_names_all:
            data = by_class_rx[cls].get(rx, [])
            if not data:
                continue
            vs = np.array([d[0] for d in data])
            p10, p50, p90, mean = (
                float(np.percentile(vs, 10)),
                float(np.percentile(vs, 50)),
                float(np.percentile(vs, 90)),
                float(np.mean(vs)),
            )
            scale = max(int(40 * p50 / (global_med * 4)), 0)
            scale = min(scale, 40)
            bar = "█" * scale
            print(f"  {cls:<11} {rx:<5} {len(vs):>6} {p10:>8.2f} {p50:>8.2f} {p90:>8.2f} {mean:>8.2f}  {bar}")
        print()

    # ── Pairwise separability via Cohen's d on RX-averaged variance ──
    print()
    print("Pairwise class separability (Cohen's d on RX-mean variance, robust-var feature)")
    print("=" * 78)
    print("  d > 0.8 = large effect (easily distinguishable)")
    print("  d > 0.5 = medium effect (LSTM should handle)")
    print("  d < 0.2 = small effect (will be confused)")
    print()

    # Build per-window RX-mean variance per class
    per_class_v = {}
    for cls in classes:
        if cls not in by_class_rx:
            continue
        # Average variance across RXs per window — simple cross-RX summary
        rx_lists = list(by_class_rx[cls].values())
        if not rx_lists:
            continue
        # All RXs should have similar window count; take min
        n = min(len(lst) for lst in rx_lists)
        var_arrays = [np.array([lst[i][0] for i in range(n)]) for lst in rx_lists]
        rx_mean = np.mean(var_arrays, axis=0)
        per_class_v[cls] = rx_mean

    print(f"  {'class A':<12} vs {'class B':<12}  {'d':>8}  {'A med':>8}  {'B med':>8}  verdict")
    print("-" * 78)

    def cohens_d(a, b):
        a = np.asarray(a); b = np.asarray(b)
        sd = np.sqrt((a.std() ** 2 + b.std() ** 2) / 2)
        if sd < 1e-9:
            return 0.0
        return abs(a.mean() - b.mean()) / sd

    pairs = [
        ("EMPTY", "STILL"),
        ("EMPTY", "WALKING"),
        ("EMPTY", "FALL"),
        ("STILL", "WALKING"),
        ("STILL", "TRANSITION"),
        ("STILL", "FALL"),
        ("WALKING", "TRANSITION"),
        ("WALKING", "FALL"),
        ("TRANSITION", "FALL"),
    ]
    for a, b in pairs:
        if a not in per_class_v or b not in per_class_v:
            continue
        d = cohens_d(per_class_v[a], per_class_v[b])
        if d > 0.8: v = "LARGE — easy"
        elif d > 0.5: v = "MEDIUM — workable"
        elif d > 0.2: v = "SMALL — confused"
        else: v = "TINY — basically same"
        print(f"  {a:<12} vs {b:<12}  {d:>8.2f}  "
              f"{np.median(per_class_v[a]):>8.2f}  {np.median(per_class_v[b]):>8.2f}  {v}")

    # ── Per-RX usefulness ──
    print()
    print("Per-RX usefulness — Cohen's d for the most-confusable pair (STILL vs WALKING)")
    print("=" * 78)
    if "STILL" in by_class_rx and "WALKING" in by_class_rx:
        for rx in rx_names_all:
            s = np.array([d[0] for d in by_class_rx["STILL"].get(rx, [])])
            w = np.array([d[0] for d in by_class_rx["WALKING"].get(rx, [])])
            if len(s) == 0 or len(w) == 0:
                continue
            d = cohens_d(s, w)
            print(f"  {rx}: STILL median {float(np.median(s)):>7.2f}, "
                  f"WALKING median {float(np.median(w)):>7.2f}, d = {d:.2f}")

    print()
    print("If most pairs show MEDIUM or LARGE effect, the LSTM has plenty to work with.")
    print("If everything is TINY/SMALL, we have a feature-engineering problem to solve.")


if __name__ == "__main__":
    main()
