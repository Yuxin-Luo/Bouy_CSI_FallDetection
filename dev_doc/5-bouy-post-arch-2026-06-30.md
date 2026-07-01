# Bouy 本地开发主线（"发现开源边界"之后，2026-06-30 重起）

> **背景**：本文件**取代**之前的 `dev_doc/3-bouy-repro-howto-2026-06-28.md`（截至 D.22）+ `dev_doc/4-bouy-training-architecture-2026-06-30.md`（调研归档）。两者**作为史料保留**，但不再作为新的工作文档使用。
>
> **承接条件**：本文件起算于"明确知道 Bouy shipped 模型 = 3 子模型集成（LSTM + CNN + **Transformer**），而我们训的 ensemble = 2 子模型（缺 Transformer、Transform 训练代码不公开）"这个判断之后。

---

## 0. 现状（一次性快照，不含预测）

### 0.1 数据采集链路（实测 OK）

| 组件 | 文件 | 状态 |
|---|---|---|
| TX 固件 | `src/firmware/csi_send/`（来自 esp-csi 官方 + Bouy patch） | ✅ 实测稳定 |
| RX 固件 | `src/firmware/csi_recv/`（同上） | ✅ 实测稳定 |
| 多端口串口读取 | `src/pc_tools/receiver/csi_io.py`（Bouy 原样） | ✅ |
| 实时接收 + 写 NPZ chunks | `src/pc_tools/receiver/receiver.py`（我们写了 §D.6/D.7 fix） | ✅，chunk_sec=6s, keep_last=20 |
| 录制脚本（带 labels.json） | `fall-detection-training/collection/collect.py`（键盘标注）| ✅ |
| 鼠标标注版 | `fall-detection-training/collection/collection_mouse.py` | ✅，14 unit test pass |
| `discover_ports()` | collect.py §D.16 修了 | ✅（Linux ttyACM* 优先）|

实测会话（2026-06-30 录的 3 个 session）：
- `dataset/session_20260630_194547/`（460.5s，11 FALL + 18 STILL + 11 TRANSITION + 1 EMPTY + 1 WALKING）
- `dataset/session_20260630_203335/`（9 FALL_IMPACT + 9 FLOORED + 其他）
- `dataset/session_20260630_205253/`（4 FALL_IMPACT + 4 FLOORED + 其他）

### 0.2 训练链路（实测 OK 但有缺口）

| 步骤 | 文件 | 实测产出 |
|---|---|---|
| 切分 FALL → FALL_IMPACT + FLOORED | `fall-detection-training/labeling/split_fall_labels.py` | 3 个 `labels_v2.json` |
| 训练 LSTM | `fall-detection-training/training/train_lstm.py` | `checkpoints/lstm.pt` |
| 训练 CNN | `fall-detection-training/training/train_cnn_deep.py` | `checkpoints/cnn.pt` |
| Ensemble 评估（**不训练，不导出**）| `fall-detection-training/training/ensemble_predict.py` | 数值（macro-F1 0.444）|
| 训练 Transformer | **不存在** | ❌ —— shipped 模型用了 Transformer，但代码不公开 |
| Train shipped model 完整版 | **不存在**（只有私有导出脚本）| ❌ |

### 0.3 部署链路（部分跑通）

| 组件 | 文件 | 状态 |
|---|---|---|
| **shipped** 模型 inference | `src/pc_tools/inference/infer_loop.py`（加载 `fall_impact_seq9_ensemble.ts.pt`）| ✅，但**实测在自己房间 prob=0.02-0.09**（§D.11，分布漂移） |
| **自训** 模型 live inference | `src/pc_tools/inference/infer_loop_ensemble.py`（本轮回写）| ⚠ smoke test 卡在 `load_lstm/CNN` 阶段，未确认 |
| Flask 前端 | `src/pc_tools/frontend/app.py` | ❌ 未开始（Day 5） |
| 状态文件 | `config/runtime_state.json` | ✅，运行时可调 alpha/chunk_sec/seq_len |

### 0.4 实测数字（不预测）

| 模型 | macro-F1 | 来源 |
|---|---|---|
| shipped（在自己房间 live）| n/a，全 0.02-0.09 | §D.11 |
| shipped（作者 7 session LOOCV test）| window-F1 0.811, event-F1 0.90 | `model/.../config.json` |
| 自训 LSTM（test）| 0.264 | §D.19 |
| 自训 CNN（test）| 0.349 | §D.20 |
| 自训 ensemble（test, alpha=0.5）| 0.444 | §D.22 |

---

## 1. 关键发现 1：官方开放了什么 vs 没开放什么

> 这是本次重起工作的**根本约束**。任何后续推进必须在这张边界图内做。

### 1.1 开源 = 我们能直接用的

| 类别 | 文件 |
|---|---|
| TX/RX 固件 patch | `fall-detection-training/firmware/firmware_patches/{csi_send,csi_recv}_app_main.c` |
| 录制脚本 | `fall-detection-training/collection/collect.py`、`csi_io.py`、`capture_multi.py`、`check_boards.py` |
| 鼠标标注版 | `fall-detection-training/collection/collection_mouse.py`（本项目新增）|
| 切分 FALL | `fall-detection-training/labeling/split_fall_labels.py` |
| 训练 LSTM | `fall-detection-training/training/train_lstm.py`（含 CSIClassifier 定义 + 16 特征提取函数）|
| 训练 CNN | `fall-detection-training/training/train_cnn_deep.py`（含 CSI_DeepCNN 定义 + 频谱提取函数）|
| LSTM + CNN 加权融合 + 评估 | `fall-detection-training/training/ensemble_predict.py` |
| LOOCV 包装 | `fall-detection-training/evaluation/loocv_eval.py` |
| window + event 级评估 | `fall-detection-training/evaluation/eval_seq9_ensemble.py` |
| 类可分性 sanity check | `fall-detection-training/evaluation/class_separability.py` |
| CSI-HAR 适配器 | `fall-detection-training/external_data_adapter/csi_har_adapter.py` |
| shipped 模型的 **3 个源权重** | `model/fall_impact_seq9_ensemble/{lstm_best,transformer_best}_model.pt` + `calibration.json` |
| shipped TorchScript 模型 + config | `model/fall_impact_seq9_ensemble/fall_impact_seq9_ensemble.ts.pt` + `config.json` |
| 日历 / incident / device / sensor 后端 | `apps/{server,web}/` 全部 |

### 1.2 不开源（**开源边界**）

| 项 | 实际证据 |
|---|---|
| **Transformer 训练脚本** | `ls fall-detection-training/training/` 只有 train_lstm.py + train_cnn_deep.py + ensemble_predict.py。`config.json` 模型名 `fall_impact_seq9_lstm_transformer_ensemble` 提到 Transformer 但无训练代码 |
| **完整的 shipped 模型导出脚本** | `config.json` 提到 `outputs\seq9_lstm_clean_meta\best_model.pt` 等私有路径。仓库**没有** `export_fall_model.py` |
| shipped 的 4 RX × 4 子模型的 CNN 源权重 | `model/.../` 只有 lstm_best + transformer_best，**没有 CNN 源 .pt** |
| 校准的源代码实现 | `calibration.json` 记录 `temperature=0.3` 但不提供实现 |
| shipped 数据集 `dataset_v2_high_tx/` | 不在仓库里 |

### 1.3 工程上的结论

1. **我们能复现**：LSTM + CNN ensemble 的**训练** + **离线评估**（已在 §D.19-D.22 跑通）
2. **我们不能复现**：shipped 的完整 3 子模型集成 + Transformer 训练 + TorchScript 导出
3. **要拿到 shipped 等价能力**必须：a) 复刻 Transformer 训练代码（数百行）+ b) 复刻导出脚本（私有协议）+ c) 复用 CSI-HAR 适配器扩数据。在 5 天 demo 内**不现实**

**所以我们的目标不再是"复现 shipped 的 0.81 F1"，而是"用自训 2 子模型 ensemble 做到 live inference 能用"**。

---

## 2. 关键发现 2：数据集 + 模型选择已经定型

经过 §D.11（实测 shipped 不响应）→ §D.14（修正训练路径）→ §D.19-D.22（自训 ensemble 0.444）一系列确认：

| 选择 | 决策 | 原因 |
|---|---|---|
| 模型 = LSTM + CNN ensemble | 锁定 | 实际可训、已经训完、live 已写 |
| Ensemble alpha 默认 = 0.5 | 锁定（可调）| §D.22.4 实测并列最优 |
| 阈值 = 0.5 | 锁定（config.json 一致）| §D.22.4 in-sample 表现 |
| mu/sd 通过训练 sessions 重算 | 接受 | train_lstm.py 没保存，0.01 F1 漂移可接受 |

---

## 3. 当前阻塞：`infer_loop_ensemble.py` smoke test 卡死

### 3.1 卡在哪

测试路径：
```bash
python3 src/pc_tools/inference/infer_loop_ensemble.py --device cpu
```

实测 60 秒后仍停在 `Loading models...`（[临时日志](/tmp/infer_smoke.log)）：
```
Classes (6): ['EMPTY', 'STILL', 'WALKING', 'TRANSITION', 'FALL_IMPACT', 'FLOORED']
Device    : cpu
Live dir  : .../data/live  (poll every 0.5s)
LSTM ckpt : .../lstm.pt
CNN  ckpt : .../cnn.pt
Loading models...
```

下一步预期 print：`Models loaded. Watching for new chunks... (Ctrl-C to stop)`（来自 main L242）。

`Models loaded` 之后会调 `recover_feature_stats`，从 3 个 session 各跑一次 `extract_features_for_session`（每次 ~1-2 秒）。这是已知慢点，但**不会卡 60 秒不出一行**。

### 3.2 怀疑的点（按可能性排序）

1. **`load_lstm` / `load_cnn` 在 `load_state_dict` 时 hang**——之前 import 测试没走到这一步。可能是 lstm.pt / cnn.pt 文件本身有问题
2. **第一次 `chunk_to_lstm_features` 在 28 个 chunk 上每个都跑 fft + variance 计算 + ring buffer 维护**，seq 要凑齐 16 个才出 1 个 LSTM prob——已经够**20 秒**才能凑齐
3. **Python 输出被 matplot / torch 的某些 init 流程 capture**——但脚本没用 matplot
4. **timeout 信号先于 SIGINT 到达**，但前面已经 ECHO 出了 `Loading models...`

### 3.3 调试步骤（待用户拍板后执行）

| 步骤 | 命令 | 预期 |
|---|---|---|
| 1. 单独试 LSTM load | 见下面命令 1 | 1-2 秒 |
| 2. 单独试 CNN load | 见下面命令 2 | 1-2 秒 |
| 3. 看 `recover_feature_stats` 是否慢 | 改 print 位置 / 加 timer | 0.5-3 秒 |
| 4. 看 `chunk_to_*` 是否慢 | 同上 | 0.01-0.1 秒/次 |
| 5. **找到根因后修脚本**，再 smoke | —— | < 1 秒出首个 prob |

```bash
# 命令 1：测 LSTM 单 load
python3 -u -c "
import sys, time, torch
sys.path.insert(0, 'src/pc_tools')
sys.path.insert(0, 'src/pc_tools/inference')
sys.path.insert(0, 'fall-detection-training/training')
t0 = time.time()
from train_lstm import CSIClassifier
print(f't={time.time()-t0:.2f}: import done')
m = CSIClassifier(n_features=16, n_classes=6, lstm_units=[64], dense_units=32)
print(f't={time.time()-t0:.2f}: model')
ckpt = torch.load('fall-detection-training/training/checkpoints/lstm.pt', map_location='cpu', weights_only=True)
print(f't={time.time()-t0:.2f}: ckpt loaded {len(ckpt)} keys')
m.load_state_dict(ckpt)
print(f't={time.time()-t0:.2f}: state_dict done')
"

# 命令 2：测 CNN 单 load
python3 -u -c "
import sys, time, torch
sys.path.insert(0, 'fall-detection-training/training')
t0 = time.time()
from train_cnn_deep import CSI_DeepCNN
print(f't={time.time()-t0:.2f}: import done')
m = CSI_DeepCNN(n_classes=6, n_in_channels=32)
print(f't={time.time()-t0:.2f}: model')
ckpt = torch.load('fall-detection-training/training/checkpoints/cnn.pt', map_location='cpu', weights_only=True)
print(f't={time.time()-t0:.2f}: ckpt loaded {len(ckpt)} keys')
m.load_state_dict(ckpt)
print(f't={time.time()-t0:.2f}: state_dict done')
"
```

---

## 4. 接下来的工作清单（按 ROI 排序）

### 4.1 短期（1-3 小时）：完成 live inference 闭环

| # | 任务 | 阻塞 | 备注 |
|---|---|---|---|
| 1 | **定位并修 `infer_loop_ensemble.py` 卡死** | §3 待查 | 优先做完才能拿到 live feedback |
| 2 | smoke test 真 receiver + infer_loop_ensemble（30 秒）| 1 | 静坐 + 1 次跌倒 |
| 3 | 把 `data/live/` 现有 28+ 个 chunks 跑过一次 | 1 | 验证 ensemble 在历史真实数据上的输出 ≠ shipped（应该有差异）|

### 4.2 中期（半天）：扩展文档/可靠性

| # | 任务 | 备注 |
|---|---|---|
| 4 | 写 `--reprocess` flag | 让重跑时重新读已 seen 的 chunks（debug 需要）|
| 5 | 写 alarm 触发 + print 时间戳日志到 `data/alerts.log` | 现在只 print 到 stdout |
| 6 | 把 `train_lstm.py` 加 `--save-stats` 把 mu/sd 写到 .npz | 解决 §1 重算慢问题 |
| 7 | 在 `checkpoints/lstm.pt` + `cnn.pt` 旁写 `model_meta.json`（architecture hash + args + timestamp）| 防止 §D.21 类陷阱再发 |

### 4.3 长期（stretch）：补数据重训

| # | 任务 | 备注 |
|---|---|---|
| 8 | 录 4 个新 session（30-60 分钟/个）| 重点：WALKING 30s+ + EMPTY 段 + FALL 4-5 次 |
| 9 | 重训 LSTM + CNN + ensemble | 预期 macro-F1 突破 0.5 |
| 10 | LOOCV 评估（`loocv_eval.py`）| 替代单 fold 测试 |

### 4.4 暂不做（明确不做的）

| 项 | 原因 |
|---|---|
| 写 `train_transformer.py` 重做 shipped | 数天工作，5 天 demo 不允许 |
| 写 `export_fall_model.py` 复刻 shipped 的 TorchScript | 没源脚本，重写协议不明 |
| 完整 LOOCV | N=3 LOOCV 数字不稳，等 N=7 再做 |
| 集成到 Pusher / Twilio / Next.js | 不在 demo 范围 |

---

## 5. Day 5 前端（推断所需输入）

不在本轮回合做，但**为了 §4.1.3 smoke 的 prob 输出能被前端读**，提前规划：

```
src/pc_tools/inference/infer_loop_ensemble.py
    ↓ stdout: 每 ~6 秒一行 "<cls> <6 概率>"
    ↓ 后续可改写到 /tmp/bouy_state.json（参考 Day 5 §Step 5.2）
src/pc_tools/frontend/app.py
    ↓ /api/status → 读 JSON → HTML 显示
```

这是 Phase 4.2.2 的扩展，**今天不做**。

---

## 6. 文档维护规则

| 文件 | 状态 |
|---|---|
| `dev_doc/3-bouy-repro-howto-2026-06-28.md` | 史料（截至 §D.22，最后版本）|
| `dev_doc/4-bouy-training-architecture-2026-06-30.md` | 调研档案（核心结论：缺 Transformer）|
| **`dev_doc/5-bouy-post-arch-2026-06-30.md` ← 本文件** | **主开发文档，从今天起，所有新进展写在这里** |
| `dev_doc/0-references-2026-06-28.xml` | 持续维护 |

**§6.1 编号规范**：
- 本文档的章节用 `§0-§6`（不混用 D.x 数字）
- 新发现用 §3.1 / §3.2 / §4.x 增量编号，不重写整章
- 调研类内容继续写 `dev_doc/6-*-2026-XX-XX.md` 单独文件，主文档只引用

---

## 7. 验证清单（每完成一项勾掉）

- [ ] §3.1 卡死根因找到 + 修
- [ ] §3.3 命令 1 / 2 跑通
- [ ] smoke test 30 秒内出首次 prob 输出
- [ ] (Optional) 真 receiver 跑一次 30 秒静坐，prob 范围 ≠ shipped
- [ ] §4.2 项 4（`--reprocess` flag）评估 ROI 后再决定是否本轮做

---

**最后更新**：2026-06-30 by Claude
**依据**：§D.0-§D.23 + `model/.../config.json` + `model/.../calibration.json` 全读
**状态**：**断点 + 重起**。本文件取代 §D.23 之前的所有工作为"史料"。
