# CSI Fall-Detection Training Pipeline

End-to-end code for training the Wi-Fi CSI fall-detection model used in the
live dashboard. Four ESP32 boards stream Channel-State-Information packets;
sessions are recorded with per-frame activity labels; a band-spectrogram
LSTM and a CNN are trained per-fold, then ensembled into the shipped
TorchScript model in `model/fall_impact_seq9_ensemble/`.

## Pipeline

```
firmware/   →   collection/   →   labeling/   →   training/   →   evaluation/
 (flash      (record sessions  (split FALL into  (train + ensemble)  (LOOCV +
  boards)     with labels)      IMPACT/FLOORED)                      shipped-model
                                                                     evaluation)
```

## Layout

| Folder | What's in it |
|---|---|
| `firmware/` | C source for `csi_send` / `csi_recv` ESP32 firmware + flash helper scripts. Channel 6, 921600 baud. |
| `collection/` | `collect.py` (4-RX recorder w/ matplotlib labeling UI), `record_v2.sh` / `delete_v2.sh` wrappers, `csi_io.py` (multi-port serial reader), `capture_multi.py` (raw multi-RX capture without labels), `check_boards.py` (sanity check). |
| `labeling/` | `split_fall_labels.py` — splits the recorded `FALL` class into `FALL_IMPACT` (first 1.5 s) + `FLOORED` (rest), writing `labels_v2.json` per session. |
| `external_data_adapter/` | `csi_har_adapter.py` — converts the public CSI-HAR-Dataset (Moshiri et al., Nexmon-on-Pi, 90 Hz × 52 subcarriers) into our session format (4-RX × 192 subcarriers, 70 Hz) so external data can train alongside our recordings. |
| `training/` | `train_lstm.py` (16-feature time-series LSTM), `train_cnn_deep.py` (band-spectrogram 2D CNN), `ensemble_predict.py` (alpha-weighted blend + per-class report). |
| `evaluation/` | `loocv_eval.py` (leave-one-session-out wrapper), `eval_seq9_ensemble.py` (event-level + window-level eval of the shipped TorchScript model), `class_separability.py` (Cohen's d sanity check on robust variance per class). |
| `model/fall_impact_seq9_ensemble/` | Shipped TorchScript ensemble. `fall_impact_seq9_ensemble.ts.pt` is the deployable model; `config.json` has thresholds, post-processing settings, and the input shape `[1, 9, 32, 49, 21]`; the `.pt` files are the source LSTM and Transformer checkpoints used to build it. |

## Quickstart

```bash
# 1. set up env
python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. flash boards (one-time)
firmware/flash_tx.sh
firmware/flash_rx.sh           # repeat for each RX board

# 3. record sessions (4 RX boards plugged in, TX raised above shoulder)
collection/record_v2.sh 02 "real take, TX raised"
collection/record_v2.sh 03
# ... record 5–8 sessions for a usable dataset

# 4. split FALL → FALL_IMPACT + FLOORED labels
.venv/bin/python labeling/split_fall_labels.py --dataset dataset_v2_high_tx

# 5. (optional) check class separability before training
.venv/bin/python evaluation/class_separability.py --dataset dataset_v2_high_tx

# 6. train both architectures
.venv/bin/python training/train_lstm.py \
    --dataset dataset_v2_high_tx --labels labels_v2.json \
    --source ours --t-seq 16 --epochs 30 \
    --ckpt checkpoints/lstm.pt

.venv/bin/python training/train_cnn_deep.py \
    --dataset dataset_v2_high_tx --labels labels_v2.json \
    --source ours --epochs 80 --augment \
    --ckpt checkpoints/cnn.pt

# 7. ensemble + alpha sweep on the held-out test session
.venv/bin/python training/ensemble_predict.py \
    --dataset dataset_v2_high_tx --labels labels_v2.json --source ours \
    --lstm-ckpt checkpoints/lstm.pt --cnn-ckpt checkpoints/cnn.pt

# 8. honest evaluation: leave-one-session-out across all sessions
.venv/bin/python evaluation/loocv_eval.py --dataset dataset_v2_high_tx

# 9. evaluate the SHIPPED ensemble (no training, just inference + metrics)
.venv/bin/python evaluation/eval_seq9_ensemble.py
```

## Class set

Six classes; the labels file is per-session JSON keyed by frame range.

```
EMPTY        — no one in the room
STILL        — person present, not moving
WALKING      — person walking
TRANSITION   — sit/stand/bend
FALL_IMPACT  — first 1.5 s of a fall (the impact event)
FLOORED      — person is on the floor after the fall
```

The shipped model is binary (`FALL_IMPACT` vs `NOT_FALL_IMPACT`) with the 6-class labels collapsed at training time.

## Feature pipeline

- **LSTM input**: 16-dim per-window summary features (per-RX robust variance, top-band energy ratios, etc.) over a 16-window sequence.
- **CNN input**: band-spectrogram tensor of shape `(32 channels, 49 freq, 21 time)`. 8 frequency bands × 4 RXs = 32 channels. STFT with `nperseg=96`, `noverlap=80` over a 6-second window at ~70 Hz. log1p + per-channel z-score normalization.
- **Ensemble**: 9 stacked 6-second windows (1 s hop) → 14-second receptive field.

## Hardware notes

- 4 ESP32 RX boards + 1 ESP32 TX board, all on Wi-Fi channel 6.
- USB serial at 921600 baud.
- 192 subcarriers per packet, ~70 Hz packet rate.
- Mac: `/dev/cu.usbserial-*`. Linux: `/dev/ttyUSB*` (you'll need to update the device discovery in `collect.py` / `csi_io.py`).

## Notes on the shipped model

`model/fall_impact_seq9_ensemble/` was trained on a 7-session dataset using LOOCV. Reported on the held-out window-level test set: macro-F1 = 0.81, FALL_IMPACT recall = 91% at threshold 0.50. Event-level pooled F1 = 0.93 at threshold 0.50, 0.87 at 0.84.

The model is a TorchScript blend of a sequence LSTM and a Transformer encoder. Calibrated probabilities (temperature 0.3). Suggested deployment thresholds: `0.50` (balanced demo) / `0.84` (low false alert).
