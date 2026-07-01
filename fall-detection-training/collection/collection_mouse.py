#!/usr/bin/env python3
"""
collection_mouse.py — mouse-based labeling tool for CSI capture sessions.

Same purpose as collect.py, but uses mouse buttons instead of keyboard
keys to avoid bringing a full-size keyboard onto the activity mat
during fall recording (otherwise you'd risk injury to yourself and
damage to the keyboard).

Why this exists:
    collect.py's key handler is great when you have a keyboard at the
    desk. But for fall recording you need to be in the middle of the
    activity area, on a yoga mat, with a free hand — a wireless mouse
    is easier to manage than a full keyboard.

Click protocol (2-bit + 6-bit codes):
    Middle click  → save + quit
    Left click    → 0 bite
    Right click   → 1 bit

    2-bit codes (finalized after 1s of no clicks):
        00 = FALL
        01 = STILL
        10 = WALKING
        11 = TRANSITION

    6-bit code (finalized after 1s of no clicks):
        000111 = EMPTY (no person in the room)

    Anything else (length 1, 3, 4, 5, or other 6-bit patterns) is
    discarded and a warning is shown.

Timeout rule:
    If the gap between two consecutive clicks exceeds CLICK_TIMEOUT_SEC
    (default 1.0s), the previous buffer is silently discarded. The new
    click starts a fresh buffer.

UI (in addition to collect.py's waveform + activity bars + timeline):
    - Big class banner shows the *tentative* class after 2 bits match
      a 2-bit code (e.g. "FALL?") so you get instant feedback.
    - A dedicated status line shows the live bit buffer + remaining
      timeout countdown, e.g. "bits: 0 0 → FALL?  (0.7s to confirm)".
    - The session-current class is the last *committed* event.

Output is identical in format to collect.py (csi.npz + labels.json +
metadata.json) so downstream split_fall_labels.py / train_lstm.py
work unchanged.

Usage:
    # Auto-detect ports, write to /abs/path/src/data/raw
    OUT=/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/src/data/raw
    cd fall-detection-training/collection
    python collection_mouse.py \\
        --session session_01_standing \\
        --out-root "$OUT" \\
        --duration 180 \\
        --subject me \\
        --notes "standing + occasional walk, mouse-labeled"

    # Explicit ports (Linux + ESP32-S3)
    python collection_mouse.py \\
        --session session_01_fall \\
        --out-root "$OUT" \\
        --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 \\
        --port /dev/ttyACM2=RX3 --port /dev/ttyACM3=RX4 \\
        --duration 180

Notes on hardware:
    - Use a wireless mouse (USB dongle) for freedom of movement.
    - Make sure the mouse is in a stable position near the activity
      area, e.g. taped to a chair armrest or a small clipboard on
      the floor.
    - Middle-button click on a typical mouse is the scroll-wheel
      press — verify your mouse has a working middle button before
      recording.
"""
from __future__ import annotations

import argparse
import platform
import signal
import sys
import time
from collections import deque
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

# Reuse collect.py's data structures, save logic, and constants so this
# file stays in sync with collect.py's output format.
from collect import (  # noqa: E402
    LabelEvent,
    Session,
    CLASS_COLORS,
    CLASSES,
    DISPLAY_VAR_WINDOW_SEC,
    FALL_GUARD_SEC,
    TIMELINE_DISPLAY_SEC,
    discover_ports,
    parse_port_arg,
    robust_variance,
    save_session,
)


# ─────────────────────────────────────────────────────────────────────
# Mouse-click bit protocol
# ─────────────────────────────────────────────────────────────────────

CLICK_TIMEOUT_SEC: float = 1.0
"""Max gap between two consecutive clicks. Past this, the buffer is discarded."""

# 2-bit → class
BIT2_TO_CLASS: dict[tuple[int, int], str] = {
    (0, 0): "FALL",
    (0, 1): "STILL",
    (1, 0): "WALKING",
    (1, 1): "TRANSITION",
}

# 6-bit → class (only EMPTY in the spec)
BIT6_EMPTY: tuple[int, ...] = (0, 0, 0, 1, 1, 1)

# matplotlib mouse button codes:
#   1 = left, 2 = middle, 3 = right
MOUSE_LEFT = 1
MOUSE_MIDDLE = 2
MOUSE_RIGHT = 3


def _dim_color(color: tuple[float, float, float], factor: float = 0.45
               ) -> tuple[float, float, float]:
    """Return a dimmed version of an RGB color (for the tentative-class preview)."""
    return tuple(c * factor for c in color)


class BitBuffer:
    """Mouse-click bit protocol with CLICK_TIMEOUT_SEC timeout.

    Tracks a sequence of 0/1 clicks separated by < timeout gaps. On
    timeout (or on demand), finalizes the buffer and returns the matching
    class — or None if the buffer is incomplete / not a known pattern.

    The 'tentative' field is set when the buffer has exactly 2 bits and
    matches a 2-bit code (giving the user instant "FALL?" feedback before
    the timeout confirms). It is cleared the moment a 3rd bit arrives
    (since the buffer is no longer a valid 2-bit code).
    """

    def __init__(self, timeout_sec: float = CLICK_TIMEOUT_SEC):
        self.bits: list[int] = []
        self.last_click_t: float | None = None
        self.tentative: str | None = None
        self.timeout_sec = timeout_sec

    # ── State updates ──

    def push(self, bit: int, now: float) -> None:
        """Add a bit. Discards previous buffer if the gap from the last
        click exceeds the timeout. Updates self.tentative in the process.
        Does NOT finalize — call tick() or finalize_now() for that."""
        # Timeout check: if the previous click was too long ago, drop it
        if self.last_click_t is not None and (now - self.last_click_t) > self.timeout_sec:
            self.bits = []
            self.tentative = None

        self.bits.append(bit)
        self.last_click_t = now
        self._update_tentative()

    def tick(self, now: float) -> str | None:
        """Check for timeout. If the buffer is older than the timeout,
        finalize it and return the matched class (or None for invalid)."""
        if not self.bits or self.last_click_t is None:
            return None
        if (now - self.last_click_t) < self.timeout_sec:
            return None
        return self.finalize_now()

    def finalize_now(self) -> str | None:
        """Force-finalize the current buffer (used on quit / window close).
        Returns the matched class, or None if invalid."""
        label = self._match()
        self.bits = []
        self.tentative = None
        self.last_click_t = None
        return label

    # ── Queries ──

    def time_remaining(self, now: float) -> float | None:
        """Seconds until timeout, or None if no buffer active."""
        if not self.bits or self.last_click_t is None:
            return None
        return max(0.0, self.timeout_sec - (now - self.last_click_t))

    def bits_str(self) -> str:
        return " ".join(str(b) for b in self.bits)

    # ── Internals ──

    def _update_tentative(self) -> None:
        """Set self.tentative when the current buffer forms a valid 2-bit
        code. Cleared as soon as a 3rd bit arrives (since the buffer is
        no longer a valid 2-bit code)."""
        if len(self.bits) == 2:
            self.tentative = BIT2_TO_CLASS.get(tuple(self.bits))
        elif len(self.bits) > 2:
            self.tentative = None

    def _match(self) -> str | None:
        """Match the current buffer against known patterns. Returns the
        class name, or None if invalid."""
        if tuple(self.bits) == BIT6_EMPTY:
            return "EMPTY"
        if len(self.bits) == 2:
            return BIT2_TO_CLASS.get(tuple(self.bits))
        return None


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--session", type=str, default=None,
        help="Session name (used as folder name under --out-root). "
             "Defaults to a timestamp.",
    )
    parser.add_argument(
        "--out-root", type=Path, default=Path("dataset"),
        help="Root folder for sessions. Default: ./dataset/ "
             "(use an absolute path to avoid cwd drift).",
    )
    parser.add_argument("--port", action="append", default=[],
                        help="Serial port (NAME=PATH). Repeat per RX. "
                             "Auto-detects all ports if omitted.")
    parser.add_argument("--baud", type=int, default=921600)
    parser.add_argument("--duration", type=float, default=None,
                        help="Auto-stop after N seconds. Default: run until middle-click.")
    parser.add_argument("--subject", type=str, default="",
                        help="Subject ID (for metadata).")
    parser.add_argument("--notes", type=str, default="",
                        help="Free-text notes (for metadata).")
    parser.add_argument("--update-hz", type=float, default=6.0)
    parser.add_argument("--click-timeout", type=float, default=CLICK_TIMEOUT_SEC,
                        help=f"Max gap (seconds) between two clicks. "
                             f"Default: {CLICK_TIMEOUT_SEC}.")
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
    print("MOUSE PROTOCOL:")
    print("  Left click  = 0 bit          Right click = 1 bit")
    print("  Middle click = save + quit")
    print("  2-bit codes:  00=FALL  01=STILL  10=WALKING  11=TRANSITION")
    print("  6-bit code:   000111 = EMPTY (no person)")
    print(f"  Click timeout: {args.click_timeout}s (gap longer than this → buffer reset)")
    print()

    # Spawn one selectors-based reader (no buffer cap during recording)
    reader = MultiPortReader(port_specs, baud=args.baud, buffer_size=0)
    try:
        reader.start()
    except Exception as exc:
        print(f"FATAL: MultiPortReader.start() failed: {type(exc).__name__}: {exc}",
              file=sys.stderr)
        return 2

    # Active warmup (same as collect.py)
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

    # Build session + bit buffer
    session = Session(
        name=session_name,
        started_monotonic=time.monotonic(),
        started_iso=datetime.now().isoformat(timespec="seconds"),
        subject=args.subject,
        notes=args.notes,
    )
    bit_buf = BitBuffer(timeout_sec=args.click_timeout)

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
        # Commit any pending valid bits first (so quitting mid-2-bit-code
        # doesn't lose data)
        if bit_buf.bits:
            pending_label = bit_buf.finalize_now()
            if pending_label:
                t_now = session.t()
                session.push_event(
                    LabelEvent(t=t_now, cls=pending_label, note="mouse-quit-commit")
                )
                print(f"[quit-commit] {pending_label} at t={t_now:.2f}s")
        saved_flag["value"] = True
        try:
            csi_p, lab_p, meta_p, rx_warnings = save_session(
                session, reader, port_specs, out_dir
            )
            end_t = session.t()
            print()
            print(f"  ✓ saved (reason: {reason})")
            print(f"    duration: {end_t:.1f}s")
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

    # SIGINT → save + exit (still works even without a keyboard)
    def _sigint_handler(_signum, _frame):
        do_save_and_exit(reason="sigint")
        plt.close("all")
    signal.signal(signal.SIGINT, _sigint_handler)

    # ── Build figure (similar to collect.py, with extra bit-buffer UI) ──
    try:
        fig = plt.figure(figsize=(13.0, 9.0))
    except Exception as exc:
        print(f"FATAL: could not create matplotlib figure: "
              f"{type(exc).__name__}: {exc}", file=sys.stderr)
        print("If this is a TkAgg backend failure on macOS, try:", file=sys.stderr)
        print("  brew install python-tk@3.12   # or whichever python you use",
              file=sys.stderr)
        print("Or set MPLBACKEND=macosx and re-run.", file=sys.stderr)
        reader.stop_event.set(); reader.join(timeout=1.0)
        return 3

    fig.suptitle(f"CSI session recorder (MOUSE) — '{session_name}'", fontsize=12)
    gs = fig.add_gridspec(
        5, 1, height_ratios=[1.5, 0.5, 0.5, 1.4, 0.8], hspace=0.55,
    )
    fig.subplots_adjust(top=0.93, bottom=0.06, left=0.06, right=0.97)

    # Row 0: BIG current-class banner (color-coded)
    ax_class = fig.add_subplot(gs[0, 0])
    ax_class.set_axis_off()
    class_text = ax_class.text(
        0.5, 0.65, "EMPTY", ha="center", va="center",
        fontsize=44, fontweight="bold", transform=ax_class.transAxes,
    )
    # 4 BIG colored button labels (one per 2-bit code).
    # Replaces the old single-line `class_sub` tiny text — too small to read
    # while lying on a yoga mat waiting to click. Each label uses
    # CLASS_COLORS for visual consistency with the timeline + legend.
    button_specs: list[tuple[float, str, str]] = [
        (0.13, "00  FALL",       "FALL"),
        (0.38, "01  STILL",      "STILL"),
        (0.63, "10  WALKING",    "WALKING"),
        (0.88, "11  TRANSITION", "TRANSITION"),
    ]
    button_texts: list[tuple] = []  # (Text artist, class_name, base_color)
    for x, label, cls in button_specs:
        color = CLASS_COLORS[cls]
        # Darken the color a bit so it's readable on a light axes background
        dim = tuple(min(1.0, c * 0.75) for c in color)
        txt = ax_class.text(
            x, 0.18, label, ha="center", va="center",
            fontsize=18, fontweight="bold",
            color=dim, transform=ax_class.transAxes,
        )
        button_texts.append((txt, cls, color))
    # Tiny hint line below the buttons
    hint_text = ax_class.text(
        0.5, -0.05,
        f"left=0  right=1  middle=quit+save  |  000111=EMPTY  |  "
        f"timeout={args.click_timeout:.1f}s",
        ha="center", va="center", fontsize=9, color="dimgray",
        transform=ax_class.transAxes,
    )

    # Row 1: live bit buffer + tentative class preview
    ax_bits = fig.add_subplot(gs[1, 0])
    ax_bits.set_axis_off()
    bits_title = ax_bits.text(
        0.0, 0.85,
        "Click buffer:",
        ha="left", va="center", fontsize=11, fontweight="bold",
        family="monospace", transform=ax_bits.transAxes,
    )
    bits_text = ax_bits.text(
        0.0, 0.30,
        "(empty — click LEFT for 0, RIGHT for 1)",
        ha="left", va="center", fontsize=14, family="monospace",
        color="dimgray", transform=ax_bits.transAxes,
    )
    tentative_text = ax_bits.text(
        0.0, -0.10,
        "",
        ha="left", va="center", fontsize=10, family="monospace",
        transform=ax_bits.transAxes,
    )

    # Row 2: per-RX activity bars (same idea as collect.py)
    ax_bars = fig.add_subplot(gs[2, 0])
    ax_bars.set_xlim(0, 5)
    ax_bars.set_ylim(-0.5, len(living_names) - 0.5)
    ax_bars.set_yticks(range(len(living_names)))
    ax_bars.set_yticklabels(living_names)
    ax_bars.set_xlabel("ratio (variance / baseline)  — purely a sanity check")
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

    # Row 3: label timeline (same as collect.py)
    ax_tl = fig.add_subplot(gs[3, 0])
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

    # Row 4: status text (same as collect.py)
    ax_status = fig.add_subplot(gs[4, 0])
    ax_status.set_axis_off()
    status_text = ax_status.text(
        0.0, 0.5, "", ha="left", va="center", fontsize=10,
        family="monospace", transform=ax_status.transAxes,
    )

    # ── Mouse handler ──
    def highlight_button(active_cls: str | None) -> None:
        """Bold + brighten the matching 2-bit code button (so the user can
        see which class the buffer currently matches). All others stay dim.

        active_cls=None means no buffer match — reset all to dim.
        """
        for txt, cls, color in button_texts:
            if cls == active_cls:
                # Active: full color, larger
                txt.set_color(color)
                txt.set_fontsize(22)
                txt.set_fontweight("bold")
            else:
                # Inactive: dim, smaller
                dim = tuple(min(1.0, c * 0.75) for c in color)
                txt.set_color(dim)
                txt.set_fontsize(18)
                txt.set_fontweight("bold")

    def update_class_banner(committed_cls: str, tentative: str | None) -> None:
        """Update the big class banner — committed class by default, with
        the tentative class in dimmed color if active. Also highlight the
        matching button in the row below."""
        if tentative is not None:
            color = CLASS_COLORS.get(tentative, (0.85, 0.85, 0.85))
            class_text.set_text(f"{tentative} ?")
            class_text.set_color(_dim_color(color))
            ax_class.set_facecolor((color[0], color[1], color[2], 0.10))
            highlight_button(tentative)
        else:
            color = CLASS_COLORS.get(committed_cls, (0.85, 0.85, 0.85))
            class_text.set_text(committed_cls)
            class_text.set_color(tuple(min(c * 0.55, 1.0) for c in color))
            ax_class.set_facecolor((color[0], color[1], color[2], 0.22))
            highlight_button(None)

    def on_mouse(event):
        # Ignore clicks outside any axes (e.g. on the figure border)
        if event.button == MOUSE_MIDDLE:
            do_save_and_exit(reason="mouse-middle")
            plt.close("all")
            return

        if event.button not in (MOUSE_LEFT, MOUSE_RIGHT):
            return

        bit = 0 if event.button == MOUSE_LEFT else 1
        now = time.monotonic()
        t_now = session.t(now)

        bit_buf.push(bit, now)

        # Live UI updates
        bits_text.set_text(
            f"bits: [{bit_buf.bits_str()}]    "
            f"len={len(bit_buf.bits)}/6"
        )
        bits_text.set_color("black" if bit_buf.tentative else "dimgray")
        if bit_buf.tentative:
            remaining = bit_buf.time_remaining(now) or 0.0
            tentative_text.set_text(
                f"→ tentative: {bit_buf.tentative}  "
                f"(commit in {remaining:.1f}s, or click again to change)"
            )
            tentative_text.set_color(CLASS_COLORS[bit_buf.tentative])
        else:
            tentative_text.set_text("")
        update_class_banner(session.current_class(t_now), bit_buf.tentative)

        # Force a redraw NOW so the click feedback is visible before the next
        # animation tick (which could be 100-200ms away). Without this, the
        # user might double-click before seeing the first bit register.
        # `draw_idle` is essentially free (~0.04ms, see HANDOFF §11.3).
        fig.canvas.draw_idle()

    fig.canvas.mpl_connect("button_press_event", on_mouse)
    fig.canvas.mpl_connect("close_event", lambda _e: do_save_and_exit(reason="window-closed"))

    # ── Update loop (animation tick handles both waveform + bit-buffer timeout) ──
    def update(_frame):
        try:
            t_mono = time.monotonic()
            t_now = session.t(t_mono)

            # Auto-stop on duration
            if args.duration and t_now >= args.duration:
                do_save_and_exit(reason="duration-reached")
                plt.close("all")
                return []

            # 1) Mouse bit-buffer timeout check
            committed_label = bit_buf.tick(t_mono)
            if committed_label:
                session.push_event(
                    LabelEvent(t=t_now, cls=committed_label, note="mouse")
                )
                print(f"[{datetime.now().strftime('%H:%M:%S')}] → {committed_label} "
                      f"at t={t_now:.2f}s")
                # Update bit buffer UI on commit
                bits_text.set_text(
                    f"bits: [{bit_buf.bits_str()}]    "
                    f"len={len(bit_buf.bits)}/6"
                )
                tentative_text.set_text("")

            # 2) Refresh bit-buffer UI (countdown if pending)
            if bit_buf.bits:
                remaining = bit_buf.time_remaining(t_mono) or 0.0
                if bit_buf.tentative:
                    bits_text.set_text(
                        f"bits: [{bit_buf.bits_str()}]    "
                        f"len={len(bit_buf.bits)}/6"
                    )
                    tentative_text.set_text(
                        f"→ tentative: {bit_buf.tentative}  "
                        f"(commit in {remaining:.1f}s, or click again to change)"
                    )
                    tentative_text.set_color(CLASS_COLORS[bit_buf.tentative])
                else:
                    bits_text.set_text(
                        f"bits: [{bit_buf.bits_str()}]    "
                        f"len={len(bit_buf.bits)}/6    "
                        f"({remaining:.1f}s to confirm)"
                    )
                    tentative_text.set_text("(no valid 2-bit code matched yet)")
                    tentative_text.set_color("dimgray")

            # 3) Class banner (refresh every tick so a newly-committed event
            #    is reflected even without a click)
            update_class_banner(session.current_class(t_now), bit_buf.tentative)

            # 4) Per-RX activity bars — variance calculation is the heaviest
            #    part of update() (np.stack + np.median on ~350×192 floats).
            #    Decimate to every 2nd frame: variance at half the update rate
            #    means less work for the Tk event loop → mouse click handling
            #    gets through faster. The 1-frame visual lag is imperceptible
            #    for a sanity-check bar.
            #    See DEV_LOG §4 / HANDOFF §11.3 for the plt.pause() context
            #    that motivates this optimization.
            variance_active = (_frame % 2 == 0)
            xmax = 2.0
            for i, name in enumerate(living_names):
                snapshot = list(reader.buffers[name])
                if variance_active and len(snapshot) >= 30:
                    cutoff = t_mono - DISPLAY_VAR_WINDOW_SEC
                    canonical = snapshot[-1][1].size
                    pts = [a for ts, a in snapshot
                           if ts >= cutoff and a.size == canonical]
                    if len(pts) >= 10:
                        amps_mat = np.stack(pts, axis=0)
                        v = robust_variance(amps_mat)
                        var_buffers[name].append((t_mono, v))
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

            # 5) Label timeline (same as collect.py)
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

            # 6) Status line (same as collect.py)
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
                f"elapsed: {duration_str}   "
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
