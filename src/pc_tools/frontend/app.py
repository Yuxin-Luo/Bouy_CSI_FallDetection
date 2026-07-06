#!/usr/bin/env python3
"""
src/pc_tools/frontend/app.py — real-time CSI inference frontend (Bouy).

What this is:
    A matplotlib-based real-time display of the LSTM + CNN ensemble inference,
    modeled on fall-detection-training/collection/collection_mouse.py's layout.
    Background thread (InferenceWorker) polls data/live/ for new chunks, runs
    inference, and pushes a Frame to a bounded queue. Main thread (matplotlib
    FuncAnimation) drains the queue (drop-oldest) and redraws the UI without
    ever touching numpy/torch — so frontend drawing NEVER blocks data receiving.

Architecture (high-level):
    receiver.py  →  data/live/chunk_*.npz  →  [InferenceWorker thread]
                                              ↓ queue.Queue(maxsize=10)
                                            [Frontend main thread (matplotlib)]
                                              ↓ FuncAnimation @ 5 fps
                                            UI: banner / amps / probs / status

User-editable constants (this file, top-of-file, NO UI exposure):
    THRESHOLD       — probability gate for active-class selection
    PRIORITY_ORDER  — ordered list of classes; first one >= THRESHOLD wins
    UPDATE_HZ       — matplotlib redraw rate
    POLL_SEC        — worker poll interval (must be <= 6s to keep up with chunks)
    ROLLING_SEC     — amplitude stream display window
    CHUNK_SEC       — must match receiver.py (6.0)

Strict RX policy (mirrors dev_doc/7):
    Any missing RX → red banner + worker exits cleanly. Frontend never
    silently fills zeros / skips chunks / falls back to CNN-only.
    Pass --allow-missing-rxs for offline replay on historical bad data.

Usage:
    # Terminal 1: receiver
    python3 -u src/pc_tools/receiver/receiver.py

    # Terminal 2: this frontend
    python3 -u src/pc_tools/frontend/app.py
    # Optional: --alpha 0.5 --device cpu --update-hz 5 --allow-missing-rxs

Tested with: torch 2.x, numpy 2.x, matplotlib 3.7+ (uses cache_frame_data=False).
"""
from __future__ import annotations

# ─────────────────────────────────────────────────────────────────────────────
# User-editable constants (per user 2026-07-01: "代码内可以修改阈值")
# ─────────────────────────────────────────────────────────────────────────────

# Probability gate for active-class selection. Edit and re-run.
THRESHOLD: float = 0.50

# Priority order for choosing the "active" class when MULTIPLE classes exceed
# THRESHOLD. First class in this list with prob >= THRESHOLD wins. Edit to
# change priority. Must be a subset of the model's output class names.
#
# User's example 2026-07-01: FALL > TRANSITION > WALKING > STILL > EMPTY (5 items).
# We insert FLOORED right after FALL_IMPACT because FLOORED represents "person
# already on the ground after a fall" — clinically as urgent as the impact itself.
PRIORITY_ORDER: list[str] = [
    "FALL_IMPACT",   # 1. highest — life-critical (moment of fall)
    "FLOORED",       # 2. person already on ground (post-fall recovery)
    "TRANSITION",    # 3. mid-motion, often a fall precursor
    "WALKING",       # 4. active motion
    "STILL",         # 5. standing/sitting
    "EMPTY",         # 6. no one in the room
]

UPDATE_HZ: float = 5.0          # matplotlib FuncAnimation redraw rate
POLL_SEC: float = 0.5           # InferenceWorker poll interval (matches CLI)
ROLLING_SEC: float = 30.0       # amplitude stream display window
QUEUE_MAX: int = 10             # drop-oldest if UI stalls
AMP_DOWNSAMPLE: int = 4        # 430 pts/chunk → ~107 pts/chunk
CHUNK_SEC: float = 6.0          # must match receiver.py (NON-OVERLAPPING)

# Class colors — extend CLASS_COLORS from collect.py with FALL_IMPACT/FLOORED
# for visual consistency with collection_mouse.py's labeling UI.
CLASS_COLORS: dict[str, tuple[float, float, float]] = {
    "EMPTY":       (0.78, 0.78, 0.78),
    "STILL":       (0.55, 0.85, 0.55),
    "WALKING":     (0.50, 0.70, 0.95),
    "TRANSITION":  (0.95, 0.85, 0.40),
    "FALL_IMPACT": (0.95, 0.30, 0.30),
    "FLOORED":     (0.70, 0.15, 0.15),
}

# ─────────────────────────────────────────────────────────────────────────────
# Imports — must come AFTER constants but BEFORE matplotlib.use()
# ─────────────────────────────────────────────────────────────────────────────

import argparse
import queue
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Literal, TypedDict

# Matplotlib backend: match collection_mouse.py convention (TkAgg).
# Try/except is intentional — on headless / non-Tk systems it falls back silently.
import matplotlib

try:
    matplotlib.use("TkAgg")
except Exception:
    pass
import matplotlib.animation as animation
import matplotlib.pyplot as plt
import numpy as np

# Make `infer_loop_ensemble` and `train_lstm`/`train_cnn_deep` importable.
# Mirrors infer_loop_ensemble.py:60 and 69-72 (CLAUDE.md §7 — must keep these).
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_PROJECT_ROOT / "src" / "pc_tools" / "inference"))
sys.path.insert(0, str(_PROJECT_ROOT / "src" / "pc_tools"))
sys.path.insert(0, str(_PROJECT_ROOT / "fall-detection-training" / "training"))

# Reuse inference core (DO NOT modify — see CLAUDE.md 红线).
import torch                                                # noqa: E402
import torch.nn.functional as F                             # noqa: E402
from infer_loop_ensemble import (                            # noqa: E402
    check_rx_presence,
    chunk_to_cnn_spectrogram,
    chunk_to_lstm_features,
    classes_from_dataset,
    features_to_lstm_sequence,
    load_cnn,
    load_lstm,
    pick_device,
    recover_feature_stats,
)

# ─────────────────────────────────────────────────────────────────────────────
# Frame (the queue payload)
# ─────────────────────────────────────────────────────────────────────────────


class Frame(TypedDict, total=False):
    """One unit of state pushed from InferenceWorker to Frontend.

    `kind` discriminates which fields are populated:
      "result"  → normal inference output
      "waiting" → no new chunks yet (heartbeat so UI knows worker is alive)
      "fatal"   → RX disconnect; worker is exiting; UI should paint red banner
      "error"   → transient error (chunk skipped); UI shows warning
    """
    kind: Literal["result", "waiting", "fatal", "error"]
    t_chunk: float                              # session-relative seconds
    chunk_name: str                             # "chunk_..._0042.npz"
    probs: np.ndarray                           # (n_classes,) fused prob vector
    cnn_prob: np.ndarray | None
    lstm_prob: np.ndarray | None
    amp_streams: dict[str, np.ndarray]          # rx_name -> (n_pts,) mean amp
    t_offset: float                             # running t_offset
    n_windows_in_ring: int                      # for "LSTM warming up X/16"
    error_msg: str                              # populated for kind=="error"
    missing_rx: list[str]                       # populated for kind=="fatal"


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────


def pick_active(
    probs: np.ndarray,
    classes: list[str],
    threshold: float,
    priority: list[str],
) -> tuple[str, float] | None:
    """Walk `priority`; return (name, prob) of the first class whose prob >= threshold.

    Returns None if no priority class exceeds threshold. Uses dict lookup (not
    positional indexing) so it works regardless of class-name order in `classes`.
    """
    prob_dict = dict(zip(classes, probs.tolist()))
    for cls in priority:
        p = prob_dict.get(cls)
        if p is not None and p >= threshold:
            return cls, float(p)
    return None


def downsample_amplitudes(arr: np.ndarray, factor: int) -> np.ndarray:
    """Cheap `arr[::factor]` decimation for plotting. No anti-alias — visual only."""
    if arr.size == 0 or factor <= 1:
        return arr
    return arr[::factor]


def extract_amplitude_streams(chunk_path: Path) -> dict[str, np.ndarray]:
    """Read amplitudes_<name> from a chunk, return dict of per-RX amplitude SPECTRUM.

    Per user 2026-07-01: changed from "mean over subcarriers" (1D time series) to
    "mean over time" (1D frequency response = 192 subcarriers). Each output array
    has shape (192,) — one value per WiFi OFDM subcarrier. Used by frontend Row 1
    to plot amplitude-vs-frequency spectrum per RX.

    Returns {} on load failure (defensive — caller skips plotting for that chunk).
    """
    try:
        csi = np.load(chunk_path)
        rx_names = [str(n) for n in csi["rx_names"]]
        out: dict[str, np.ndarray] = {}
        for name in rx_names:
            key = f"amplitudes_{name}"
            if key in csi.files:
                # Mean over time → 1D frequency response (192 subcarriers).
                # Shape: (n_timesteps, 192) → (192,)
                out[name] = csi[key].mean(axis=0).astype(np.float32)
        return out
    except Exception:
        return {}


def class_color(cls: str) -> tuple[float, float, float]:
    return CLASS_COLORS.get(cls, (0.5, 0.5, 0.5))


# ─────────────────────────────────────────────────────────────────────────────
# InferenceWorker (background thread)
# ─────────────────────────────────────────────────────────────────────────────


class InferenceWorker(threading.Thread):
    """Background thread: poll data/live/, run inference, push Frame to queue.

    Mirrors MultiPortReader pattern (csi_io.py:50,86,103):
        daemon=True, threading.Event() for stop signaling.

    Per-chunk pipeline (mirrors infer_loop_ensemble.py main loop):
        check_rx_presence (HARD-FAIL on missing) →
        chunk_to_cnn_spectrogram → CNN forward →
        chunk_to_lstm_features → ring buffer → LSTM forward (when 16 windows) →
        alpha-fuse → push Frame(kind="result", ...)

    NEVER touches matplotlib (thread-safety violation). Only numpy + torch + queue.
    """

    def __init__(
        self,
        live_dir: Path,
        dataset_dir: Path,
        lstm_ckpt: Path,
        cnn_ckpt: Path,
        device: str,
        alpha: float,
        poll_sec: float,
        allow_missing_rxs: bool,
        out_queue: "queue.Queue[Frame]",
    ):
        super().__init__(daemon=True, name="InferenceWorker")
        self.live_dir = live_dir
        self.dataset_dir = dataset_dir
        self.lstm_ckpt = lstm_ckpt
        self.cnn_ckpt = cnn_ckpt
        self.device = device
        self.alpha = alpha
        self.poll_sec = poll_sec
        self.allow_missing_rxs = allow_missing_rxs
        self.queue = out_queue

        self.classes: list[str] = classes_from_dataset(dataset_dir) or []
        self.stop_event = threading.Event()

        # State (only touched from this thread)
        self.t_offset: float = 0.0            # chunk-relative timestamp base
        self.seen: set[str] = set()           # chunk names already processed
        self.feature_ring: deque = deque(maxlen=64)   # (X_window, t_center)
        self.frames_dropped: int = 0          # for status line

        # Models (lazy: load inside run() to keep __init__ fast)
        self.lstm_model = None
        self.cnn_model = None
        self.mu: np.ndarray | None = None
        self.sd: np.ndarray | None = None

    # ── Lifecycle ──

    def stop(self) -> None:
        self.stop_event.set()

    # ── Queue helpers ──

    def _push(self, frame: Frame) -> None:
        """Bounded put: drop oldest if queue is full. Never blocks the worker."""
        try:
            self.queue.put_nowait(frame)
        except queue.Full:
            try:
                self.queue.get_nowait()      # discard oldest
                self.frames_dropped += 1
                self.queue.put_nowait(frame)
            except queue.Empty:
                pass

    # ── Main loop ──

    def run(self) -> None:
        # Load models + recover mu/sd (GIL-bound ~2.5s; OK at startup)
        try:
            self.classes = classes_from_dataset(self.dataset_dir) or []
            if not self.classes:
                self._push({"kind": "error", "error_msg":
                            f"no labels_v2.json under {self.dataset_dir}/"})
                return
            n_classes = len(self.classes)
            stats = recover_feature_stats(self.dataset_dir)
            if stats is None:
                self._push({"kind": "error", "error_msg":
                            f"recover_feature_stats failed for {self.dataset_dir}/"})
                return
            self.mu, self.sd = stats
            self.lstm_model = load_lstm(self.lstm_ckpt, n_classes, self.device)
            self.cnn_model = load_cnn(self.cnn_ckpt, n_classes, self.device)
        except Exception as exc:
            self._push({"kind": "error", "error_msg":
                        f"model load failed: {type(exc).__name__}: {exc}"})
            return

        # Heartbeat: UI knows we're alive even before first chunk.
        self._push({"kind": "waiting", "error_msg":
                    "models loaded, polling data/live/"})

        while not self.stop_event.is_set():
            try:
                self._poll_once()
            except Exception as exc:
                self._push({"kind": "error", "error_msg":
                            f"poll error: {type(exc).__name__}: {exc}"})
            time.sleep(self.poll_sec)

    def _poll_once(self) -> None:
        """Single polling cycle. Caller wraps in try/except."""
        chunks = sorted(self.live_dir.glob("chunk_*.npz"))
        new_chunks = [p for p in chunks if p.name not in self.seen]

        for ck in new_chunks:
            self.seen.add(ck.name)

            # ── RX presence check (HARD-FAIL by default; see dev_doc/7) ──
            present_rx, missing_rx = check_rx_presence(ck)
            if missing_rx and not self.allow_missing_rxs:
                self._push({
                    "kind": "fatal",
                    "chunk_name": ck.name,
                    "missing_rx": missing_rx,
                    "error_msg": (f"RX boards missing in {ck.name}: {missing_rx}. "
                                  f"Hardware issue — agent cannot fix."),
                })
                # Worker exits; UI shows red banner.
                self.stop_event.set()
                return
            elif missing_rx:
                self._push({"kind": "error", "chunk_name": ck.name, "error_msg":
                            f"missing RX {missing_rx} (continuing in lenient mode)"})

            # ── CNN spectrogram + forward ──
            try:
                spec = chunk_to_cnn_spectrogram(ck)
            except Exception as exc:
                self._push({"kind": "error", "chunk_name": ck.name, "error_msg":
                            f"CNN spec failed: {type(exc).__name__}: {exc}"})
                self.t_offset += CHUNK_SEC
                continue

            cnn_prob = None
            cnn_time = None
            if spec is not None:
                x = torch.from_numpy(spec).unsqueeze(0).to(self.device)
                with torch.no_grad():
                    logits = self.cnn_model(x)
                    cnn_prob = F.softmax(logits, dim=1)[0].cpu().numpy()
                cnn_time = self.t_offset + 3.0

            # ── LSTM features + ring buffer + forward ──
            try:
                X_chunk, t_chunk = chunk_to_lstm_features(ck, self.t_offset)
            except Exception as exc:
                self._push({"kind": "error", "chunk_name": ck.name, "error_msg":
                            f"LSTM feat failed: {type(exc).__name__}: {exc}"})
                X_chunk = np.zeros((0,))

            for w_idx in range(len(X_chunk)):
                self.feature_ring.append((X_chunk[w_idx], t_chunk[w_idx]))

            lstm_prob = None
            lstm_time = None
            seq = features_to_lstm_sequence(self.feature_ring)
            if seq is not None and self.mu is not None:
                seq_norm = (seq - self.mu) / self.sd
                x = torch.from_numpy(seq_norm).unsqueeze(0).to(self.device)
                with torch.no_grad():
                    logits = self.lstm_model(x)
                    lstm_prob = F.softmax(logits, dim=1)[0].cpu().numpy()
                lstm_time = self.feature_ring[-1][1]

            # ── Amplitude streams for plotting ──
            amp_streams = extract_amplitude_streams(ck)

            # ── Emit Frame ──
            if cnn_prob is not None and lstm_prob is not None:
                ens = self.alpha * lstm_prob + (1.0 - self.alpha) * cnn_prob
                self._push({
                    "kind": "result",
                    "chunk_name": ck.name,
                    "t_chunk": float(cnn_time),
                    "probs": ens,
                    "cnn_prob": cnn_prob,
                    "lstm_prob": lstm_prob,
                    "amp_streams": amp_streams,
                    "t_offset": self.t_offset,
                    "n_windows_in_ring": len(self.feature_ring),
                })
            elif cnn_prob is not None:
                # LSTM still warming up (need 16 windows).
                self._push({
                    "kind": "result",
                    "chunk_name": ck.name,
                    "t_chunk": float(cnn_time),
                    "probs": cnn_prob,
                    "cnn_prob": cnn_prob,
                    "lstm_prob": None,
                    "amp_streams": amp_streams,
                    "t_offset": self.t_offset,
                    "n_windows_in_ring": len(self.feature_ring),
                })

            self.t_offset += CHUNK_SEC


# ─────────────────────────────────────────────────────────────────────────────
# Frontend (matplotlib main thread)
# ─────────────────────────────────────────────────────────────────────────────


class Frontend:
    """Matplotlib-based real-time UI for CSI inference.

    The FuncAnimation update() never touches numpy/torch/disk — it only reads
    the queue and updates artists. This guarantees matplotlib rendering does
    NOT block data receiving (per user 2026-07-01 requirement).
    """

    def __init__(
        self,
        worker: InferenceWorker,
        classes: list[str],
        threshold: float,
        priority: list[str],
        update_hz: float,
        rolling_sec: float,
        amp_downsample: int,
    ):
        self.worker = worker
        self.classes = classes
        self.threshold = threshold
        self.priority = priority
        self.update_hz = update_hz
        self.rolling_sec = rolling_sec
        self.amp_downsample = amp_downsample

        # Per-RX amplitude SPECTRUM state (per user 2026-07-01: abandon amp-vs-time,
# use amp-vs-frequency instead). Each entry is a (192,) ndarray — one value per
# WiFi OFDM subcarrier (frequency axis). On new chunk, start 6s smoothstep
# interpolation from current display to new target.
        self.spectra: dict[str, np.ndarray] = {}           # currently shown
        self.spectra_source: dict[str, np.ndarray] = {}    # interp start
        self.spectra_target: dict[str, np.ndarray] = {}    # interp end
        self.spectra_interp_start: float | None = None
        self.n_subcarriers: int = 192                       # default; updated on first chunk

        # Latest state (updated each frame)
        self.latest_probs: np.ndarray | None = None
        self.latest_active: tuple[str, float] | None = None
        self.latest_chunk: str = ""
        self.latest_t_offset: float = 0.0
        self.latest_lstm_warmup: int = 0
        self.kind: Literal["result", "waiting", "fatal", "error"] = "waiting"
        self.last_error: str = ""

        # Recent class history (for status line)
        self.class_history: deque = deque(maxlen=10)

        # ── Smooth-interpolation state for probs/banner ──
        # Receiver writes 1 chunk per 6s, so without interpolation the banner
        # "jumps" every 6s. We animate from "old" to "new" over CHUNK_SEC using
        # smoothstep easing — banner looks like it's "morphing" rather than
        # snapping, matching collection_mouse.py's continuous-waveform feel.
        self.display_probs: np.ndarray | None = None     # currently shown (lerped)
        self.source_probs: np.ndarray | None = None      # interpolation start
        self.target_probs: np.ndarray | None = None      # interpolation end
        self.interp_start_t: float | None = None         # monotonic() when started

        # ── Figure ──
        self.fig = plt.figure(figsize=(13.0, 9.0))
        self._build_figure()

    def _build_figure(self) -> None:
        gs = self.fig.add_gridspec(
            4, 1, height_ratios=[1.6, 1.4, 1.6, 0.6], hspace=0.5,
        )
        self.fig.suptitle(
            "Bouy — Real-time CSI Fall Detection (LSTM + CNN ensemble)",
            fontsize=13, fontweight="bold",
        )
        self.fig.subplots_adjust(top=0.94, bottom=0.06, left=0.07, right=0.97)

        # Row 0: BIG active-class banner
        self.ax_banner = self.fig.add_subplot(gs[0, 0])
        self.ax_banner.set_axis_off()
        self.banner_text = self.ax_banner.text(
            0.5, 0.65, "Waiting for chunks…", ha="center", va="center",
            fontsize=44, fontweight="bold", color="dimgray",
            transform=self.ax_banner.transAxes,
        )
        self.banner_sub = self.ax_banner.text(
            0.5, 0.18, "(models loaded, polling data/live/)",
            ha="center", va="center", fontsize=12, color="dimgray",
            transform=self.ax_banner.transAxes,
        )
        self.banner_threshold = self.ax_banner.text(
            0.5, -0.05,
            f"THRESHOLD = {self.threshold:.2f}    |    "
            f"priority: {' > '.join(self.priority)}",
            ha="center", va="center", fontsize=9, color="dimgray",
            family="monospace", transform=self.ax_banner.transAxes,
        )

        # Row 1: 4 RX amplitude streams (shared x-axis, distinct colors)
        self.ax_amps = self.fig.add_subplot(gs[1, 0])
        self.ax_amps.set_xlim(-self.rolling_sec, 0)
        self.ax_amps.set_xlabel(f"seconds (last {self.rolling_sec:.0f}s)")
        self.ax_amps.set_ylabel("mean amplitude")
        self.ax_amps.grid(True, alpha=0.3)
        self.amp_lines: dict[str, object] = {}

        # Row 2: 6-class probability bars (horizontal, threshold line)
        self.ax_probs = self.fig.add_subplot(gs[2, 0])
        self.ax_probs.set_xlim(0, 1.0)
        self.ax_probs.set_ylim(-0.5, len(self.classes) - 0.5)
        self.ax_probs.set_yticks(range(len(self.classes)))
        self.ax_probs.set_yticklabels(self.classes, fontsize=10)
        self.ax_probs.invert_yaxis()
        self.ax_probs.set_xlabel("probability")
        self.ax_probs.grid(True, axis="x", alpha=0.3)
        # Threshold line (fixed; red dashed)
        self.ax_probs.axvline(
            self.threshold, color="red", linestyle="--", linewidth=1.5,
            label=f"threshold = {self.threshold:.2f}",
        )
        self.ax_probs.legend(loc="lower right", fontsize=8, frameon=False)
        # Bar artists (one per class) — start empty (zero width)
        self.prob_bars = self.ax_probs.barh(
            range(len(self.classes)), [0.0] * len(self.classes),
            color=[class_color(c) for c in self.classes],
            edgecolor="black", linewidth=0.5,
        )
        self.prob_text = [
            self.ax_probs.text(0.02, i, "0.00", va="center", fontsize=9,
                               family="monospace")
            for i in range(len(self.classes))
        ]

        # Row 3: status text (mono)
        self.ax_status = self.fig.add_subplot(gs[3, 0])
        self.ax_status.set_axis_off()
        self.status_text = self.ax_status.text(
            0.0, 0.5, "initializing…", ha="left", va="center",
            fontsize=10, family="monospace",
            transform=self.ax_status.transAxes,
        )

    # ── Per-section update methods (small + fast) ──

    def _update_banner(self) -> None:
        if self.kind == "fatal":
            self.banner_text.set_text("RX DISCONNECT")
            self.banner_text.set_color((0.9, 0.1, 0.1))
            self.ax_banner.set_facecolor((1.0, 0.7, 0.7, 0.30))
            self.banner_sub.set_text(self.last_error or "(see status line)")
            self.banner_sub.set_color((0.7, 0.05, 0.05))
            return
        if self.kind == "waiting":
            self.banner_text.set_text("Waiting for chunks…")
            self.banner_text.set_color("dimgray")
            self.ax_banner.set_facecolor((1.0, 1.0, 1.0, 1.0))
            self.banner_sub.set_text(self.last_error or "(models loaded, polling data/live/)")
            self.banner_sub.set_color("dimgray")
            return
        if self.kind == "error":
            # Transient: still show last active class if we have one
            pass

        # Use INTERPOLATED display_probs (set by _compute_display_probs in update()).
        # Recompute pick_active each tick so the banner reacts to the smooth lerp
        # — active class can flicker between two near-threshold states, which is
        # actually informative (shows the model is uncertain).
        if self.display_probs is None:
            return
        active = pick_active(
            self.display_probs, self.classes, self.threshold, self.priority,
        )

        if active is None:
            self.banner_text.set_text("(below threshold)")
            self.banner_text.set_color("dimgray")
            self.ax_banner.set_facecolor((1.0, 1.0, 1.0, 1.0))
            self.banner_sub.set_text(
                f"max prob = {float(self.display_probs.max()):.3f} (< {self.threshold:.2f})"
            )
            self.banner_sub.set_color("dimgray")
            return

        active_cls, active_prob = active
        color = class_color(active_cls)
        self.banner_text.set_text(active_cls)
        self.banner_text.set_color(tuple(min(c * 0.55, 1.0) for c in color))
        self.ax_banner.set_facecolor((color[0], color[1], color[2], 0.22))

        # Sub-line: second-highest class for "transitioning" hint
        sorted_classes = sorted(
            zip(self.classes, self.display_probs.tolist()),
            key=lambda kv: -kv[1],
        )
        if len(sorted_classes) >= 2 and sorted_classes[0][0] == active_cls:
            second_cls, second_prob = sorted_classes[1]
            self.banner_sub.set_text(
                f"2nd: {second_cls} ({second_prob:.3f})    |    "
                f"active prob = {active_prob:.3f}"
            )
            self.banner_sub.set_color(class_color(second_cls))
        else:
            self.banner_sub.set_text(f"active prob = {active_prob:.3f}")
            self.banner_sub.set_color("dimgray")

    def _update_amps(self) -> None:
        """Plot 4 RX amplitude SPECTRA (amplitude vs subcarrier / frequency).

        Per user 2026-07-01: Row 1 is no longer amplitude-vs-time. It now shows
        amplitude-vs-frequency per RX (one line per RX, x = subcarrier index 0..N-1
        = WiFi OFDM frequency axis). Updates via 6s smoothstep interpolation
        driven by `_compute_display_spectra()` (called from update()).
        """
        if not self.spectra:
            return  # no data yet — keep empty axes

        # Lazy-init lines for newly-seen RX names
        for name in self.spectra:
            if name not in self.amp_lines:
                (line,) = self.ax_amps.plot(
                    np.arange(self.n_subcarriers), self.spectra[name],
                    label=name, linewidth=1.2,
                    color=class_color(name) if name in CLASS_COLORS else None,
                )
                self.amp_lines[name] = line

        # Update each line with latest interpolated spectrum data
        for name, line in self.amp_lines.items():
            spec = self.spectra.get(name)
            if spec is not None and spec.size == self.n_subcarriers:
                line.set_data(np.arange(self.n_subcarriers), spec)

        # Axis setup (once per axis instance)
        # Use a sentinel to detect old vs new label (was "seconds (last 30s)" before).
        if self.ax_amps.get_xlabel() != f"subcarrier index (0–{self.n_subcarriers - 1}, WiFi OFDM)":
            self.ax_amps.set_xlabel(
                f"subcarrier index (0–{self.n_subcarriers - 1}, WiFi OFDM)"
            )
            self.ax_amps.set_ylabel("amplitude (mean over chunk)")
            self.ax_amps.grid(True, alpha=0.3)
        # X-axis is fixed (frequency domain); Y auto-scales to data range
        self.ax_amps.set_xlim(0, self.n_subcarriers - 1)
        if self.spectra:
            all_vals = np.concatenate(list(self.spectra.values()))
            lo, hi = float(all_vals.min()), float(all_vals.max())
            pad = (hi - lo) * 0.1 if hi > lo else 1.0
            self.ax_amps.set_ylim(lo - pad, hi + pad)

        # Legend (once)
        if self.amp_lines and not self.ax_amps.get_legend():
            self.ax_amps.legend(loc="upper right", fontsize=8, ncol=4, frameon=False)

    def _compute_display_spectra(self) -> None:
        """Advance the in-flight spectrum interpolation by one tick.

        Mirrors _compute_display_probs but operates on dict[str, np.ndarray]
        (one spectrum per RX). Lerps source → target over CHUNK_SEC with
        smoothstep easing. On completion, snaps to target and clears source.
        """
        if self.spectra_interp_start is None:
            return
        elapsed = time.monotonic() - self.spectra_interp_start
        alpha = min(1.0, max(0.0, elapsed / CHUNK_SEC))
        if alpha >= 1.0:
            # Snap to target, clear interpolation state
            for rx_name, tgt in self.spectra_target.items():
                self.spectra[rx_name] = tgt.copy()
            self.spectra_source = {}
            self.spectra_target = {}
            self.spectra_interp_start = None
            return
        eased = alpha * alpha * (3.0 - 2.0 * alpha)
        for rx_name in list(self.spectra.keys()):
            src = self.spectra_source.get(rx_name)
            tgt = self.spectra_target.get(rx_name)
            if src is None or tgt is None:
                continue
            self.spectra[rx_name] = src * (1.0 - eased) + tgt * eased

    def _update_probs(self) -> None:
        if self.display_probs is None:
            return
        probs = self.display_probs
        # Recompute active class from interpolated probs (matches _update_banner)
        active = pick_active(probs, self.classes, self.threshold, self.priority)
        active_cls = active[0] if active else None
        for i, (cls, bar) in enumerate(zip(self.classes, self.prob_bars)):
            bar.set_width(float(probs[i]))
            bar.set_edgecolor("black" if cls == active_cls else "none")
            bar.set_linewidth(2.5 if cls == active_cls else 0.5)
            self.prob_text[i].set_text(f"{probs[i]:.3f}")
            self.prob_text[i].set_x(float(probs[i]) + 0.02)

    def _update_status(self) -> None:
        # 2 lines: chunk metadata / history
        warmup_pct = int(100 * min(self.latest_lstm_warmup, 16) / 16)
        line1 = (
            f"chunk={self.latest_chunk or '(none)'}   "
            f"t_offset={self.latest_t_offset:.1f}s   "
            f"LSTM={self.latest_lstm_warmup}/16 ({warmup_pct}%)   "
            f"α={self.worker.alpha:.2f}   "
            f"frames_dropped={self.worker.frames_dropped}"
        )
        history_str = " ".join(self.class_history) if self.class_history else "(empty)"
        line2 = f"recent classes: {history_str}"
        if self.last_error:
            line2 += f"\nLAST ERROR: {self.last_error}"
        self.status_text.set_text(f"{line1}\n{line2}")

    # ── Queue drain (called by FuncAnimation) ──

    def _drain_queue(self) -> None:
        """Drain queue and update state.

        Per user 2026-07-01: Row 1 is now amplitude-vs-frequency (spectrum per RX),
        NOT amplitude-vs-time. So we keep only the LATEST spectrum per RX (no
        rolling buffer). Each new chunk starts a 6s smoothstep interpolation
        from current display → new target, same as probs/banner.
        """
        latest: Frame | None = None
        while not self.worker.queue.empty():
            try:
                frame = self.worker.queue.get_nowait()
            except queue.Empty:
                break
            latest = frame
        if latest is None:
            return

        self.kind = latest["kind"]
        if self.kind == "fatal":
            self.last_error = latest.get("error_msg", "RX disconnect")
            return
        if self.kind == "waiting":
            self.last_error = latest.get("error_msg", "")
            return
        if self.kind == "error":
            self.last_error = latest.get("error_msg", "")
            return

        # kind == "result"
        new_probs = latest.get("probs")
        self.latest_chunk = latest.get("chunk_name", "")
        self.latest_t_offset = latest.get("t_offset", 0.0)
        self.latest_lstm_warmup = latest.get("n_windows_in_ring", 0)
        self.last_error = ""

        # ── Probs interpolation (same as before) ──
        if new_probs is not None:
            if self.display_probs is None:
                self.display_probs = new_probs.copy()
                self.source_probs = None
                self.target_probs = None
            else:
                self.source_probs = self.display_probs.copy()
                self.target_probs = new_probs.copy()
                self.interp_start_t = time.monotonic()
            self.latest_probs = new_probs
            self.latest_active = pick_active(
                new_probs, self.classes,
                self.threshold, self.priority,
            )
            if self.latest_active is not None:
                self.class_history.append(self.latest_active[0])

        # ── Spectrum update: latest only, 6s smoothstep lerp ──
        new_spectra = latest.get("amp_streams", {})
        if new_spectra:
            # Update n_subcarriers from first chunk (default 192)
            first = next(iter(new_spectra.values()))
            self.n_subcarriers = int(first.size)
            if not self.spectra:
                # First chunk: just show immediately
                self.spectra = {k: v.copy() for k, v in new_spectra.items()}
                self.spectra_source = {}
                self.spectra_target = {}
                self.spectra_interp_start = None
            else:
                # Snapshot current display as source, new as target
                self.spectra_source = {k: v.copy() for k, v in self.spectra.items()}
                self.spectra_target = {k: v.copy() for k, v in new_spectra.items()}
                self.spectra_interp_start = time.monotonic()

    # ── Smooth interpolation helper ──

    def _compute_display_probs(self) -> np.ndarray | None:
        """Advance the in-flight probs interpolation by one tick.

        Lerp from source to target over CHUNK_SEC (=6s) using smoothstep
        easing for a more natural feel than linear. When interpolation
        completes (alpha >= 1.0), snap to target and clear the source.
        Returns the current display_probs (or None if not yet available).
        """
        if self.display_probs is None:
            return None
        if self.source_probs is None or self.target_probs is None:
            # No active interpolation — display is the latest target.
            return self.display_probs
        elapsed = time.monotonic() - self.interp_start_t
        alpha = min(1.0, max(0.0, elapsed / CHUNK_SEC))
        # Smoothstep easing (3α² − 2α³): starts slow, ends slow, fast in middle
        eased = alpha * alpha * (3.0 - 2.0 * alpha)
        self.display_probs = (
            self.source_probs * (1.0 - eased) + self.target_probs * eased
        )
        if alpha >= 1.0:
            self.source_probs = None
            self.target_probs = None
        return self.display_probs

    # ── Animation tick ──

    def update(self, _frame) -> list:
        try:
            self._drain_queue()
            # Advance interpolations BEFORE the display methods read them.
            self._compute_display_probs()
            self._compute_display_spectra()
            self._update_banner()
            self._update_amps()
            self._update_probs()
            self._update_status()
        except Exception as exc:
            # Surface to status; never let matplotlib swallow silently.
            self.status_text.set_text(f"update error: {type(exc).__name__}: {exc}")
        return []

    def run(self) -> int:
        interval_ms = max(100, int(1000 / self.update_hz))
        ani = animation.FuncAnimation(
            self.fig, self.update, interval=interval_ms,
            blit=False, cache_frame_data=False,
        )
        # Close-event handler: stop worker cleanly
        def _on_close(_event):
            self.worker.stop()
        self.fig.canvas.mpl_connect("close_event", _on_close)
        try:
            plt.show()
        finally:
            self.worker.stop()
            self.worker.join(timeout=2.0)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# main()
# ─────────────────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    _PROJECT_ROOT = Path(__file__).resolve().parents[3]
    parser.add_argument(
        "--live-dir", type=Path,
        default=_PROJECT_ROOT / "data" / "live",
        help="Directory where receiver.py writes chunk_*.npz. Default: data/live/ "
             "(absolute path, anchored to __file__ to avoid cwd drift — see CLAUDE.md §7).",
    )
    parser.add_argument(
        "--dataset", type=Path,
        default=_PROJECT_ROOT / "dataset",
        help="Directory containing labels_v2.json (for class names + mu/sd). "
             "Default: dataset/",
    )
    parser.add_argument(
        "--lstm-ckpt", type=Path,
        default=_PROJECT_ROOT / "fall-detection-training" / "training" / "checkpoints" / "lstm.pt",
    )
    parser.add_argument(
        "--cnn-ckpt", type=Path,
        default=_PROJECT_ROOT / "fall-detection-training" / "training" / "checkpoints" / "cnn.pt",
    )
    parser.add_argument("--alpha", type=float, default=0.5,
                        help="Weight on LSTM (1-alpha on CNN). Default: 0.5")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda", "mps"])
    parser.add_argument("--update-hz", type=float, default=UPDATE_HZ,
                        help=f"matplotlib redraw rate (Hz). Default: {UPDATE_HZ}")
    parser.add_argument("--allow-missing-rxs", action="store_true",
                        help="Opt-in to lenient mode: warn + skip on missing RX "
                             "boards. DEFAULT is STRICT (red banner + worker exit). "
                             "Use only for offline replay.")
    args = parser.parse_args()

    if not args.live_dir.exists():
        print(f"ERROR: live dir does not exist: {args.live_dir}", file=sys.stderr)
        print(f"       (start receiver.py first, or pass --live-dir)", file=sys.stderr)
        return 1

    device = pick_device(args.device)
    classes = classes_from_dataset(args.dataset) or []
    if not classes:
        print(f"ERROR: no labels_v2.json under {args.dataset}/", file=sys.stderr)
        return 1

    print(f"[{time.strftime('%H:%M:%S')}] Starting inference frontend…")
    print(f"  live_dir   = {args.live_dir}")
    print(f"  dataset    = {args.dataset}")
    print(f"  lstm_ckpt  = {args.lstm_ckpt}")
    print(f"  cnn_ckpt   = {args.cnn_ckpt}")
    print(f"  device     = {device}")
    print(f"  α          = {args.alpha:.2f}")
    print(f"  threshold  = {THRESHOLD:.2f}")
    print(f"  priority   = {' > '.join(PRIORITY_ORDER)}")
    print(f"  update_hz  = {args.update_hz}")

    # Create queue + worker, start worker
    frame_queue: "queue.Queue[Frame]" = queue.Queue(maxsize=QUEUE_MAX)
    worker = InferenceWorker(
        live_dir=args.live_dir,
        dataset_dir=args.dataset,
        lstm_ckpt=args.lstm_ckpt,
        cnn_ckpt=args.cnn_ckpt,
        device=device,
        alpha=args.alpha,
        poll_sec=POLL_SEC,
        allow_missing_rxs=args.allow_missing_rxs,
        out_queue=frame_queue,
    )
    worker.start()
    print(f"  worker started (daemon={worker.daemon}, name={worker.name})")

    # Build frontend (matplotlib main thread)
    frontend = Frontend(
        worker=worker,
        classes=classes,
        threshold=THRESHOLD,
        priority=PRIORITY_ORDER,
        update_hz=args.update_hz,
        rolling_sec=ROLLING_SEC,
        amp_downsample=AMP_DOWNSAMPLE,
    )
    return frontend.run()


if __name__ == "__main__":
    sys.exit(main())