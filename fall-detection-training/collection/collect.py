#!/usr/bin/env python3
"""
collect.py — labeling-friendly multi-RX CSI recorder.

Records continuous CSI from all connected RX boards while you press keys to
mark which class is currently happening. Saves a single session per run as
three sidecar files under ``dataset/<session_name>/``:

    csi.npz       — full continuous capture (per-RX timestamps + amplitudes)
    labels.json   — list of {t_start, t_end, class} segments (session-relative time)
    metadata.json — session info: RXs, ports, packet stats, started_at, etc.

Why a separate tool from capture_multi.py:
    capture_multi.py records ONE label per file. For LSTM training we need
    a label timeline within a single continuous recording, plus a
    keyboard-driven UI to flip between classes in real time.

Class set (configured at the top of this file — keep stable across sessions
or your dataset becomes inconsistent):
    0 EMPTY        no person in the space
    1 STILL        person present but stationary
    2 WALKING      sustained ambulation
    3 TRANSITION   sit↔stand, lying↔sitting, slow body shifts
    4 FALL         rapid descent + impact

Controls (all via the matplotlib window):
    0..4   set the current label at the moment of the keypress
    f      alias for 4 (FALL) — convenient one-letter shortcut
    space  pause/resume label timeline (CSI keeps recording, segment frozen)
    u      undo the most recent label change
    q      save & quit
    Ctrl-C save & quit (also saves on window close)

Usage:
    python collect.py --session jane_session1
    python collect.py --session walking_only --duration 120
    python collect.py --session falls_yoga_mat --subject jane --notes "carpet, 1pm"

Tips:
    • Default starting label is EMPTY. Press '1' once you're in the room and
      ready to record STILL.
    • For falls onto a yoga mat: hit '4' or 'f' the moment you start
      committing to the fall. The marker lands at the keypress instant; the
      FALL segment runs until the next class key.
    • Press the next class key (usually '1' STILL) once you're settled on
      the ground so FALL doesn't keep growing into the post-fall stillness.
    • Sessions can be open-ended — leave --duration off and run until 'q'.
"""
from __future__ import annotations

import argparse
import glob
import json
import platform
import signal
import sys
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import matplotlib

try:
    matplotlib.use("TkAgg")
except Exception:
    pass
import matplotlib.animation as animation
import matplotlib.patches as mpatches
import matplotlib.pyplot as plt
import numpy as np

from csi_io import MultiPortReader

# ─────────────────────────────────────────────────────────
# Class definitions — LOCK THESE before recording sessions
# Adding/renaming a class halfway through invalidates earlier sessions.
# ─────────────────────────────────────────────────────────

CLASSES: dict[int, str] = {
    0: "EMPTY",
    1: "STILL",
    2: "WALKING",
    3: "TRANSITION",
    4: "FALL",
}

CLASS_COLORS: dict[str, tuple[float, float, float]] = {
    "EMPTY":      (0.78, 0.78, 0.78),
    "STILL":      (0.55, 0.85, 0.55),
    "WALKING":    (0.50, 0.70, 0.95),
    "TRANSITION": (0.95, 0.85, 0.40),
    "FALL":       (0.95, 0.30, 0.30),
}

# Retroactive fall labeling is disabled (keypress-instant labeling). Kept as a
# constant of 0.0 so older code paths and metadata fields don't break.
FALL_GUARD_SEC: float = 0.0

# Heartbeat ring buffer for the per-RX activity bars. We don't need to keep
# the full session in here — that's in the MultiPortReader's deques.
DISPLAY_VAR_WINDOW_SEC: float = 5.0
TIMELINE_DISPLAY_SEC: float = 90.0


# ─────────────────────────────────────────────────────────
# Variance helper — same MAD-clipped form as dashboard_multi
# (kept inline so this file doesn't depend on importing it.)
# ─────────────────────────────────────────────────────────

def robust_variance(amps_window: np.ndarray, k_sigma: float = 3.0) -> float:
    if amps_window.shape[0] < 5:
        return 0.0
    detrended = amps_window - amps_window.mean(axis=0, keepdims=True)
    mad = np.median(np.abs(detrended), axis=0, keepdims=True)
    clip = k_sigma * 1.4826 * np.maximum(mad, 1e-6)
    detrended = np.clip(detrended, -clip, clip)
    return float(np.mean(detrended * detrended))


# ─────────────────────────────────────────────────────────
# Session state
# ─────────────────────────────────────────────────────────

@dataclass
class LabelEvent:
    """A label change. The class active at any time t is determined by the
    most recent event with event.t <= t."""
    t: float           # session-relative seconds
    cls: str           # class name (must be in CLASS_COLORS)
    note: str = ""     # optional human-readable annotation


@dataclass
class Session:
    name: str
    started_monotonic: float
    started_iso: str
    subject: str = ""
    notes: str = ""
    paused: bool = False
    pause_started_t: float | None = None
    paused_total: float = 0.0
    label_events: list[LabelEvent] = field(default_factory=list)
    undo_stack: list[list[LabelEvent]] = field(default_factory=list)

    def t(self, monotonic_now: float | None = None) -> float:
        """Session-relative seconds since start, ignoring paused time."""
        m = monotonic_now if monotonic_now is not None else time.monotonic()
        elapsed = m - self.started_monotonic - self.paused_total
        if self.paused and self.pause_started_t is not None:
            elapsed -= (m - self.pause_started_t)
        return max(elapsed, 0.0)

    def current_class(self, t: float | None = None) -> str:
        if t is None:
            t = self.t()
        active = "EMPTY"
        for ev in self.label_events:
            if ev.t <= t:
                active = ev.cls
            else:
                break
        return active

    def push_event(self, ev: LabelEvent, group: list[LabelEvent] | None = None) -> None:
        """Append an event; if part of a multi-event op (fall guard), pass `group`."""
        self.label_events.append(ev)
        self.label_events.sort(key=lambda e: e.t)
        if group is None:
            self.undo_stack.append([ev])
        else:
            group.append(ev)

    def undo(self) -> int:
        """Undo the most recent op. Returns # events removed."""
        if not self.undo_stack:
            return 0
        last_op = self.undo_stack.pop()
        n = 0
        for ev in last_op:
            try:
                self.label_events.remove(ev)
                n += 1
            except ValueError:
                pass
        return n

    def segments(self, end_t: float) -> list[tuple[float, float, str]]:
        """Convert event timeline into [(t_start, t_end, class)] up to end_t."""
        if not self.label_events:
            return [(0.0, end_t, "EMPTY")]
        out: list[tuple[float, float, str]] = []
        # Implicit EMPTY before first event
        first = self.label_events[0]
        if first.t > 0:
            out.append((0.0, first.t, "EMPTY"))
        for i, ev in enumerate(self.label_events):
            seg_start = ev.t
            seg_end = (
                self.label_events[i + 1].t
                if i + 1 < len(self.label_events)
                else end_t
            )
            if seg_end > seg_start:
                out.append((seg_start, seg_end, ev.cls))
        # Drop zero-length segments (from e.g. rapidly retried key presses)
        return [s for s in out if s[1] - s[0] > 1e-3]


# ─────────────────────────────────────────────────────────
# Port discovery
# ─────────────────────────────────────────────────────────

def discover_ports() -> list[str]:
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
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for p in found:
        if p not in seen:
            seen.add(p)
            unique.append(p)
    return sorted(unique)


def parse_port_arg(arg: str, fallback_idx: int) -> tuple[str, str]:
    if "=" in arg:
        path, name = arg.split("=", 1)
        return path.strip(), name.strip()
    return arg.strip(), f"RX{fallback_idx}"


# ─────────────────────────────────────────────────────────
# Save logic
# ─────────────────────────────────────────────────────────

def save_session(
    session: Session,
    reader: MultiPortReader,
    port_specs: list[tuple[str, str]],
    out_dir: Path,
) -> tuple[Path, Path, Path]:
    """Write csi.npz, labels.json, metadata.json. Returns the three paths."""
    out_dir.mkdir(parents=True, exist_ok=True)
    end_t = session.t()
    started_at = session.started_monotonic

    # ── csi.npz ──
    save_dict: dict[str, np.ndarray] = {}
    rx_names = []
    rx_stats = []
    rx_warnings: list[str] = []
    for path, name in port_specs:
        records = list(reader.buffers[name])
        if not records:
            rx_stats.append({"name": name, "port": path, "n_packets": 0,
                             "rate_hz": 0.0, "warning": "no packets received"})
            rx_warnings.append(f"{name}: NO PACKETS")
            continue
        # Filter to canonical subcarrier count (firmware can mix sizes occasionally)
        from collections import Counter
        sizes = Counter(r[1].size for r in records)
        canonical = sizes.most_common(1)[0][0]
        records = [r for r in records if r[1].size == canonical]
        # Convert monotonic timestamps to session-relative seconds.
        # Drop negative-time packets — those are warmup buffered before the
        # session timer started; they have no label and would confuse training.
        ts_rel_full = np.array(
            [r[0] - started_at - session.paused_total for r in records],
            dtype=np.float64,
        )
        keep_mask = ts_rel_full >= 0.0
        ts_rel = ts_rel_full[keep_mask]
        n_warmup_dropped = int((~keep_mask).sum())
        amps_full = np.stack([r[1] for r in records], axis=0).astype(np.float32)
        amps = amps_full[keep_mask]

        save_dict[f"timestamps_{name}"] = ts_rel
        save_dict[f"amplitudes_{name}"] = amps
        rx_names.append(name)
        rate = (
            len(ts_rel) / (ts_rel[-1] - ts_rel[0])
            if len(ts_rel) > 1 else 0.0
        )
        # Detect early-drop / mid-session-failure: if the last packet is more
        # than 5 seconds before end_t, flag it.
        last_t = float(ts_rel[-1]) if len(ts_rel) else 0.0
        flatlined_at = None
        if end_t - last_t > 5.0:
            flatlined_at = round(last_t, 2)
            rx_warnings.append(
                f"{name}: STOPPED at t={flatlined_at}s "
                f"({end_t - last_t:.1f}s before session end)"
            )

        rx_stats.append({
            "name": name,
            "port": path,
            "n_packets": int(len(ts_rel)),
            "rate_hz": float(round(rate, 2)),
            "n_subcarriers": int(amps.shape[1]) if amps.size else 0,
            "warmup_packets_dropped": n_warmup_dropped,
            "flatlined_at_sec": flatlined_at,
        })
    save_dict["rx_names"] = np.array(rx_names, dtype="U16")
    save_dict["session_duration_sec"] = np.array(end_t, dtype=np.float64)
    csi_path = out_dir / "csi.npz"
    np.savez_compressed(csi_path, **save_dict)

    # ── labels.json ──
    segments = session.segments(end_t)
    labels_doc = {
        "version": 1,
        "classes": {str(k): v for k, v in CLASSES.items()},
        "segments": [
            {"t_start": round(s, 4), "t_end": round(e, 4), "class": c}
            for s, e, c in segments
        ],
        "session_duration_sec": round(end_t, 4),
    }
    labels_path = out_dir / "labels.json"
    with open(labels_path, "w") as f:
        json.dump(labels_doc, f, indent=2)

    # ── metadata.json ──
    metadata = {
        "version": 1,
        "session_name": session.name,
        "started_at_iso": session.started_iso,
        "duration_sec": round(end_t, 4),
        "paused_total_sec": round(session.paused_total, 4),
        "subject": session.subject,
        "notes": session.notes,
        "rx_specs": rx_stats,
        "host": {
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "fall_guard_sec": FALL_GUARD_SEC,
        "class_set": list(CLASSES.values()),
    }
    metadata_path = out_dir / "metadata.json"
    with open(metadata_path, "w") as f:
        json.dump(metadata, f, indent=2)

    # Make the warnings discoverable from the metadata too
    if rx_warnings:
        metadata["rx_warnings"] = rx_warnings
        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

    return csi_path, labels_path, metadata_path, rx_warnings


# ─────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--session", type=str, default=None,
        help="Session name (used as folder name under dataset/). "
             "Defaults to a timestamp.",
    )
    parser.add_argument(
        "--out-root", type=Path, default=Path("dataset"),
        help="Root folder for sessions. Default: ./dataset/",
    )
    parser.add_argument("--port", action="append", default=[],
                        help="Serial port (NAME=PATH). Repeat per RX. "
                             "Auto-detects all ports if omitted.")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--duration", type=float, default=None,
                        help="Auto-stop after N seconds. Default: run until 'q'.")
    parser.add_argument("--subject", type=str, default="",
                        help="Subject ID (for metadata).")
    parser.add_argument("--notes", type=str, default="",
                        help="Free-text notes (for metadata).")
    parser.add_argument("--update-hz", type=float, default=6.0)
    parser.add_argument("--overwrite", action="store_true",
                        help="Overwrite the session folder if it already "
                             "exists. By default we refuse to clobber.")
    args = parser.parse_args()

    # Resolve session name and output dir
    if args.session:
        session_name = args.session
    else:
        session_name = "session_" + datetime.now().strftime("%Y%m%d_%H%M%S")
    out_dir: Path = args.out_root / session_name
    if out_dir.exists() and any(out_dir.iterdir()):
        if args.overwrite:
            import shutil
            shutil.rmtree(out_dir)
            print(f"  [--overwrite] removed existing {out_dir}")
        else:
            print(f"ERROR: {out_dir} already exists and is non-empty.\n"
                  f"  Either pick a new --session name, pass --overwrite, "
                  f"or:  rm -rf {out_dir}", file=sys.stderr)
            return 2

    # Resolve ports
    if args.port:
        port_specs = [parse_port_arg(p, i + 1) for i, p in enumerate(args.port)]
    else:
        ports = discover_ports()
        if not ports:
            print("ERROR: no USB serial ports found.", file=sys.stderr)
            return 2
        port_specs = [(p, f"RX{i+1}") for i, p in enumerate(ports)]

    print(f"Recording session '{session_name}' from {len(port_specs)} RX(s):")
    for path, name in port_specs:
        print(f"  {name:<5} {path}")
    print(f"  → {out_dir}")
    print()

    # Spawn one selectors-based reader (no buffer cap during recording)
    reader = MultiPortReader(port_specs, baud=args.baud, buffer_size=0)
    try:
        reader.start()
    except Exception as exc:
        print(f"FATAL: MultiPortReader.start() failed: {type(exc).__name__}: {exc}",
              file=sys.stderr)
        return 2

    # Active warmup: wait up to 3s for every port to either produce a packet
    # or report an error. Don't fail if some are slow — but DO surface a clear
    # status before opening the figure.
    warmup_deadline = time.monotonic() + 3.0
    while time.monotonic() < warmup_deadline:
        time.sleep(0.1)
        ready = sum(1 for n in reader.opened_names()
                    if reader.packet_counts.get(n, 0) > 0)
        if ready == len(port_specs):
            break

    print("Startup status:")
    living_names = reader.opened_names()
    for path, name in port_specs:
        err = reader.last_errors.get(name)
        pkts = reader.packet_counts.get(name, 0)
        if err is not None:
            print(f"  ✗ {name:<5} {path}  OPEN-ERROR: {err}", file=sys.stderr)
        elif pkts == 0:
            print(f"  ⚠ {name:<5} {path}  opened but NO packets after 3s "
                  f"(check firmware / power / cable)")
        else:
            print(f"  ✓ {name:<5} {path}  {pkts} pkt warmup")
    if not living_names:
        print("No readers opened. Aborting.", file=sys.stderr)
        reader.stop_event.set()
        reader.join(timeout=1.0)
        return 2
    print()

    # Build session
    session = Session(
        name=session_name,
        started_monotonic=time.monotonic(),
        started_iso=datetime.now().isoformat(timespec="seconds"),
        subject=args.subject,
        notes=args.notes,
    )
    # Default initial label = EMPTY (set in segments() if no earlier event)

    # Per-RX small variance ring buffers for the live activity bars
    var_buffers: dict[str, deque] = {n: deque(maxlen=200) for n in living_names}
    baseline_var: dict[str, float | None] = {n: None for n in living_names}
    calib_started: dict[str, float] = {n: time.monotonic() for n in living_names}

    # ── Save state shared between handlers ──
    saved_flag = {"value": False}
    quit_flag = {"value": False}

    def do_save_and_exit(reason: str = "user-quit"):
        if saved_flag["value"]:
            return
        saved_flag["value"] = True
        try:
            csi_p, lab_p, meta_p, rx_warnings = save_session(
                session, reader, port_specs, out_dir
            )
            end_t = session.t()
            print()
            print(f"  ✓ saved (reason: {reason})")
            print(f"    duration: {end_t:.1f}s, paused: {session.paused_total:.1f}s")
            print(f"    {csi_p}")
            print(f"    {lab_p}")
            print(f"    {meta_p}")
            seg_counts: dict[str, float] = {}
            for s, e, c in session.segments(end_t):
                seg_counts[c] = seg_counts.get(c, 0.0) + (e - s)
            if seg_counts:
                print("  per-class duration:")
                for c, dur in sorted(seg_counts.items(), key=lambda kv: -kv[1]):
                    print(f"    {c:<11} {dur:6.1f}s")
            if rx_warnings:
                print()
                print("  ⚠ RX issues detected — review before using this session:")
                for w in rx_warnings:
                    print(f"      {w}")
                print("    (consider re-recording if a key RX flatlined)")
        except Exception as exc:
            print(f"  ✗ save failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        quit_flag["value"] = True

    # SIGINT → save + exit
    def _sigint_handler(_signum, _frame):
        do_save_and_exit(reason="sigint")
        # plt.close all so the show() loop returns
        plt.close("all")
    signal.signal(signal.SIGINT, _sigint_handler)

    # ── Build figure ──
    try:
        fig = plt.figure(figsize=(13.0, 8.5))
    except Exception as exc:
        # Matplotlib backend init can fail on a fresh Mac if Tk isn't available.
        # Print a helpful pointer rather than a raw traceback.
        print(f"FATAL: could not create matplotlib figure: "
              f"{type(exc).__name__}: {exc}", file=sys.stderr)
        print("If this is a TkAgg backend failure on macOS, try:", file=sys.stderr)
        print("  brew install python-tk@3.12   # or whichever python you use",
              file=sys.stderr)
        print("Or set MPLBACKEND=macosx and re-run.", file=sys.stderr)
        reader.stop_event.set(); reader.join(timeout=1.0)
        return 3
    fig.suptitle(f"CSI session recorder — '{session_name}'", fontsize=12)
    gs = fig.add_gridspec(
        4, 1, height_ratios=[1.5, 1.0, 1.4, 0.8], hspace=0.55,
    )
    fig.subplots_adjust(top=0.93, bottom=0.07, left=0.06, right=0.97)

    # Row 0: BIG current-class banner
    ax_class = fig.add_subplot(gs[0, 0])
    ax_class.set_axis_off()
    class_text = ax_class.text(
        0.5, 0.55, "EMPTY", ha="center", va="center",
        fontsize=44, fontweight="bold", transform=ax_class.transAxes,
    )
    class_sub = ax_class.text(
        0.5, 0.12, "press 0..4 to label (or 'f' = fall)   |   space=pause   u=undo   q=save+quit",
        ha="center", va="center", fontsize=10, color="dimgray",
        transform=ax_class.transAxes,
    )

    # Row 1: per-RX activity bars
    ax_bars = fig.add_subplot(gs[1, 0])
    ax_bars.set_xlim(0, 5)
    ax_bars.set_ylim(-0.5, len(living_names) - 0.5)
    ax_bars.set_yticks(range(len(living_names)))
    ax_bars.set_yticklabels(living_names)
    ax_bars.set_xlabel("ratio (variance / baseline)  — purely a sanity check, not used in labels")
    ax_bars.grid(True, axis="x", alpha=0.3)
    ax_bars.invert_yaxis()
    bar_handles = ax_bars.barh(
        range(len(living_names)), [1.0] * len(living_names),
        color="#888888", edgecolor="none",
    )
    bar_text = [
        ax_bars.text(0, i, "", va="center", fontsize=9)
        for i in range(len(living_names))
    ]

    # Row 2: label timeline
    ax_tl = fig.add_subplot(gs[2, 0])
    ax_tl.set_xlim(-TIMELINE_DISPLAY_SEC, 0)
    ax_tl.set_ylim(0, 1)
    ax_tl.set_yticks([])
    ax_tl.set_xlabel(f"label timeline (last {TIMELINE_DISPLAY_SEC:.0f}s)")
    legend_handles = [
        mpatches.Patch(color=CLASS_COLORS[c], label=f"{i} {c}")
        for i, c in CLASSES.items()
    ]
    ax_tl.legend(handles=legend_handles, loc="upper right", ncol=len(CLASSES),
                 fontsize=8, frameon=False)
    tl_patches: list[mpatches.Rectangle] = []
    cursor_marker = ax_tl.axvline(0, color="black", linewidth=1.5, alpha=0.6)

    # Row 3: status text
    ax_status = fig.add_subplot(gs[3, 0])
    ax_status.set_axis_off()
    status_text = ax_status.text(
        0.0, 0.5, "", ha="left", va="center", fontsize=10,
        family="monospace", transform=ax_status.transAxes,
    )

    # ── Keyboard handler ──
    def on_key(event):
        if event.key is None:
            return
        key = event.key.lower()
        t_now = session.t()

        if key == "q":
            do_save_and_exit(reason="key-q")
            plt.close("all")
            return

        if key == " " or key == "space":
            # Toggle pause
            m = time.monotonic()
            if session.paused:
                # Resume
                if session.pause_started_t is not None:
                    session.paused_total += (m - session.pause_started_t)
                session.pause_started_t = None
                session.paused = False
                print(f"[{datetime.now().strftime('%H:%M:%S')}] resumed")
            else:
                session.paused = True
                session.pause_started_t = m
                print(f"[{datetime.now().strftime('%H:%M:%S')}] paused")
            return

        if key == "u":
            n = session.undo()
            if n:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] undid last op ({n} event{'s' if n!=1 else ''})")
            else:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] nothing to undo")
            return

        if key == "f":
            # 'f' is an alias for '4' = FALL — instant marker, no retro.
            session.push_event(LabelEvent(t=t_now, cls="FALL", note="key-f"))
            print(f"[{datetime.now().strftime('%H:%M:%S')}] → FALL at t={t_now:.2f}s")
            return

        # Numeric class keys
        if key in {str(k) for k in CLASSES}:
            cls = CLASSES[int(key)]
            session.push_event(LabelEvent(t=t_now, cls=cls, note=f"key-{key}"))
            print(f"[{datetime.now().strftime('%H:%M:%S')}] → {cls} at t={t_now:.2f}s")
            return

    fig.canvas.mpl_connect("key_press_event", on_key)
    fig.canvas.mpl_connect("close_event", lambda _e: do_save_and_exit(reason="window-closed"))

    # ── Update loop ──
    def update(_frame):
        try:
            t_mono = time.monotonic()
            t_now = session.t(t_mono)

            # Auto-stop on duration
            if args.duration and t_now >= args.duration:
                do_save_and_exit(reason="duration-reached")
                plt.close("all")
                return []

            current_cls = session.current_class(t_now)
            color = CLASS_COLORS.get(current_cls, (0.85, 0.85, 0.85))
            class_text.set_text(("⏸ " if session.paused else "") + current_cls)
            class_text.set_color(tuple(min(c * 0.55, 1.0) for c in color))
            ax_class.set_facecolor((color[0], color[1], color[2], 0.22))

            # Per-RX activity bars
            xmax = 2.0
            for i, name in enumerate(living_names):
                snapshot = list(reader.buffers[name])
                if len(snapshot) >= 30:
                    cutoff = t_mono - DISPLAY_VAR_WINDOW_SEC
                    canonical = snapshot[-1][1].size
                    pts = [a for ts, a in snapshot
                           if ts >= cutoff and a.size == canonical]
                    if len(pts) >= 10:
                        amps_mat = np.stack(pts, axis=0)
                        v = robust_variance(amps_mat)
                        var_buffers[name].append((t_mono, v))
                        # Auto-calibrate baseline (median of first 5s)
                        if baseline_var[name] is None:
                            samples = [v for _, v in var_buffers[name]]
                            if t_mono - calib_started[name] >= 5.0 and len(samples) > 5:
                                baseline_var[name] = max(float(np.median(samples)), 1e-9)
                ratio = 1.0
                if baseline_var[name] is not None and var_buffers[name]:
                    ratio = var_buffers[name][-1][1] / baseline_var[name]
                xmax = max(xmax, ratio * 1.15)
                bar_handles[i].set_width(ratio)
                if ratio < 1.5:
                    bar_handles[i].set_color((0.45, 0.65, 0.85))
                elif ratio < 4.0:
                    bar_handles[i].set_color((0.95, 0.78, 0.30))
                else:
                    bar_handles[i].set_color((0.90, 0.25, 0.25))
                pkts = reader.packet_counts.get(name, 0)
                bar_text[i].set_x(min(ratio + xmax * 0.01, xmax * 0.98))
                bar_text[i].set_text(f" {ratio:5.1f}×  ({pkts} pkts)")
            ax_bars.set_xlim(0, xmax)

            # Label timeline
            for p in tl_patches:
                p.remove()
            tl_patches.clear()
            tl_min = max(0.0, t_now - TIMELINE_DISPLAY_SEC)
            for s, e, c in session.segments(t_now):
                if e < tl_min:
                    continue
                s_disp = max(s, tl_min) - t_now
                e_disp = e - t_now
                rect = mpatches.Rectangle(
                    (s_disp, 0.05), e_disp - s_disp, 0.9,
                    facecolor=CLASS_COLORS[c], edgecolor="none",
                )
                ax_tl.add_patch(rect)
                tl_patches.append(rect)

            # Status line
            seg_counts: dict[str, float] = {}
            for s, e, c in session.segments(t_now):
                seg_counts[c] = seg_counts.get(c, 0.0) + (e - s)
            counts_str = "  ".join(
                f"{c}={seg_counts.get(c, 0):.0f}s"
                for c in CLASSES.values()
            )
            total_pkts = reader.total_packets()
            duration_str = (
                f"{t_now:5.1f}/{args.duration:.0f}s"
                if args.duration else f"{t_now:5.1f}s"
            )
            n_calibrated = sum(1 for n in living_names if baseline_var[n] is not None)
            status_text.set_text(
                f"elapsed: {duration_str}   paused: {session.paused_total:.1f}s   "
                f"events: {len(session.label_events)}   pkts: {total_pkts}   "
                f"baseline: {n_calibrated}/{len(living_names)}\n"
                f"per-class:  {counts_str}"
            )

        except Exception as exc:
            status_text.set_text(f"update error: {type(exc).__name__}: {exc}")
        return []

    interval_ms = max(150, int(1000 / args.update_hz))
    ani = animation.FuncAnimation(
        fig, update, interval=interval_ms, blit=False, cache_frame_data=False,
    )

    try:
        plt.show()
    except KeyboardInterrupt:
        do_save_and_exit(reason="ctrl-c")
    finally:
        if not saved_flag["value"]:
            do_save_and_exit(reason="show-returned")
        reader.stop_event.set()
        reader.join(timeout=1.5)

    return 0


if __name__ == "__main__":
    sys.exit(main())
