#!/usr/bin/env python3
"""
capture_multi.py — fixed-duration multi-RX CSI capture, no GUI.

Just records all RX streams for N seconds and saves to one NPZ.
Used for diagnostic snippets, not full labeled sessions.

Usage:
    # Linux (ESP32-S3 native USB  →  /dev/ttyACM*)
    python capture_multi.py --duration 30 --out walking.npz
    python capture_multi.py --duration 60 --label "walking" --out walking.npz
    python capture_multi.py --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 ... --duration 30

    # macOS (legacy  →  /dev/cu.usbserial*)
    python capture_multi.py --port /dev/cu.usbserial-0001=RX1 ... --duration 30

Output (NPZ keys):
    rx_names                 : ["RX1", "RX2", ...]
    timestamps_<rx_name>     : float64 array per RX
    amplitudes_<rx_name>     : float32 (T, n_subcarriers)
    label                    : optional string
    started_at               : float64 (monotonic time)
"""
import argparse
import glob
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path

import numpy as np

from csi_io import MultiPortReader  # selectors-based shared reader


# Resolve default output dir relative to this script's location so it's
# stable regardless of cwd (same trick as receiver.py):
#   <project>/src/pc_tools/receiver/capture_multi.py
#   <project>/data/raw/
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DEFAULT_OUT_DIR = _PROJECT_ROOT / "data" / "raw"
_DEFAULT_OUT_DIR.mkdir(parents=True, exist_ok=True)


def parse_port_arg(arg, idx):
    if "=" in arg:
        path, name = arg.split("=", 1)
        return path.strip(), name.strip()
    return arg.strip(), f"RX{idx}"


def discover_ports():
    """Auto-discover CSI RX serial ports.

    Detection order (Linux-first, since ESP32-S3 native USB enumerates as ttyACM):
      1. /dev/ttyACM*   — ESP32-S3 native USB  ← most common for this project
      2. /dev/ttyUSB*   — CP2102/CH340 UART bridge (older ESP32 dev kits)
      3. /dev/cu.usbserial* / /dev/cu.SLAB* — macOS (kept for portability)
    """
    patterns = [
        "/dev/ttyACM*",   # Linux: ESP32-S3 native USB  ← our case
        "/dev/ttyUSB*",   # Linux: UART-bridge ESP32 dev kits
        "/dev/cu.usbserial*",
        "/dev/cu.SLAB*",
    ]
    found = []
    for pat in patterns:
        found.extend(glob.glob(pat))
    # Deduplicate while preserving order (a path shouldn't match two patterns,
    # but just in case)
    seen = set()
    unique = []
    for p in found:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return sorted(unique)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--port", action="append", default=[],
                        help="Serial port path, optionally suffixed with =RXname "
                             "(repeat for multiple RXs). If omitted, auto-discover "
                             "ttyACM*/ttyUSB* on Linux, cu.usbserial* on macOS.")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--duration", type=float, default=30.0)
    parser.add_argument("--label", type=str, default="")
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--start-delay", type=float, default=0.0,
                        help="Wait N seconds before recording (gives you time "
                             "to leave the room for empty-baseline captures)")
    args = parser.parse_args()

    if args.out is None:
        # Default goes under <project>/data/raw/ — anchored to script location,
        # not cwd, so it's stable across runs from different directories.
        # Pass --out explicitly to override (e.g. for one-off captures elsewhere).
        args.out = _DEFAULT_OUT_DIR / (
            f"capture_{datetime.now().strftime('%Y%m%d_%H%M%S')}.npz"
        )

    if args.port:
        port_specs = [parse_port_arg(p, i + 1) for i, p in enumerate(args.port)]
    else:
        ports = discover_ports()
        if not ports:
            print("ERROR: no USB serial ports found "
                  "(tried /dev/ttyACM*, /dev/ttyUSB*, /dev/cu.*).",
                  file=sys.stderr)
            return 2
        port_specs = [(p, f"RX{i+1}") for i, p in enumerate(ports)]

    print(f"Recording {args.duration:.0f}s from {len(port_specs)} RX(s) → {args.out}")
    if args.label:
        print(f"  label: '{args.label}'")
    print()
    for path, name in port_specs:
        print(f"  {name:<5} {path}")
    print()

    # Optional startup delay (e.g. so you can walk out for an empty-room capture)
    if args.start_delay > 0:
        for sec in range(int(args.start_delay), 0, -1):
            print(f"\r  Starting in {sec}s — leave the room now if recording empty baseline...",
                  end="", flush=True)
            time.sleep(1.0)
        print("\r" + " " * 70 + "\r", end="")

    # Single multiplexed reader (no buffer cap during capture so we don't drop)
    reader = MultiPortReader(port_specs, baud=args.baud, buffer_size=0)
    reader.start()
    time.sleep(0.6)

    # Report any port that failed to open
    for name, err in reader.last_errors.items():
        if err is not None:
            print(f"  ERROR {name}: {err}", file=sys.stderr)
    living_names = reader.opened_names()
    if not living_names:
        return 2

    started_at = time.monotonic()
    print("Recording... press Ctrl-C to stop early.")
    # Header so the compact column counts below have meaning.
    header = " ".join(f"{n:>4}" for _, n in port_specs if n in living_names)
    print(f"             elapsed       {header}")
    try:
        elapsed = 0.0
        while elapsed < args.duration:
            time.sleep(0.5)
            elapsed = time.monotonic() - started_at
            # Compact counts: just numbers, no labels — keeps the live line
            # under ~78 cols so the terminal doesn't wrap and strand
            # "RX4:1947" fragments from earlier frames.
            counts = " ".join(
                f"{reader.packet_counts.get(name, 0):>4}"
                for _, name in port_specs
                if name in living_names
            )
            bar_len = 20
            filled = int(bar_len * (elapsed / args.duration))
            bar = "█" * filled + "░" * (bar_len - filled)
            # \033[K clears from cursor to end of line so leftover chars
            # from earlier frames can't show through.
            print(f"\r  [{bar}] {elapsed:5.1f}/{args.duration:.0f}s  {counts}\033[K",
                  end="", flush=True)
    except KeyboardInterrupt:
        print("\n  (stopped early)")

    print()
    reader.stop_event.set()
    reader.join(timeout=1.5)

    # Build NPZ
    save_dict = {
        "rx_names": np.array(living_names, dtype="U16"),
        "label": np.array(args.label, dtype="U64"),
        "started_at": np.array(started_at, dtype=np.float64),
    }

    print()
    print(f"{'rx':<5} {'pkts':>6} {'rate':>8} {'sub':>4}")
    for name in living_names:
        records = list(reader.buffers[name])
        if not records:
            print(f"  {name:<5} (no packets)")
            continue
        # Filter to canonical subcarrier count (firmware can mix sizes)
        sizes = Counter(r[1].size for r in records)
        canonical = sizes.most_common(1)[0][0]
        records = [r for r in records if r[1].size == canonical]
        ts = np.array([r[0] for r in records], dtype=np.float64)
        amps = np.stack([r[1] for r in records], axis=0).astype(np.float32)
        rate = len(ts) / (ts[-1] - ts[0]) if len(ts) > 1 else 0.0
        print(f"  {name:<5} {len(ts):>6} {rate:>5.1f}/s {amps.shape[1]:>4}")
        save_dict[f"timestamps_{name}"] = ts
        save_dict[f"amplitudes_{name}"] = amps

    np.savez_compressed(args.out, **save_dict)
    size_mb = args.out.stat().st_size / 1024 / 1024
    print()
    print(f"  ✓ saved {size_mb:.1f} MB to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())