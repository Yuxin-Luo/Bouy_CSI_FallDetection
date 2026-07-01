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

# Make pc_tools/ importable so we can share common/state.py with infer_loop.py.
# Both scripts live as siblings under src/pc_tools/, so adding their parent
# resolves `from common.state import load_state` regardless of cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np

# Sibling script in the same package directory
from csi_io import MultiPortReader
# Runtime-tunable params (chunk_sec, keep_last) — see dev_doc §D.9
from common.state import load_state


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
    ap.add_argument("--chunk-sec", type=float, default=None,
                    help="Seconds of CSI per NPZ chunk. Default = runtime_state.json. "
                         "**Note**: with shipped Bouy model's STFT (nperseg=96, "
                         "noverlap=80), chunk_sec MUST be ≥2s — see dev_doc §D.10.")
    # Resolve out-dir relative to project root so this works from any cwd:
    #   <project>/src/pc_tools/receiver/receiver.py
    #   <project>/data/live/
    _PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
    ap.add_argument("--out-dir", type=Path, default=_PROJECT_ROOT / "data" / "live",
                    help="Where to write chunk_*.npz files (default <project>/data/live/)")
    ap.add_argument("--keep-last", type=int, default=None,
                    help="Keep at most this many recent chunks on disk. "
                         "Default = runtime_state.json.")
    ap.add_argument("--expected-rx", type=int, default=None,
                    help="Expected number of RX boards (default: from state.json or detect). "
                         "Warns if fewer ports opened — avoids silent 3-RX chunks that "
                         "the shipped model (32 channels = 4 × 8 bands) can't consume.")
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

    # Initial runtime-tunable values; will be reloaded every iteration from
    # config/runtime_state.json (see dev_doc §D.9).
    runtime = load_state()
    print(f"Chunk size : {runtime['chunk_sec']:.1f}s   Keep last: {runtime['keep_last']}  "
          f"(edit config/runtime_state.json to retune at runtime)")
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
    # Model expects 4 RX × 8 bands = 32 channels. Running with fewer produces
    # spectrograms the shipped model can't consume (shape mismatch at forward).
    expected_rx = int(runtime["expected_rx"]) if args.expected_rx is None else args.expected_rx
    n_opened = len(living_names)
    if n_opened < expected_rx:
        print(f"WARNING: only {n_opened} of {expected_rx} expected RX boards opened.",
              file=sys.stderr)
        print(f"         Chunks will have {n_opened} columns instead of {expected_rx}; "
              f"infer_loop will skip them.", file=sys.stderr)
        print(f"         Wait for all {expected_rx} boards to enumerate, then restart.",
              file=sys.stderr)

    chunk_idx = 0
    last_chunk_time = time.monotonic()
    # `runtime` was loaded just above for the startup print. Now extract the
    # numeric values for the streaming loop (will be reloaded every iteration).
    chunk_sec = float(runtime["chunk_sec"])
    keep_last = int(runtime["keep_last"])
    print(f"Streaming... Ctrl-C to stop.")
    print(f"  Initial: chunk_sec={chunk_sec:.2f}s  keep_last={keep_last}  "
          f"(edit config/runtime_state.json to retune at runtime)\n")

    try:
        while True:
            # Poll runtime state for any tuning changes — no I/O unless
            # mtime changed (mtime cache inside load_state).
            runtime = load_state()
            chunk_sec = float(runtime["chunk_sec"])
            keep_last = int(runtime["keep_last"])

            now = time.monotonic()
            if now - last_chunk_time >= chunk_sec:
                # Seal a chunk: take last chunk_sec seconds from each RX
                cutoff = now - chunk_sec
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
                    final_name = (
                        f"{args.name_prefix}_"
                        f"{datetime.now().strftime('%Y%m%d_%H%M%S')}"
                        f"_{chunk_idx:04d}.npz"
                    )
                    final_path = args.out_dir / final_name
                    # Atomic-write pattern: write to .tmp first, then rename.
                    # np.savez_compressed() is NOT atomic — it streams the zip
                    # while open. Without this, infer_loop can np.load() a
                    # half-written file and crash with zipfile.BadZipFile
                    # (race we hit on 2026-06-30, see dev_doc §D.8).
                    # os.replace() on POSIX (and Win since py3.3) is atomic;
                    # readers only ever see the final file or no file.
                    #
                    # GOTCHA: np.savez_compressed(path_string_or_Path)
                    # auto-appends ".npz" if the path doesn't end in .npz.
                    # We want tmp at "<basename>.npz.tmp" exactly, so we open
                    # the file ourselves in binary write mode and pass the fd.
                    tmp_path = args.out_dir / (final_name + ".tmp")
                    with open(tmp_path, "wb") as tmp_fd:
                        np.savez_compressed(tmp_fd, **save)
                    tmp_path.replace(final_path)
                    size_kb = final_path.stat().st_size / 1024
                    n_frames_total = sum(
                        save[f"amplitudes_{n}"].shape[0]
                        for _, n in port_specs if f"amplitudes_{n}" in save
                    )
                    print(
                        f"  [{datetime.now().strftime('%H:%M:%S')}] "
                        f"chunk #{chunk_idx:04d}  "
                        f"frames={n_frames_total:>4}  "
                        f"size={size_kb:>5.0f} KB  "
                        f"→ {final_path.name}",
                        flush=True,
                    )

                    # Auto-cleanup: keep only the most recent keep_last chunks.
                    # Uses current-state value (tunable at runtime).
                    chunks = sorted(args.out_dir.glob(f"{args.name_prefix}_*.npz"))
                    for old in chunks[:-keep_last]:
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