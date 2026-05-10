# Fall Impact Seq9 Ensemble Export

Files:

- `fall_impact_seq9_ensemble.ts.pt`: TorchScript ensemble. Input shape is `[batch, 9, 32, 49, 21]`.
- `config.json`: class names, thresholds, post-processing settings, and evaluation summary.
- `lstm_best_model.pt` / `transformer_best_model.pt`: source PyTorch checkpoints.

The TorchScript model returns calibrated probabilities for:

1. `NOT_FALL_IMPACT`
2. `FALL_IMPACT`

Suggested thresholds:

- Balanced demo: `0.50`
- Low false alert: `0.84`
