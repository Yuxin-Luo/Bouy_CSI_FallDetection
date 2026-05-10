#!/usr/bin/env python3
"""
csi_io.py — shared CSI reading utilities.

Single source of truth for:
  • parse_csi_line()  — extract per-subcarrier amplitudes from one CSI line
  • MultiPortReader   — read N serial ports in ONE thread via selectors
                        (avoids the GIL contention and per-thread scheduling
                        overhead that throttles multi-RX captures on macOS)

Used by:
  • dashboard_multi.py
  • capture_multi.py
"""
from __future__ import annotations

import re
import selectors
import threading
import time
from collections import deque
from typing import Iterable

import numpy as np
import serial


_CSI_ARRAY_RE = re.compile(r"\[([-\d,\s]+)\]")


def parse_csi_line(line: str):
    """Extract amplitudes from one CSI_DATA line. Returns ndarray or None."""
    m = _CSI_ARRAY_RE.search(line)
    if not m:
        return None
    try:
        ints = np.array(
            [int(t) for t in m.group(1).split(",") if t.strip()],
            dtype=np.int16,
        )
    except Exception:
        return None
    if ints.size < 2 or ints.size % 2 != 0:
        return None
    re_part = ints[0::2].astype(np.float32)
    im_part = ints[1::2].astype(np.float32)
    return np.sqrt(re_part * re_part + im_part * im_part)


class MultiPortReader(threading.Thread):
    """
    Reads from multiple serial ports in a single thread using selectors.

    Why this beats the per-port-thread approach:
      • One thread = no GIL contention between readers
      • selectors uses kqueue on macOS / epoll on Linux — the OS tells us
        which port has data ready, so we never block on any one port
      • Reads in 4096-byte chunks instead of one line at a time → way less
        per-call overhead
      • Lines are parsed only when we actually have a complete line in the
        per-port partial-line buffer

    Public surface:
      reader.buffers[name]        deque of (t_monotonic, amplitudes)
      reader.packet_counts[name]  int — total parsed packets for this RX
      reader.last_errors[name]    str | None — last error if any
      reader.stop_event           threading.Event — set to signal stop
      reader.start() / .join()    standard Thread methods
    """

    def __init__(
        self,
        port_specs: Iterable[tuple[str, str]],
        baud: int = 921600,
        buffer_size: int = 20_000,
        chunk_size: int = 4096,
        select_timeout: float = 0.1,
    ):
        """
        port_specs    : iterable of (port_path, rx_name) tuples
        baud          : serial baud rate (csi_recv firmware uses 921600)
        buffer_size   : max records retained per RX (0 = unlimited)
        chunk_size    : bytes to read per .read() call when data is ready
        select_timeout: how long to wait in selector.select() per loop
        """
        super().__init__(daemon=True)
        self.port_specs = list(port_specs)
        self.baud = baud
        self.chunk_size = chunk_size
        self.select_timeout = select_timeout
        maxlen = buffer_size if buffer_size > 0 else None

        # Public, name-keyed maps so consumers can subscribe by RX name
        self.buffers: dict[str, deque] = {
            name: deque(maxlen=maxlen) for _, name in self.port_specs
        }
        self.packet_counts: dict[str, int] = {
            name: 0 for _, name in self.port_specs
        }
        self.last_errors: dict[str, str | None] = {
            name: None for _, name in self.port_specs
        }
        self.stop_event = threading.Event()

        # Internal state, populated when run() starts
        self._sel: selectors.BaseSelector | None = None
        self._sers: list[tuple[serial.Serial, str]] = []
        self._partial: dict[str, bytearray] = {}

    # ── public helpers ──

    def opened_names(self) -> list[str]:
        """Names of RXs that successfully opened. Available after .start()."""
        return [n for n, err in self.last_errors.items() if err is None]

    def total_packets(self) -> int:
        return sum(self.packet_counts.values())

    # ── thread loop ──

    def _open_ports(self) -> None:
        self._sel = selectors.DefaultSelector()
        for path, name in self.port_specs:
            try:
                # timeout=0 → fully non-blocking; selectors decides when to read
                ser = serial.Serial(path, self.baud, timeout=0)
            except serial.SerialException as exc:
                self.last_errors[name] = f"could not open {path}: {exc}"
                continue
            try:
                self._sel.register(ser, selectors.EVENT_READ, data=name)
            except (ValueError, KeyError) as exc:
                self.last_errors[name] = f"could not register {path}: {exc}"
                ser.close()
                continue
            self._sers.append((ser, name))
            self._partial[name] = bytearray()

    def run(self) -> None:
        self._open_ports()
        if not self._sers:
            return

        try:
            while not self.stop_event.is_set():
                events = self._sel.select(timeout=self.select_timeout)
                for key, _mask in events:
                    ser: serial.Serial = key.fileobj  # type: ignore[assignment]
                    name: str = key.data  # type: ignore[assignment]
                    try:
                        chunk = ser.read(self.chunk_size)
                    except serial.SerialException as exc:
                        self.last_errors[name] = f"read error: {exc}"
                        continue
                    if not chunk:
                        continue
                    self._partial[name].extend(chunk)
                    self._drain_lines(name)
        finally:
            self._cleanup()

    def _drain_lines(self, name: str) -> None:
        """Pull complete (newline-terminated) lines out of the per-port buffer."""
        buf = self._partial[name]
        # Process all complete lines at once
        while True:
            nl = buf.find(b"\n")
            if nl < 0:
                break
            line_bytes = bytes(buf[:nl])
            del buf[: nl + 1]
            if not line_bytes.startswith(b"CSI_DATA"):
                continue
            try:
                line = line_bytes.decode("utf-8", errors="replace").strip()
            except Exception:
                continue
            amps = parse_csi_line(line)
            if amps is None:
                continue
            self.buffers[name].append((time.monotonic(), amps))
            self.packet_counts[name] += 1

    def _cleanup(self) -> None:
        if self._sel is not None:
            try:
                self._sel.close()
            except Exception:
                pass
        for ser, _ in self._sers:
            try:
                ser.close()
            except Exception:
                pass
        self._sers = []
