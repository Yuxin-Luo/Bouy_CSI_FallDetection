"""
state.py — runtime-tunable parameters shared between receiver.py and infer_loop.py.

Both processes poll this file every main-loop iteration (mtime-cached, so
no I/O when nothing changes). Edits to runtime_state.json take effect
within one cycle in either process — no restart needed.

Why this exists (see dev_doc §D.9):
  • Receiver writes NPZ chunks at fixed cadence (--chunk-sec).
  • Infer_loop stacks N chunks per inference cycle (--seq-len).
  • Picking chunk_sec × seq_len controls both end-to-end latency AND
    the model's "receptive field" (temporal context). It needs to match
    how the model was trained (~14s for the shipped Bouy ensemble).
  • Wrong values silently hurt accuracy. Editing argparse defaults +
    restart every time is cumbersome; runtime state lets us tune live.

Design choice: simple JSON file + mtime check, NOT a socket / DB / queue.
  • JSON is human-editable (ctrl+F, no schema migration).
  • mtime cache keeps overhead near zero (~50 bytes read per cycle).
  • Atomic-write via .json.tmp + os.replace (same pattern as receiver's
    NPZ writes — see dev_doc §D.8).

Public surface:
  load_state()       -> dict   read current state (cached; mtime-checked)
  save_state(state)  -> None   write state atomically
  DEFAULTS           dict     used as fallback if file missing / corrupt
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

# Resolve path once at import. <project>/config/runtime_state.json
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
STATE_FILE = _PROJECT_ROOT / "config" / "runtime_state.json"

# All tunables live here. argparse defaults take precedence when starting,
# but state.json overrides can change any of these at runtime.
DEFAULTS: dict[str, Any] = {
    # ─── receiver.py tunables ───
    # Time-length of each NPZ chunk in seconds. The shipped Bouy model
    # was trained with 1.0s hop & 6.0s windows → 14s receptive field.
    # Recommended: 1.0 (1s/包 gives seq_len=14 ↔ 14s receptive field).
    # 6.0 (legacy default) gives 54s receptive field → hurts accuracy.
    "chunk_sec": 1.0,
    # How many recent chunks to keep on disk. At 1s/chunk × 4 RX ×
    # 192 sub × ~80KB compressed = ~5MB total; keep_last=60 = ~5 minutes.
    "keep_last": 60,

    # ─── infer_loop.py tunables ───
    # Number of consecutive chunk-spectrograms to stack into one model
    # input (1, seq_len, 32, 49, 21). Should satisfy:
    #     seq_len * chunk_sec ≈ 14s
    # For chunk_sec=1.0 → seq_len=14 (matches Bouy training 14s exactly).
    # For chunk_sec=6.0 → seq_len=9 (legacy; 54s context — accuracy risk).
    "seq_len": 14,
    # FALL_IMPACT probability threshold for firing an alert.
    # config.json offers: 0.50 (balanced_demo) and 0.84 (low_false_alert).
    "threshold": 0.5,

    # ─── receiver validation ───
    # How many RX boards are expected. If fewer open at startup, receiver warns
    # and chunks will have the wrong spectrogram shape → infer_loop skips them.
    "expected_rx": 4,

    # ─── phase (read-only here, written by receiver in future) ───
    # Coarse state-machine phase. Future enhancement: receiver writes
    # INIT → ACTIVE here once enough chunks accumulated; infer_loop can
    # suppress alerts during INIT. Reserved for §D.10.
    "phase": "ACTIVE",
}

# ─── module-private cache ───
_mtime: float = 0.0
_cached: dict[str, Any] = dict(DEFAULTS)


def _read_mtime() -> float:
    try:
        return STATE_FILE.stat().st_mtime
    except OSError:
        return 0.0


def load_state(force: bool = False) -> dict[str, Any]:
    """Return current state as a dict, falling back to DEFAULTS on missing/corrupt.

    Reads STATE_FILE once and caches by mtime. With force=True (used in
    tests) the cache is bypassed.
    """
    global _mtime, _cached

    cur_mtime = _read_mtime()
    if not force and cur_mtime == _mtime and _cached is not None:
        return _cached

    if not STATE_FILE.exists():
        # First run / file never written — keep using defaults
        _cached = dict(DEFAULTS)
        _mtime = cur_mtime
        return _cached

    try:
        with open(STATE_FILE) as f:
            user_state = json.load(f)
        merged = dict(DEFAULTS)
        merged.update(user_state)
        _cached = merged
        _mtime = cur_mtime
        return merged
    except (json.JSONDecodeError, OSError) as exc:
        # File present but corrupt — keep last good state
        return _cached


def save_state(state: dict[str, Any]) -> None:
    """Atomically write state to STATE_FILE.

    Writes to .json.tmp first then os.replace() — readers always see a
    complete file (no half-written JSON). See §D.8 for the same pattern.
    """
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_FILE.with_suffix(STATE_FILE.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, STATE_FILE)


def set_param(key: str, value: Any) -> None:
    """Convenience: set one key + save. Used by CLI tools / future phase FSM."""
    state = dict(load_state())
    state[key] = value
    save_state(state)


if __name__ == "__main__":
    # Smoke test: print current state + path
    print(f"STATE_FILE = {STATE_FILE}")
    print(f"current state: {json.dumps(load_state(), indent=2)}")