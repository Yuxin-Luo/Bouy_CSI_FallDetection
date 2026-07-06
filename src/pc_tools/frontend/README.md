# CSI Fall Detection — Real-time Inference Frontend

A matplotlib-based real-time display of the LSTM + CNN ensemble inference,
modeled on `fall-detection-training/collection/collection_mouse.py`'s layout.

## What this is

Single Python script that opens a 4-row matplotlib window showing:

- **Row 0 — Active class banner**: BIG color-coded text of the current
  priority-winner class (e.g. `STILL`, `FALL_IMPACT`, `FLOORED`)
- **Row 1 — 4 RX amplitude streams**: rolling 30s window of mean amplitude
  per RX board (RX1, RX2, RX3, RX4)
- **Row 2 — 6-class probability bars**: horizontal bars with a red dashed
  threshold line; the priority winner gets a black border
- **Row 3 — Status text**: chunk name, t_offset, LSTM warmup %, α, last 10
  classes, errors

Background thread (`InferenceWorker`, daemon=True) polls `data/live/`,
runs the full ensemble pipeline (CNN + LSTM + alpha-fuse), and pushes
results to a bounded queue. Main thread (matplotlib `FuncAnimation`)
drains the queue (drop-oldest) and redraws — **never touches numpy/torch**.
Frontend drawing cannot block data receiving.

## How it fits

```
   ESP32 RX boards (4)
       ↓ (USB serial, 921600 baud)
   src/pc_tools/receiver/receiver.py
       ↓ (writes data/live/chunk_*.npz every 6 s)
   ┌────────────────────────────────────────┐
   │  src/pc_tools/frontend/app.py          │
   │                                        │
   │  [InferenceWorker thread]              │
   │    check_rx_presence → CNN spec →      │
   │    LSTM features → ensemble            │
   │           ↓                            │
   │    queue.Queue(maxsize=10)             │
   │           ↓                            │
   │  [Frontend main thread]                │
   │    FuncAnimation @ 5 fps               │
   │    drains queue → updates artists      │
   └────────────────────────────────────────┘
       ↓
   TkAgg matplotlib window
```

## Quick start

```bash
# Terminal 1: receiver (writes NPZ chunks)
python3 -u src/pc_tools/receiver/receiver.py

# Terminal 2: this frontend
python3 -u src/pc_tools/frontend/app.py
# Optional flags:
#   --alpha 0.5            # LSTM weight (default: 0.5)
#   --device cpu           # auto / cpu / cuda / mps
#   --update-hz 5          # matplotlib redraw rate (default: 5)
#   --allow-missing-rxs    # lenient mode (offline replay only — see Strict RX policy below)
```

Expected first few seconds:
- Banner: "Waiting for chunks…" → transitions to active class once first
  chunk is processed (~6 s after receiver starts)
- After 16 chunks (~96 s): LSTM warmup reaches 100% (ring buffer full)
- Amplitudes: 4 colored lines populating from left to right as time progresses

## Tunables (code-only, NOT exposed in UI)

Edit the constants at the **top of `src/pc_tools/frontend/app.py`**:

| Constant | Default | Meaning |
|---|---|---|
| `THRESHOLD` | `0.50` | Probability gate for active-class selection |
| `PRIORITY_ORDER` | `[FALL_IMPACT, FLOORED, TRANSITION, WALKING, STILL, EMPTY]` | First class with `prob >= THRESHOLD` wins |
| `UPDATE_HZ` | `5.0` | matplotlib redraw rate (Hz) |
| `POLL_SEC` | `0.5` | Worker poll interval (s) |
| `ROLLING_SEC` | `30.0` | Amplitude stream display window (s) |
| `QUEUE_MAX` | `10` | Drop-oldest if UI stalls |
| `AMP_DOWNSAMPLE` | `4` | Decimation factor for amplitude plots |
| `CHUNK_SEC` | `6.0` | MUST match receiver.py (NON-OVERLAPPING chunks) |

**Model-side constants (must match `infer_loop_ensemble.py:91-102`):**

These are imported from `infer_loop_ensemble.py` directly — DO NOT redefine.
If you retrain the model with different window/hop/seq, those constants in
`infer_loop_ensemble.py` must update first; this file follows automatically.

| Constant | Value | Source |
|---|---|---|
| `LSTM_T_SEQ` | `16` | `infer_loop_ensemble.py:101` |
| `LSTM_N_FEAT_PER_RX` | `4` | `infer_loop_ensemble.py:102` |
| `LSTM_WIN_SEC` | `1.0` | `infer_loop_ensemble.py:99` |
| `LSTM_HOP_SEC` | `0.5` | `infer_loop_ensemble.py:100` |
| `NOMINAL_RATE_HZ` | `70.0` | `infer_loop_ensemble.py:94` |

## Strict RX policy

Mirrors `dev_doc/7-bouy-rx-disconnect-policy-2026-07-01.md`. The frontend
NEVER silently fills zeros / skips chunks / falls back to CNN-only when
a RX board is missing — that would mask hardware problems.

| Scenario | Behavior |
|---|---|
| Default (no flag) + RX missing | Red banner `RX DISCONNECT` + worker exits cleanly + window stays open for inspection |
| `--allow-missing-rxs` + RX missing | Yellow warning in status line + worker continues (CNN-only fallback kicks in via the existing `chunk_to_lstm_features` `try/except`) |

The strict flag is the **default** — you must explicitly opt-in to lenient mode.

## Architecture details

### Worker thread (`InferenceWorker`, daemon=True)

```
while not stop_event.is_set():
    try:
        for each new chunk_*.npz in args.live_dir:
            check_rx_presence() → if missing & not allow → push Frame("fatal"), exit
            chunk_to_cnn_spectrogram() → CNN forward → cnn_prob
            chunk_to_lstm_features() → append to ring buffer
            features_to_lstm_sequence() → LSTM forward → lstm_prob (if ring ≥ 16)
            alpha-fuse cnn_prob + lstm_prob → push Frame("result", ...)
            t_offset += 6.0
    except Exception → push Frame("error", msg=...)
    sleep(POLL_SEC)
```

Per-cycle overhead: ~30 ms (glob + set lookup + np.load for 1 chunk + 2 torch forwards).

### Queue payload (`Frame` TypedDict)

```python
class Frame(TypedDict, total=False):
    kind: Literal["result", "waiting", "fatal", "error"]
    chunk_name: str
    t_chunk: float                # session-relative seconds of chunk midpoint
    probs: np.ndarray             # (6,) fused prob vector
    cnn_prob: np.ndarray | None
    lstm_prob: np.ndarray | None
    amp_streams: dict[str, np.ndarray]   # rx_name -> (n_pts,) mean amp
    t_offset: float               # running t_offset
    n_windows_in_ring: int        # for "LSTM warming up X/16"
    error_msg: str
    missing_rx: list[str]
```

### Main thread (`FuncAnimation` @ 5 fps)

`update(_frame)` is called every `interval_ms = 200`:
1. `_drain_queue()` — pop all frames, keep only the **latest** (newer probs
   supersede older; never "catch up")
2. `_update_banner()` — set text/color/facecolor based on `kind` + `latest_active`
3. `_update_amps()` — `set_data()` on each line; trim buffers to `ROLLING_SEC`
4. `_update_probs()` — `set_width()` + `set_edgecolor()` per bar
5. `_update_status()` — 2 mono-font lines

No `time.sleep()`. No numpy/torch on the UI thread. Exceptions are caught
and surfaced to the status line — matplotlib never crashes silently.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Banner stuck on "Waiting for chunks…" | Receiver not running | Start `receiver.py` in another terminal |
| Red `RX DISCONNECT` banner | Hardware problem (USB cable / board power) | Check `/dev/ttyACM*`, re-plug missing board, restart receiver + frontend |
| Banner stuck on a class with prob near 1.0 | Threshold too low for the model's confidence | Edit `THRESHOLD` (raise) or `PRIORITY_ORDER` (re-prioritize) |
| Window frozen | Heavy ops blocking UI | Reduce `--update-hz`; check terminal for traceback |
| Banner says "(below threshold)" | All classes < `THRESHOLD` | Lower `THRESHOLD` (use `HANDOFF-2026-07-01.md` §3 output as calibration reference) |
| `frames_dropped > 0` in status | UI can't keep up with worker | Reduce `--update-hz` or `POLL_SEC`, or close other GUI apps |

## Source layout

```
src/pc_tools/frontend/
├── app.py              # main frontend (~855 lines, single file)
└── README.md           # this file
```

**Critical files referenced:**

- `src/pc_tools/inference/infer_loop_ensemble.py` — 8 reused functions
  (see "Tunables" table above for the import surface)
- `src/pc_tools/receiver/csi_io.py` — `MultiPortReader` threading pattern
  (daemon=True + `threading.Event`) is mirrored in `InferenceWorker`
- `fall-detection-training/collection/collection_mouse.py` — matplotlib
  layout style (gridspec + `FuncAnimation` + close-event handler)
- `dev_doc/7-bouy-rx-disconnect-policy-2026-07-01.md` — strict RX policy
- `dev_doc/8-bouy-frontend-2026-07-01.md` — design rationale + decisions

## License & honest scope

This is a demo frontend built on top of the Bouy open-source project (MIT).
The LSTM + CNN ensemble achieves macro-F1 ≈ 0.444 on test (see
`dev_doc/5-bouy-post-arch-2026-06-30.md` §0.4); it is NOT a validated
medical/safety device. The threshold and priority list are engineering
heuristics — adjust per your deployment after collecting more labeled data.