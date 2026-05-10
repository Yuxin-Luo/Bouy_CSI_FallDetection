#!/usr/bin/env python3
"""
csi_har_adapter.py — convert the CSI-HAR-Dataset (Moshiri et al., Nexmon-on-Pi)
into per-recording session folders compatible with our training pipeline.

For each (user, activity, sample) recording in CSI-HAR, this writes:

    dataset/csi_har_user_X_sample_Y_<activity>/
        csi.npz             ← (4 RXs replicated from the single source channel)
        labels_v2.json      ← in our 6-class label space
        metadata.json       ← origin: "csi_har" so the trainer can split by source

What's done to bridge the hardware gap:
    • Time resample 90 Hz (CSI-HAR native) → 70 Hz (our ESP32 rate).
      Configurable via --target-rate.
    • Subcarrier resample 52 → 192 via cubic interpolation along the
      subcarrier axis. Both datasets cover ~20 MHz so this is a coarse but
      principled mapping.
    • Single channel replicated as 4 identical RXs. Lossy w.r.t. cross-RX
      patterns (the CNN/LSTM cannot learn spatial diversity from CSI-HAR),
      but it lets the same feature extractor and model architecture run
      unchanged on both datasets. Fine-tuning on our real 4-RX data later
      restores the spatial information.
    • CSI-HAR class set mapped to our 6-class set:
        bend, sitdown, standup → TRANSITION
        fall                   → FALL_IMPACT (first 1.5s) + FLOORED (rest)
        lie down               → FLOORED
        walk, run              → WALKING
      (CSI-HAR has no equivalent of EMPTY or STILL — those classes will
      remain dominated by your own-data examples after merging.)

Usage:
    python csi_har_adapter.py
    python csi_har_adapter.py --target-rate 70 --overwrite
    python csi_har_adapter.py --source 'Csi_date_HAR/ CSI-HAR-Dataset '
"""
import argparse
import json
import os
import sys
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import numpy as np

try:
    import pandas as pd
except ImportError:
    raise SystemExit("pandas required:  pip install pandas")
try:
    from scipy.signal import resample
    from scipy.interpolate import interp1d
except ImportError:
    raise SystemExit("scipy required:  pip install scipy")


# ─────────────────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────────────────

# CSI-HAR estimated sample rate. They don't publish an exact rate per file,
# but a typical 906-row file at 10s activity duration → ~90 Hz.
CSI_HAR_SOURCE_RATE_HZ = 90.0

# Number of subcarriers in CSI-HAR (52 = 802.11n data subcarriers in HT20).
CSI_HAR_SUBS = 52

# Match our pipeline (we use this in extract_features_for_session).
TARGET_SUBS = 192

# Mapping CSI-HAR activity → our class.
# "fall" gets special treatment: FALL_IMPACT for the first impact_sec then FLOORED.
CSI_HAR_TO_OURS = {
    "bend":     "TRANSITION",
    "sitdown":  "TRANSITION",
    "standup":  "TRANSITION",
    "fall":     "FALL_SPECIAL",   # marker — handled in adapt_recording
    "lie down": "FLOORED",
    "walk":     "WALKING",
    "run":      "WALKING",
}

# Our 6-class label space (matches labels_v2.json from split_fall_labels.py)
CLASSES_V2 = {
    "0": "EMPTY",
    "1": "STILL",
    "2": "WALKING",
    "3": "TRANSITION",
    "4": "FALL_IMPACT",
    "5": "FLOORED",
}


# ─────────────────────────────────────────────────────────
# Per-recording adapter
# ─────────────────────────────────────────────────────────

def adapt_recording(csv_path: Path, annotation_path: Path,
                    target_rate: float, target_subs: int,
                    impact_sec: float = 1.5):
    """
    Read one CSI-HAR recording (data CSV + annotation CSV) and return a dict
    with resampled CSI + segments in our 6-class format. Returns None if the
    activity isn't in our mapping.
    """
    raw = pd.read_csv(csv_path, header=None).values.astype(np.float32)
    if raw.ndim != 2 or raw.shape[1] < 10:
        return None  # Malformed file
    n_in = raw.shape[0]
    if n_in < 30:
        return None

    # Annotation file: one column, activity name per row (all the same per file).
    annotations = pd.read_csv(annotation_path, header=None).values.flatten()
    if len(annotations) == 0:
        return None
    activity = str(annotations[0]).strip()
    target_class = CSI_HAR_TO_OURS.get(activity)
    if target_class is None:
        return None

    # ── Time resample (~90 Hz → target_rate) ──
    duration_sec = n_in / CSI_HAR_SOURCE_RATE_HZ
    n_out = max(int(duration_sec * target_rate), 30)
    time_resampled = resample(raw, n_out, axis=0)  # (n_out, 52)

    # ── Subcarrier resample (52 → 192) via cubic interpolation ──
    if target_subs != CSI_HAR_SUBS:
        x_old = np.linspace(0.0, 1.0, CSI_HAR_SUBS)
        x_new = np.linspace(0.0, 1.0, target_subs)
        interp = interp1d(x_old, time_resampled, kind="cubic",
                          axis=1, fill_value="extrapolate")
        sub_resampled = interp(x_new).astype(np.float32)
    else:
        sub_resampled = time_resampled

    # ── Synthetic timestamps in seconds ──
    ts = np.arange(n_out, dtype=np.float64) / target_rate
    final_t = float(ts[-1]) + 1.0 / target_rate

    # ── Map activity → segments in our class space ──
    if target_class == "FALL_SPECIAL":
        impact_end = min(impact_sec, final_t)
        segments = [{"t_start": 0.0, "t_end": round(impact_end, 4),
                     "class": "FALL_IMPACT"}]
        if final_t > impact_end:
            segments.append({"t_start": round(impact_end, 4),
                             "t_end":   round(final_t, 4),
                             "class":   "FLOORED"})
    else:
        segments = [{"t_start": 0.0, "t_end": round(final_t, 4),
                     "class": target_class}]

    return {
        "amplitudes": sub_resampled,    # (n_out, target_subs)
        "timestamps": ts,
        "segments": segments,
        "duration": final_t,
        "activity": activity,
        "n_in": n_in,
        "n_out": n_out,
    }


def write_session(session_dir: Path, recording: dict, source_csv_name: str,
                  session_name: str, target_rate: float, impact_sec: float):
    """Write the adapted recording as a session folder."""
    session_dir.mkdir(parents=True, exist_ok=True)

    # Replicate the single channel into 4 RXs (architectural compatibility)
    save_dict = {
        "rx_names": np.array(["RX1", "RX2", "RX3", "RX4"], dtype="U16"),
        "session_duration_sec": np.array(recording["duration"], dtype=np.float64),
    }
    for name in ["RX1", "RX2", "RX3", "RX4"]:
        save_dict[f"timestamps_{name}"] = recording["timestamps"]
        save_dict[f"amplitudes_{name}"] = recording["amplitudes"]
    np.savez_compressed(session_dir / "csi.npz", **save_dict)

    # Labels in v2 format
    labels_doc = {
        "version": 2,
        "classes": CLASSES_V2,
        "split_from": "csi_har_adapter",
        "impact_sec": impact_sec,
        "segments": recording["segments"],
        "session_duration_sec": recording["duration"],
    }
    with open(session_dir / "labels_v2.json", "w") as f:
        json.dump(labels_doc, f, indent=2)

    # Metadata
    metadata = {
        "version": 1,
        "session_name": session_name,
        "started_at_iso": datetime.now().isoformat(timespec="seconds"),
        "duration_sec": recording["duration"],
        "paused_total_sec": 0.0,
        "subject": session_name.split("user_")[1].split("_")[0]
                   if "user_" in session_name else "csi_har_unknown",
        "notes": f"converted from CSI-HAR: {source_csv_name}",
        "origin": "csi_har",                       # ← key flag for trainer
        "source_activity": recording["activity"],
        "rx_specs": [
            {"name": rx, "port": "synthetic_csi_har",
             "n_packets": recording["n_out"], "rate_hz": float(target_rate),
             "n_subcarriers": int(recording["amplitudes"].shape[1]),
             "warning": "single channel replicated 4x"}
            for rx in ["RX1", "RX2", "RX3", "RX4"]
        ],
        "host": {"platform": "csi_har_adapter", "python": "n/a"},
        "fall_guard_sec": impact_sec,
        "class_set": list(CLASSES_V2.values()),
    }
    with open(session_dir / "metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)


# ─────────────────────────────────────────────────────────
# Worker function (top-level so it pickles for multiprocessing)
# ─────────────────────────────────────────────────────────

def _convert_one(job: dict) -> dict:
    """Worker: convert one CSI-HAR recording. Returns a result dict."""
    try:
        rec = adapt_recording(
            Path(job["csv_path"]), Path(job["anno_path"]),
            target_rate=job["target_rate"],
            target_subs=job["target_subs"],
            impact_sec=job["impact_sec"],
        )
        if rec is None:
            return {"status": "skip_unmapped",
                    "session_name": job["session_name"]}
        write_session(
            Path(job["session_dir"]), rec, job["csv_name"],
            job["session_name"],
            target_rate=job["target_rate"],
            impact_sec=job["impact_sec"],
        )
        return {
            "status": "ok",
            "session_name": job["session_name"],
            "activity": rec["activity"],
            "duration": rec["duration"],
            "segments": [s["class"] for s in rec["segments"]],
            "secs_by_class": {s["class"]: s["t_end"] - s["t_start"]
                              for s in rec["segments"]},
        }
    except Exception as exc:
        return {"status": "error", "session_name": job["session_name"],
                "error": f"{type(exc).__name__}: {exc}"}


# ─────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--source", type=str,
        default="Csi_date_HAR/ CSI-HAR-Dataset ",
        help="Path to CSI-HAR-Dataset folder. Note the trailing space in the "
             "default — that's how the folder unzipped on your Mac.",
    )
    parser.add_argument("--out-root", type=Path, default=Path("dataset"),
                        help="Output dataset root (default: ./dataset/)")
    parser.add_argument("--prefix", type=str, default="csi_har_",
                        help="Session-name prefix (default: csi_har_)")
    parser.add_argument("--target-rate", type=float, default=70.0,
                        help="Resample to this rate in Hz (default 70 = our ESP32 rate)")
    parser.add_argument("--impact-sec", type=float, default=1.5,
                        help="First N seconds of each fall labeled FALL_IMPACT, "
                             "rest as FLOORED. Default 1.5 (matches your "
                             "split_fall_labels.py setting).")
    parser.add_argument("--overwrite", action="store_true",
                        help="Overwrite existing session folders.")
    parser.add_argument("--workers", type=int, default=0,
                        help="Parallel worker processes. 0 = auto "
                             "(min(8, cpu_count)). 1 = serial. "
                             "Higher values speed up first run; cached "
                             "sessions are skipped before scheduling, so "
                             "this only matters when --overwrite is set "
                             "or for new sessions.")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.exists():
        print(f"ERROR: source folder not found: {source}", file=sys.stderr)
        return 2

    activity_dirs = sorted([d for d in source.iterdir() if d.is_dir()])
    if not activity_dirs:
        print(f"ERROR: no activity subfolders in {source}", file=sys.stderr)
        return 2

    workers = args.workers
    if workers <= 0:
        workers = min(8, os.cpu_count() or 1)

    print(f"CSI-HAR adapter")
    print(f"  source: {source}")
    print(f"  → out:  {args.out_root}/{args.prefix}*")
    print(f"  target rate: {args.target_rate} Hz   target subs: {TARGET_SUBS}")
    print(f"  fall impact window: {args.impact_sec}s")
    print(f"  workers: {workers}")
    print()

    # ── First pass: enumerate jobs (skipping ones already on disk) ──
    jobs = []
    n_total = 0; n_skipped_existing = 0; n_skipped_no_anno = 0
    for act_dir in activity_dirs:
        data_files = sorted(
            f for f in act_dir.glob("*.csv") if "Annotation" not in f.name
        )
        for csv in data_files:
            n_total += 1
            anno_name = "Annotation_" + csv.name.replace("_A.csv", ".csv")
            anno_path = act_dir / anno_name
            if not anno_path.exists():
                n_skipped_no_anno += 1
                continue

            stem = csv.stem
            if stem.endswith("_A"):
                stem = stem[:-2]
            session_name = args.prefix + stem.replace(" ", "_")
            session_dir = args.out_root / session_name
            if session_dir.exists() and not args.overwrite:
                n_skipped_existing += 1
                continue

            jobs.append({
                "csv_path": str(csv),
                "csv_name": csv.name,
                "anno_path": str(anno_path),
                "session_dir": str(session_dir),
                "session_name": session_name,
                "target_rate": args.target_rate,
                "target_subs": TARGET_SUBS,
                "impact_sec": args.impact_sec,
            })

    print(f"  Pre-scan: {n_total} total CSVs   {len(jobs)} to process   "
          f"{n_skipped_existing} already cached   {n_skipped_no_anno} missing annotations")
    print()
    if not jobs:
        print("Nothing to do — all sessions already adapted. "
              "Pass --overwrite to force re-adapt.")
        return 0

    # ── Process jobs (parallel if workers > 1) ──
    activity_counts: dict[str, int] = defaultdict(int)
    by_class_secs: dict[str, float] = defaultdict(float)
    n_written = 0; n_errors = 0; n_unmapped = 0
    t0 = datetime.now()

    if workers == 1:
        # Serial path
        for i, job in enumerate(jobs):
            res = _convert_one(job)
            if res["status"] == "ok":
                n_written += 1
                activity_counts[res["activity"]] += 1
                for cls, dur in res["secs_by_class"].items():
                    by_class_secs[cls] += dur
                if n_written <= 3 or n_written % 60 == 0:
                    print(f"  ✓ [{i+1}/{len(jobs)}] {res['session_name']}  "
                          f"({res['activity']} → {'+'.join(res['segments'])})")
            elif res["status"] == "error":
                n_errors += 1
                print(f"  ✗ {res['session_name']}: {res['error']}")
            else:
                n_unmapped += 1
    else:
        # Parallel path
        with ProcessPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_convert_one, j): j for j in jobs}
            done = 0
            for fut in as_completed(futures):
                done += 1
                res = fut.result()
                if res["status"] == "ok":
                    n_written += 1
                    activity_counts[res["activity"]] += 1
                    for cls, dur in res["secs_by_class"].items():
                        by_class_secs[cls] += dur
                    if n_written <= 3 or n_written % 60 == 0 or done == len(jobs):
                        print(f"  ✓ [{done}/{len(jobs)}] {res['session_name']}  "
                              f"({res['activity']} → {'+'.join(res['segments'])})")
                elif res["status"] == "error":
                    n_errors += 1
                    print(f"  ✗ {res['session_name']}: {res['error']}")
                else:
                    n_unmapped += 1
    elapsed = (datetime.now() - t0).total_seconds()
    print()
    print(f"  Done in {elapsed:.1f}s   "
          f"({n_written} written, {n_errors} errors, {n_unmapped} unmapped)")

    n_skipped = n_skipped_existing + n_skipped_no_anno + n_unmapped
    print()
    print(f"Results: {n_written} written, {n_skipped} skipped "
          f"(of which {n_skipped_existing} already cached, "
          f"{n_skipped_no_anno} missing annotations, "
          f"{n_unmapped} unmapped activities), "
          f"{n_errors} errors. Total CSVs scanned: {n_total}")
    print()
    print(f"  By activity:")
    for act, count in sorted(activity_counts.items()):
        print(f"    {act:<12}  {count:>3}  → {CSI_HAR_TO_OURS.get(act, '?')}")
    print()
    print(f"  By output class (seconds added):")
    for cls in ["EMPTY", "STILL", "WALKING", "TRANSITION", "FALL_IMPACT", "FLOORED"]:
        print(f"    {cls:<13}  {by_class_secs.get(cls, 0):>7.1f}s")
    print()
    print(f"  Reminder: feature cache is per-session, so the trainer will only")
    print(f"  extract features for the new {n_written} sessions on its next run,")
    print(f"  not for your existing {len(list(args.out_root.glob('subj01_*')))} sessions.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
