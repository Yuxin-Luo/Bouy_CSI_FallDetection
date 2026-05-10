#!/usr/bin/env python3
"""
check_boards.py — quick per-RX health check.

Runs a short read from every detected USB serial port and reports:
  • is the port openable?
  • is CSI flowing?
  • at what rate?
  • verdict: HEALTHY / DEGRADED / DEAD

Note on thresholds:
  The csi_recv firmware nominally sends at ~70/s but the per-port observed
  rate naturally varies between ~45/s and ~75/s depending on USB-CDC
  scheduling, channel conditions, and which 8-second window you happen to
  catch. We treat ≥45/s as healthy — anything well below that means the
  cable, connector, or board is suspect.

Usage:
    python check_boards.py
    python check_boards.py --duration 10
"""
import argparse
import glob
import sys
import time

from csi_io import MultiPortReader


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=float, default=8.0,
                        help="seconds to read per port (default 8; shorter "
                             "windows have too much per-port rate variance "
                             "to trust the verdict)")
    parser.add_argument("--baud", type=int, default=921600)
    args = parser.parse_args()

    ports = sorted(glob.glob("/dev/cu.usbserial*") + glob.glob("/dev/cu.SLAB*"))
    if not ports:
        print("No USB serial ports detected.")
        return 1

    print(f"Checking {len(ports)} port(s) for {args.duration:.0f}s...\n")
    for p in ports:
        print(f"  {p}")
    print()

    port_specs = [(p, f"P{i+1}") for i, p in enumerate(ports)]
    reader = MultiPortReader(port_specs, baud=args.baud, buffer_size=0)
    reader.start()

    start = time.monotonic()
    while time.monotonic() - start < args.duration:
        time.sleep(0.5)
        elapsed = time.monotonic() - start
        bar_len = 30
        filled = int(bar_len * (elapsed / args.duration))
        bar = "█" * filled + "░" * (bar_len - filled)
        counts = " ".join(f"{n}:{reader.packet_counts.get(n, 0):>3}"
                          for _, n in port_specs)
        print(f"\r  [{bar}]  {elapsed:4.1f}s   {counts}", end="", flush=True)

    reader.stop_event.set()
    reader.join(timeout=1.5)

    print("\n")
    print(f"{'port':<32} {'name':<5} {'pkts':>5} {'rate':>9} {'verdict':<12}")
    print("-" * 70)
    for path, name in port_specs:
        err = reader.last_errors.get(name)
        n = reader.packet_counts.get(name, 0)
        rate = n / args.duration
        if err:
            verdict = "OPEN-ERROR"
        elif n == 0:
            verdict = "DEAD"
        elif rate < 15:
            verdict = "DEGRADED"
        elif rate < 45:
            verdict = "MARGINAL"
        else:
            verdict = "HEALTHY ✓"
        print(f"  {path:<30} {name:<5} {n:>5} {rate:>5.1f}/s {verdict:<12}")
        if err:
            print(f"      → {err}")

    print()
    healthy = [n for _, n in port_specs
               if reader.packet_counts.get(n, 0) / args.duration >= 45
               and reader.last_errors.get(n) is None]
    if not healthy:
        print("  ⚠ No boards in healthy state.")
    elif len(healthy) < len(port_specs):
        bad = [n for _, n in port_specs if n not in healthy]
        print(f"  ⚠ Healthy: {len(healthy)}/{len(port_specs)}.  "
              f"Investigate: {', '.join(bad)}")
        print(f"     (try a different cable, reseat USB-C, or swap with a spare board)")
    else:
        print(f"  ✓ All {len(port_specs)} boards healthy.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
