#!/usr/bin/env python3
"""
receiver.py — continuous 4-RX CSI capture, writes fixed-duration NPZ chunks.

This is the LIVE counterpart of capture_multi.py (which records a single fixed
file then exits). receiver.py never stops on its own; it keeps writing
6-second NPZ chunks into ``--out-dir`` so a separate inference process can
consume them as they appear.

Each chunk NPZ contains:
    rx_names                 : ["RX1", "RX2", ...]
    timestamps_<rx>          : float64 array (PC monotonic time per frame)
    amplitudes_<rx>          : float32 (T, 192)
    started_at               : float64 (monotonic time when chunk was sealed)
    chunk_idx                : int64  (sequential id)

Notes:
  • ESP32-S3 native USB enumerates as /dev/ttyACM* on Linux — that is what
    discover_ports() tries first; falls back to /dev/ttyUSB* (UART bridge),
    then macOS /dev/cu.* paths.
  • Each chunk is independent (not concatenated) so that downstream tools can
    load any single chunk without rebuilding a session.
  • Old chunks past ``--keep-last`` are auto-deleted so the live dir stays
    bounded. inference-side ring buffer keeps the latest 9 chunks in memory.

Usage:
    # Auto-discover 4 ports, write 6s chunks to data/live/, keep last 20
    python receiver.py

    # Explicit ports
    python receiver.py --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 ...
"""
from __future__ import annotations

import argparse
import glob
import sys
import time
from collections import deque
from datetime import datetime
from pathlib import Path

import numpy as np

# Sibling script in the same package directory
from csi_io import MultiPortReader


def discover_ports() -> list[str]:
    """Return sorted list of CSI RX serial ports, Linux/macOS aware.

    Order matters: ESP32-S3 native USB (ttyACM*) is checked first because
    that's what this project uses. Falls back to UART bridge (ttyUSB*) then
    macOS (/dev/cu.*) for portability.
    """
    patterns = [
        "/dev/ttyACM*",
        "/dev/ttyUSB*",
        "/dev/cu.usbserial*",
        "/dev/cu.SLAB*",
    ]
    found: list[str] = []
    for pat in patterns:
        found.extend(glob.glob(pat))
    seen, unique = set(), []
    for p in found:
        if p not in seen:
            seen.add(p); unique.append(p)
    return sorted(unique)


def parse_port_arg(arg: str, idx: int) -> tuple[str, str]:
    if "=" in arg:
        path, name = arg.split("=", 1)
        return path.strip(), name.strip()
    return arg.strip(), f"RX{idx}"


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("--port", action="append", default=[],
                    help="Serial port path, optionally suffixed with =RXname. "
                         "Repeat for multiple RXs. If omitted, auto-discover.")
    ap.add_argument("--baud", type=int, default=921600,
                    help="Serial baud (csi_recv firmware uses 921600)")
    ap.add_argument("--chunk-sec", type=float, default=6.0,
                    help="Seconds of CSI to seal per NPZ chunk (default 6)")
    # Resolve out-dir relative to project root so this works from any cwd:
    #   <project>/src/pc_tools/receiver/receiver.py
    #   <project>/data/live/
    _PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
    ap.add_argument("--out-dir", type=Path, default=_PROJECT_ROOT / "data" / "live",
                    help="Where to write chunk_*.npz files (default <project>/data/live/)")
    ap.add_argument("--keep-last", type=int, default=20,
                    help="Keep at most this many recent chunks (older auto-deleted)")
    ap.add_argument("--name-prefix", type=str, default="chunk",
                    help="Filename prefix (default 'chunk')")
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    # Resolve ports
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

    print(f"Receiving from {len(port_specs)} RX(s)")
    for path, name in port_specs:
        print(f"  {name:<5} {path}")
    print(f"Output dir : {args.out_dir}")
    print(f"Chunk size : {args.chunk_sec:.1f}s   Keep last: {args.keep_last}")
    print()

    # Start the multiplexed reader (single thread → no GIL contention)
    reader = MultiPortReader(port_specs, baud=args.baud, buffer_size=0)
    reader.start()
    time.sleep(0.6)

    # Report which ports opened cleanly
    for name, err in reader.last_errors.items():
        if err is not None:
            print(f"  ERROR {name}: {err}", file=sys.stderr)
    living_names = reader.opened_names()
    if not living_names:
        print("ERROR: no RXs opened cleanly; aborting.", file=sys.stderr)
        return 2

    chunk_idx = 0
    last_chunk_time = time.monotonic()
    print("Streaming... Ctrl-C to stop.\n")

    try:
        while True:
            now = time.monotonic()
            if now - last_chunk_time >= args.chunk_sec:
                # Seal a chunk: take last chunk_sec seconds from each RX
                cutoff = now - args.chunk_sec
                save: dict[str, np.ndarray] = {
                    "rx_names": np.array(living_names, dtype="U16"),
                    "started_at": np.array(now, dtype=np.float64),
                    "chunk_idx": np.array(chunk_idx, dtype=np.int64),
                }
                any_data = False
                for path, name in port_specs:
                    if name not in living_names:
                        continue
                    records = list(reader.buffers[name])
                    recent = [(t, a) for t, a in records if t >= cutoff]
                    if not recent:
                        continue
                    ts = np.array([t for t, _ in recent], dtype=np.float64)
                    amps = np.stack([a for _, a in recent], axis=0).astype(np.float32)
                    save[f"timestamps_{name}"] = ts
                    save[f"amplitudes_{name}"] = amps
                    any_data = True

                if any_data:
                    fname = args.out_dir / (
                        f"{args.name_prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                        f"_{chunk_idx:04d}.npz"
                    )
                    np.savez_compressed(fname, **save)
                    size_kb = fname.stat().st_size / 1024
                    n_frames_total = sum(
                        save[f"amplitudes_{n}"].shape[0]
                        for _, n in port_specs if f"amplitudes_{n}" in save
                    )
                    print(
                        f"  [{datetime.now().strftime('%H:%M:%S')}] "
                        f"chunk #{chunk_idx:04d}  "
                        f"frames={n_frames_total:>4}  "
                        f"size={size_kb:>5.0f} KB  "
                        f"→ {fname.name}",
                        flush=True,
                    )

                    # Auto-cleanup: keep only the most recent keep_last chunks
                    chunks = sorted(args.out_dir.glob(f"{args.name_prefix}_*.npz"))
                    for old in chunks[:-args.keep_last]:
                        old.unlink()

                    chunk_idx += 1

                last_chunk_time = now

            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        reader.stop_event.set()
        reader.join(timeout=1.5)

    return 0


if __name__ == "__main__":
    sys.exit(main())