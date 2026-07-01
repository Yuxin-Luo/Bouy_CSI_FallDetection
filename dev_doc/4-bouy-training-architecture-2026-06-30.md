# Bouy 训练流水线架构（用户调研，2026-06-30）

> **调研目标**：用户问"作者的训练又应该如何开始"——澄清 Bouy 项目的真实训练流程、对比我们实际跑出来的（§D.19-D.22），把"参照"的边界说清楚。

---

## 0. 用户提问的两个核心问题

1. **我们练出来的模型是不是只是"参照"**？
2. **作者的模型训练又应该如何开始**？

调研结论先放最前，**后面所有内容都是支撑证据**：

- ✅ 我们练的就是作者本来的代码作者路径（§D.14.5 命令对照表）
- ✅ 作者训练管线**比我们的更复杂**：因为 shipped 模型在 `model/fall_impact_seq9_ensemble/` 有 **3 个子模型**（CNN + LSTM + Transformer），而我们 `ensemble_predict.py` 只用了**前 2 个**（LSTM + CNN）
- ⚠ 我们做了关键的**最后一步**还没做：**把 ensemble 导出成 TorchScript**（作者送了，但作者自己藏在 `outputs/...` 私有目录里，仓库不公开 `export_fall_model.py` 原文）
- 🟦 此外，作者用了**冷却 + 帧级/事件级两套指标**度量，不是我们当前用的 macro-F1

---

## 1. 关键事实清单（无预测，逐项有据可查）

### 1.1 shipped model 是 **3 个子模型的集成**

| 项 | 值 | 来源 |
|---|---|---|
| 模型名 | `fall_impact_seq9_lstm_transformer_ensemble` | `model/fall_impact_seq9_ensemble/config.json:2` |
| 输入 shape | `(1, 9, 32, 49, 21)` | `config.json:5-11` |
| 类别 | `[NOT_FALL_IMPACT, FALL_IMPACT]`（**二分类**）| `config.json:13-16` |
| 校准温度 | 0.3 | `config.json:19` |
| 来源 checkpoint | `outputs\seq9_lstm_clean_meta\best_model.pt` + `outputs\seq9_transformer_clean_meta\best_model.pt` + `outputs\calibrated_seq9_ensemble_clean\calibration.json` | `config.json:31-34` |
| **公开仓库里有没有 CNN 源 checkpoint** | ❌ 没有（只公开 lstm_best_model.pt + transformer_best_model.pt）| `ls model/fall_impact_seq9_ensemble/` |
| shipped eval 默认 threshold | 0.5 | `config.json:21` |
| shipped eval 低误报 threshold | 0.8400000000000001 | `config.json:22` |
| window-level test set macro-F1 (default thresh) | **0.811** | `config.json:41` |
| window-level FALL_IMPACT recall | 91%（10/11 命中）| `config.json:43,52` |
| window-level FALL_IMPACT precision | 50%（10 个里有 5 个误报）| `config.json:42` |
| event-level F1 (test session 8) | 0.90（FALL_recall=0.91, FALL_precision=0.50) | `config.json:37-44` + README §模型 |

> **重要**：shipped 模型**只看 6 类中的 1 类**（FALL vs others）。其他 4 类（EMPTY/WALKING/TRANSITION/STILL/FLOORED）被合并成 NOT_FALL_IMPACT。

### 1.2 shipped 模型**只是 inference 文件**

- `model/fall_impact_seq9_ensemble/fall_impact_seq9_ensemble.ts.pt` 是 TorchScript（`config.json:4`）
- 仓库**没有**导出这个 TorchScript 的脚本（也没有 export_fall_model.py 原文）
- 仓库**只给**: `lstm_best_model.pt`（PyTorch 权重）+ `transformer_best_model.pt` + `calibration.json`
- 作者要在自己电脑上重新 trace 出 TorchScript（导出脚本在私有 `outputs/` 路径下，仓库没收录）

**含义**：如果你想从 zero 复现 shipped，必须自己写一个 `export_ts.py`，把 `seq9_lstm_clean_meta` + `seq9_transformer_clean_meta` + 校准合并起来 trace。**作者没公开这段代码**。

### 1.3 仓库里**实际给了哪些训练脚本**

`fall-detection-training/training/`：

| 脚本 | 功能 | 注意 |
|---|---|---|
| `train_lstm.py` | LSTM（16 手工特征 → 16-帧时序 → softmax）| ✅ 公开 |
| `train_cnn_deep.py` | CNN（32 通道 × 49 频 × 21 时频谱图 → 残差块 → softmax）| ✅ 公开 |
| `ensemble_predict.py` | LSTM + CNN softmax 加权融合（**不训练**）| ✅ 公开 |
| `train_transformer.py` | 是否存在 Transformer 训练脚本？**不存在** | ⚠ 缺 |

`fall-detection-training/evaluation/`：

| 脚本 | 功能 |
|---|---|
| `loocv_eval.py` | LOOCV 包装（每 fold 重训 + 评估 + 累计）|
| `eval_seq9_ensemble.py` | shipped TorchScript 的 frame-level + event-level 评估 |
| `class_separability.py` | Cohen's d 类的可分性 sanity check |

> **奇怪之处**：shipped 模型用了 Transformer，但仓库**没有** `train_transformer.py`。LSTM 训练脚本的默认和 shipped 模型架构对得上（`train_lstm.py:476 `--lstm-units "64"`` 等），但 Transformer 训练在哪？**只有 `transformer_best_model.pt` 但没训练代码**。结论：作者**有**私有训练流水，**没开源**。

### 1.4 LOOCV 是什么？和我们的 1 折测试有什么区别？

| 维度 | 我们的做法（§D.19-D.22）| 作者的做法（`loocv_eval.py`）|
|---|---|---|
| 切分 | 1 个 session 当 test，其他当 train | N sessions → 每个 session 轮流当 test，训练 (N-1) 次 |
| 评估样本 | 单 fold 数字 | N 个 fold 数字 + 平均/中位数 |
| 报告指标 | window-level F1 | **window-level + event-level F1**（更贴近"是否检测到跌倒事件"而非"窗口分类是否对"）|
| 脚本 | `ensemble_predict.py --dataset` | `loocv_eval.py --dataset dataset_v2_high_tx` |

**我们的 fold**（§D.19）：1 个 test = `session_20260630_205253`（11+9+4 = 24 个 FALL）。N=3，总训练序列 ~200。

**作者 fold**：7 个 session × 7 fold = 7 个独立模型。N=7，总训练序列约 7× = 5-7× 多。

### 1.5 shipped 模型训练集的真实规模（推算）

作者 README §Notes 说"7 个 session"、"LOOCV 训练"。但 shippring 的 `calibration.json:86-347` 列了一个 test 序列长度 + 一个 `records` 列表（§1.1 引用）。从 records 看，test session 是 `subj01_v2_session08`，有 **262 个 6 秒窗**（window_index 0-261）。训练集约 7× (262×(7-1)/7) ≈ 1500 个窗。

**推算：shipped 用了 ~1500 个 6 秒训练窗 + ~1100 个 6 秒验证窗**。我们只用了 **365 个 1 秒 LSTM 窗 + 187 个 CNN 窗**——数据规模差 **4-8 倍**。

### 1.6 event-level vs window-level

- **window-level**：每个 6 秒窗 → prob → 分类对/错。F1 0.811 = 11 个 FALL_IMPACT 窗里 10 个被正确识别。
- **event-level**：连续 prob > threshold 的簇视为"告警事件"。作者用 `merge_gap_sec=2.0` + `cooldown_sec=8.0` —— 同一跌倒的多个高 prob 窗合并为一个 event。F1 0.90 是按 event 算的。
- **后处理**：作者有完整的 `merge_alerts` + `cooldown` 代码（`eval_seq9_ensemble.py:156-191`）。

我们的 `ensemble_predict.py` **只算 window-level**——不直接报 event-level。这不是说 shipped 用了更复杂的模型，而是**评估视角不同**。

### 1.7 训练的关键步骤（按作者 README quickstart 顺序）

```
firmware/flash_tx.sh        # 烧 TX 板（1 块）
firmware/flash_rx.sh        # 烧 RX 板（4 块，每块单独烧）

collection/record_v2.sh 02  # 录 session 02（"real take, TX raised"）
collection/record_v2.sh 03  # ... 录 5-8 session

labeling/split_fall_labels.py --dataset dataset_v2_high_tx
                            # FALL → FALL_IMPACT (前 1.5s) + FLOORED (剩余)

evaluation/class_separability.py --dataset dataset_v2_high_tx
                            # 可选：sanity check 类可分性

training/train_lstm.py --dataset dataset_v2_high_tx --labels labels_v2.json \
    --source ours --t-seq 16 --epochs 30 --ckpt checkpoints/lstm.pt

training/train_cnn_deep.py --dataset dataset_v2_high_tx --labels labels_v2.json \
    --source ours --epochs 80 --augment --ckpt checkpoints/cnn.pt

training/ensemble_predict.py --dataset dataset_v2_high_tx \
    --labels labels_v2.json --source ours \
    --lstm-ckpt checkpoints/lstm.pt --cnn-ckpt checkpoints/cnn.pt

evaluation/loocv_eval.py --dataset dataset_v2_high_tx
                            # LOOCV + ensemble 评估

evaluation/eval_seq9_ensemble.py  # 评估 shipped TorchScript
```

### 1.8 shipped 模型和我们的差异表

| 维度 | Bouy shipped 模型（作者训的）| 我们现在的（§D.22）|
|---|---|---|
| 数据集 | 7 个 session × 1 人 × 1 房间，`dataset_v2_high_tx/` | 3 个 session × 1 人 × 1 房间，本项目 `src/data/raw/` |
| 训练序列数 | ~1500 个 6s 窗 + 11 个 fold-aware | 187 个 CNN 窗 + 369 个 LSTM 1s 序列 |
| 模型架构 | CNN + LSTM + Transformer（3 个子模型 ensemble）| LSTM + CNN（2 个子模型 ensemble）|
| 类别 | 二分类 FALL_IMPACT vs 其它 | 6 类（EMPTY/STILL/WALKING/TRANSITION/FALL_IMPACT/FLOORED）|
| 评估视角 | window + event（两层）| window（只有一层）|
| Threshold 调优 | `validation_tuned` 流程（calibration.json 第二节）| 单值 0.5 |
| 校准（temperature）| 0.3（影响 softmax 软/硬）| 无（直接 softmax）|
| 后处理 | merge + cooldown（§1.6）| 无 |
| LOOCV | 是 | 单 fold（拿 1 个 session 当 test，剩下当 train）|
| 导出 TorchScript | 是（私有脚本）| 未做（这就是 §D.23 缺口）|

**评估数字直接对比**：

| 指标 | shipped (event-level F1) | 我们 (window-level macro-F1) |
|---|---|---|
| 跌倒 vs 非跌倒 F1 | event F1 = 0.90 | FALL_IMPACT F1 = 0.444 |
| 整体识别 | window F1 = 0.811 | macro-F1 = 0.444 |
| recall | event FALL_recall = 0.91 | FALL_IMPACT recall = 0.333 |

**注意：两组数字口径不同**——shipped 在它自己的 7-session LOOCV held-out session 上拿到 event F1 0.90，**那一 session 不是你的房间**。在我们房间的 3-session LOOCV 上，shipped 模型的实际表现是 **prob 0.02-0.09**（§D.11）——**跨房间分布漂移**。

---

## 2. 用户问题的直接答复

### 2.1 "我们练出来的模型是不是只是'参照'"？

**不是"参照"，是同一个代码 + 真实训练**：
- §D.14.5 列出我们跑训练的命令和 Bouy quickstart **逐项对照**：architecture / hyperparameter / 数据结构**一致**
- LSTM 0.264、CNN 0.349、ensemble 0.444 都是**实测**（§D.22.8）
- ensemble 在 test set 上比单模型好（增益分解 §D.22.3）：macro-F1 +0.180（vs LSTM）、+0.095（vs CNN）

**和我们"参照"的关系**：
- LSTM/CNN/ensemble 的**架构**和 Bouy quickstart 一致 → 我们用的是 Bouy 给的代码、修改的是命令而非代码
- ensemble 数据流**对齐**了 Bouy 的设计（1s LSTM + 6s CNN + 时间对齐加权）
- 我们**没用到 Transformer** —— 因为仓库里没有 `train_transformer.py`，我们只能训前 2 个
- 我们**没做 LOOCV** —— 因为 N=3 的 LOOCV 在 11 FALL_IMPACT test 下数字会**剧烈波动**

### 2.2 "作者的模型训练又应该如何开始"？

按作者 quickstart **逐字执行**（已重列于 §1.7）。**差异点**：

1. **数据量**：作者用了 7 个 session；我们用了 3 个。这是 F1 数字差异的最大原因
2. **Transformer**：作者用了 3 子模型，我们用了 2 子模型。要补齐需作者没开源的 train_transformer.py + 完整的 export_fall_model.py
3. **LOOCV**：作者把测试作为流程的一部分；我们跳过了（N=3 做 LOOCV 数字会差）
4. **TorchScript 导出**：作者私人目录里的 `export_fall_model.py` 没有公开源码。我们要做 live inference，得先写一段 export 脚本（`src/pc_tools/inference/export_ensemble_ts.py` 是 §D.23 待办的第一步）

**结论**：要真正复现 shipped 模型需要：
- ≥7 个 session 自己采（§D.18.2 推荐的 session 组合是起点）
- 写一个 export_fall_model.py 等价的导出脚本（§D.23 计划）
- 接 LOOCV 评估流程（`loocv_eval.py` 已公开，照跑即可）

---

## 3. 关键事实 vs 我之前推断的对照

| 我之前的说法（§D.22.8 之前的描述）| 实际事实 |
|---|---|
| "ensemble 用 LSTM + CNN" | **部分对**：shipped 是 LSTM + CNN + Transformer（3 个）。`ensemble_predict.py` 只用了前 2 个 |
| "作者用 9 帧 × 6s = 14s 感受野" | ✅ 对（config.json post_processing）|
| "model input shape (1, 9, 32, 49, 21)" | ✅ 对（config.json input_shape）|
| "作者有 binary FALL_IMPACT vs others" | ✅ 对（config.json classes 2 类）|
| "0.50 阈值" | ✅ 对 + 还有一个 0.84 备用 |
| "温度 0.3" | ✅ 对（calibration.json）|
| "calibration" 的位置（calibration.json）| ✅ 对 |
| "shipped 接受训练时 alpha=0.5 LSTM+CNN 加权" | ❌ 不对。shipped 自己有独立架构**不是我们这个 ensemble_predict.py 的产物** |
| "shipped = 我们 LSTM+CNN ensemble 转 TorchScript" | ❌ **强烈不对**。shipped = 作者私有 transform 脚本生成的，**结构不同** |

**修正**：shipped 模型**不只是"我们 ensemble 的 TorchScript 导出"**。两者完全不同的训练管道，只是**目标功能相似**（都是 6s 频谱 → FALL_IMPACT prob）。

---

## 4. 给后续 Agent 的提示

1. **不要把 shipped 模型当 "我们 ensemble 的 ts 导出"** —— 是独立的 3 子模型集成（LSTM+CNN+Transformer），需要作者私有导出脚本才能复现
2. **要复现 macro-F1 0.81**，首先**数据规模翻倍**（录到 7 session）+ **LOOCV** + **完整 3 子模型**
3. **当前最有效的工程**：live inference（§D.23 计划）= 拿自训 LSTM + CNN 在 inference 时跑，不指望和 shipped 比——而是用"我们 recognizer 至少要工作"这个最低标准做 demo
4. **不要着急录 7 session**：先**跑通 live inference**，确认模型在自己房间能用，**再决定要不要追加数据**
5. **如果决定推进**：
   - 写 `src/pc_tools/inference/infer_loop_ensemble.py`（forward LSTM + CNN + 加权 + 时间对齐）~ 150 行
   - 或者用 shipped TorchScript + 一段 wrapper script（更快但宏 F1 上限被锁死在 shipped 数字）
   - 或者改 receiver 走 1s/包 + 让两条路走自己的窗（§D.10 Option B，~ 30 行 ring buffer + concat）

---

## 5. 参考文件清单

| 文件 | 内容 |
|---|---|
| `fall-detection-training/README.md` | quickstart + class set |
| `fall-detection-training/training/train_lstm.py` | LSTM 训练 |
| `fall-detection-training/training/train_cnn_deep.py` | CNN 训练 |
| `fall-detection-training/training/ensemble_predict.py` | LSTM+CNN 融合（**不训练**）|
| `fall-detection-training/evaluation/loocv_eval.py` | LOOCV 包装 |
| `fall-detection-training/evaluation/eval_seq9_ensemble.py` | shipped TorchScript 的 window + event 评估 |
| `fall-detection-training/model/fall_impact_seq9_ensemble/README.md` | shipped 模型组成 |
| `fall-detection-training/model/fall_impact_seq9_ensemble/config.json` | shipped 架构 + threshold + eval summary |
| `fall-detection-training/model/fall_impact_seq9_ensemble/calibration.json` | shipped temperature + 校准历史 |
| 父 `README.md` | 项目总览 + shipped F1 数字 |
| 父 `CLAUDE.md` §1.1 + §3 + §5 | 训练数据规模 / 决策可追溯表 |
| `dev_doc/3-bouy-repro-howto-2026-06-28.md` §D.11, D.19-D.22 | 我们自己的实测数字 |

---

**最后更新**：2026-06-30 by Claude
**依据**：`README.md` + `fall-detection-training/README.md` + `model/.../config.json` + `model/.../calibration.json` + `evaluation/*.py` 全文阅读
**状态**：调研类文档，无代码改动。建议用户先决定"是否推进到 live inference"或"补数据到 7 session"，然后再决定。
