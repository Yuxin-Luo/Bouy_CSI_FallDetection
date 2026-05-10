#!/usr/bin/env python3
"""
split_fall_labels.py — post-process labels.json files to split FALL into:
    FALL_IMPACT  — first IMPACT_SEC seconds of each FALL segment
    FLOORED      — the rest of each FALL segment (on the ground, post-impact)

The original labels.json is preserved. Output is written to labels_v2.json
in each session folder.

Why: under the "FALL = entire time on the ground" labeling convention,
~95% of FALL labels are actually post-impact stillness, which is
statistically indistinguishable from STILL. Splitting gives the model a
clean per-frame signal for FALL_IMPACT (the rapid descent) while preserving
the post-fall context as FLOORED.

Usage:
    python split_fall_labels.py
    python split_fall_labels.py --impact-sec 2.0 --output labels_v2.json
"""
import argparse
import json
from pathlib import Path


def split_segments(segments, impact_sec: float):
    """Replace each FALL segment with FALL_IMPACT (first impact_sec) + FLOORED (rest)."""
    out = []
    for s in segments:
        if s["class"] != "FALL":
            out.append(s)
            continue
        dur = s["t_end"] - s["t_start"]
        if dur <= impact_sec:
            # Whole segment fits inside the impact window
            out.append({
                "t_start": s["t_start"],
                "t_end":   s["t_end"],
                "class":   "FALL_IMPACT",
            })
            continue
        impact_end = s["t_start"] + impact_sec
        out.append({
            "t_start": s["t_start"],
            "t_end":   round(impact_end, 4),
            "class":   "FALL_IMPACT",
        })
        out.append({
            "t_start": round(impact_end, 4),
            "t_end":   s["t_end"],
            "class":   "FLOORED",
        })
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--dataset", type=Path, default=Path("dataset"),
                   help="Dataset root (default: ./dataset/)")
    p.add_argument("--impact-sec", type=float, default=1.5,
                   help="How many seconds at the start of each FALL "
                        "segment count as FALL_IMPACT (default: 1.5)")
    p.add_argument("--output", type=str, default="labels_v2.json",
                   help="Output filename inside each session folder "
                        "(default: labels_v2.json)")
    args = p.parse_args()

    sessions = sorted(args.dataset.glob("*/"))
    if not sessions:
        print(f"No sessions in {args.dataset}/")
        return 1

    print(f"Splitting FALL → FALL_IMPACT (first {args.impact_sec}s) + FLOORED")
    print(f"  dataset: {args.dataset}")
    print(f"  output:  {args.output} per session\n")

    classes_v2 = {
        "0": "EMPTY",
        "1": "STILL",
        "2": "WALKING",
        "3": "TRANSITION",
        "4": "FALL_IMPACT",
        "5": "FLOORED",
    }

    print(f"  {'session':<26} {'falls':>6} {'impact_s':>9} {'floored_s':>10}")
    print("-" * 60)
    for d in sessions:
        labels_path = d / "labels.json"
        if not labels_path.exists():
            continue
        with open(labels_path) as f:
            L = json.load(f)
        new_segs = split_segments(L["segments"], args.impact_sec)
        n_falls = sum(1 for s in L["segments"] if s["class"] == "FALL")
        impact_s = sum(s["t_end"] - s["t_start"]
                       for s in new_segs if s["class"] == "FALL_IMPACT")
        floored_s = sum(s["t_end"] - s["t_start"]
                        for s in new_segs if s["class"] == "FLOORED")
        out = {
            "version": 2,
            "classes": classes_v2,
            "split_from": "labels.json",
            "impact_sec": args.impact_sec,
            "segments": new_segs,
            "session_duration_sec": L.get("session_duration_sec"),
        }
        out_path = d / args.output
        with open(out_path, "w") as f:
            json.dump(out, f, indent=2)
        print(f"  {d.name:<26} {n_falls:>6} {impact_s:>8.1f}s {floored_s:>9.1f}s")
    print(f"\n✓ Wrote {args.output} into all session folders.")


if __name__ == "__main__":
    main()
