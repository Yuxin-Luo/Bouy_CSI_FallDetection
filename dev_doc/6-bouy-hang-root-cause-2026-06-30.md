# infer_loop_ensemble.py 卡死根因 + 修复（2026-06-30）

> **定位**：史料 + 操作文档。hang 的根因分析、修复验证、当前遗留 RX3 缺失问题、下一步路线。
> **来源**：handoff §1 派生的任务，handoff §3.2 的 3 个怀疑点**全部错误**。

---

## 0. 背景

`src/pc_tools/inference/infer_loop_ensemble.py` smoke test 卡在 `Loading models...`，60+ 秒无任何后续输出。handoff §3.2 列出 3 个怀疑点（按可能性）：

1. `load_state_dict` 失败或 hang
2. `recover_feature_stats` 重算 mu/sd 慢（遍历 3 session）
3. 模型实例化类不匹配

**实测后这 3 点全错**。hang 真实原因在 §1。

---

## 1. 根因：`extract_features_for_session` 在内层循环里反复解压 npz

### 1.1 现象（2026-06-30 实测）

```
t=0.63: import done
t=0.63: glob done, 3 sessions
t=223.92: session_20260630_194547 X.shape=(919, 16) took 223.29s
t=307.78: session_20260630_203335 X.shape=(423, 16) took  83.86s
t=347.29: session_20260630_205253 X.shape=(384, 16) took  39.51s
t=347.29: stats done
```

3 个 session 共 **347 秒**（不是"1-2 秒/会话"）。脚本实际是从 `recover_feature_stats` 慢而非模型 load 慢——`Loading models...` 在模型 load 完之后才打印。模型 load 实际秒过（§1.3）。

### 1.2 根因（Phase 2 模式分析）

`fall-detection-training/training/train_lstm.py:128-152` 的 per-window 循环：

```python
for w_idx, t_center in enumerate(windows):       # 919 windows × 3 sessions
    for name in rx_names:                         # 4 RX
        ts   = csi[f"timestamps_{name}"]          # ← npz decompress every call
        amps = csi[f"amplitudes_{name}"].astype(np.float32)  # ← same
        mask = (ts >= t_lo) & (ts < t_hi)
        chunk = amps[mask]
        ...
```

`np.load()` 返回 `NpzFile`，**`__getitem__` 是 lazy decompress**（每次访问解一次 zip）。一次性访问 919 × 4 = 3676 次 ≈ 64ms/次 ≈ **235 秒**（与实测吻合）。

**实测验证**（一次性命令）：

| 操作 | 10 次耗时 |
|---|---|
| `csi[f"amplitudes_RX1"]` | 0.636s |
| `csi[f"amplitudes_RX1"].astype(np.float32)` | 0.632s |
| `csi[f"timestamps_RX1"]` | 0.008s |

astype 基本免费，npz decompress 是大头。

### 1.3 模型 load 实测（handoff §3.2 怀疑点 #1/#3 否决证据）

| 步骤 | 耗时 |
|---|---|
| LSTM `CSIClassifier.__init__` | 0.00s |
| LSTM `torch.load(checkpoint)` | 0.00s |
| LSTM `load_state_dict` | 0.00s |
| CNN `CSI_DeepCNN.__init__` | 0.20s |
| CNN `torch.load(checkpoint)` | 0.20s |
| CNN `load_state_dict` | 0.20s |

架构匹配：
- LSTM checkpoint: `lstm_stack.0.weight_ih_l0=(256,16)`、`head.5.weight=(6,32)` → `[64] hidden, dense=32, n_classes=6`
- CNN checkpoint: `stem.0.weight=(32,32,3,3)`、`n_in_channels=32 (4 RX × 8 bands)`、`base=32, dense=128, n_classes=6`
- `infer_loop_ensemble.load_lstm/load_cnn` 的构造参数与 checkpoint **完全一致**。

---

## 2. 修复

### 2.1 方案：hoist npz access 到 per-RX 缓存

**不修改** `train_lstm.py`（CLAUDE.md 红线：不改 upstream）。在 `infer_loop_ensemble.py` 加 `extract_features_fast`，hoist `amplitudes_xxx.astype(...)` 和 `timestamps_xxx` 到 per-RX dict。

### 2.2 修复后实测（2026-06-30）

```
recover stats session_20260630_194547: X=(919, 16) took 1.36s   (vs 223.29s)
recover stats session_20260630_203335: X=(423, 16) took 0.69s   (vs  83.86s)
recover stats session_20260630_205253: X=(384, 16) took 0.53s   (vs  39.51s)
recover_feature_stats total: 2.58s (3 sessions, Xall.shape=(1726, 16))
```

**134× 加速**，**bit-identical**（`max |X_slow - X_fast| = 0.0`）。

### 2.3 smoke test 结果（2026-06-30 22:48）

`timeout 90 python3 -u src/pc_tools/inference/infer_loop_ensemble.py --device cpu`：

- ✅ `Models loaded. Watching for new chunks...` 出现在 ~3 秒
- ✅ CNN 在每个 chunk 上 forward 成功并打印 6 类 prob（FLOORED、FALL_IMPACT、STILL...）
- ❌ **LSTM 在所有 20 个历史 chunks 上 KeyError**（§3 新问题）

### 2.4 代码变更位置

| 文件 | 行数变化 | 内容 |
|---|---|---|
| `src/pc_tools/inference/infer_loop_ensemble.py` | +85 行 | 新增 `extract_features_fast` + `recover_feature_stats` 加 per-session 计时 print |
| 其他文件 | 0 | 没改 |

---

## 3. 新发现：所有历史 chunks 缺 RX3 数据

### 3.1 现象

smoke test 跑过 `data/live/` 全部 20 个 chunk，每个都打印：

```
[skip chunk_20260630_140849_0012.npz] LSTM feat failed: KeyError
[skip chunk_20260630_140855_0013.npz] LSTM feat failed: KeyError
...
```

但脚本不崩——`chunk_to_lstm_features` 的 KeyError 被 `try/except` 抓住，主循环继续走（CNN-only 模式）。这是**鲁棒性问题**，不是新的 hang。

### 3.2 根因（receiver 当时 RX3 板没数据）

直接 dump 任何 chunk 的 keys：

```
rx_names: [RX1, RX2, RX3, RX4]
files:
  amplitudes_RX1: shape=(429, 192)
  amplitudes_RX2: shape=(423, 192)
  amplitudes_RX4: shape=(426, 192)   ← RX3 MISSING
  timestamps_RX1: shape=(429,)
  timestamps_RX2: shape=(423,)
  timestamps_RX4: shape=(426,)       ← RX3 MISSING
```

**rx_names 列表里有 RX3，但 `amplitudes_RX3` / `timestamps_RX3` 不存在**——receiver 在某个时间窗口内（chunk_0012~chunk_0031，14:08-14:10）没收到 RX3 的数据，可能是 USB 串口断开或板子没插。

模型是用 4 RX 训的（`CSIClassifier(n_features=16)` = 4 features × 4 RX）。`chunk_to_lstm_features` 假设 4 RX 都在，访问 `csi[f"timestamps_RX3"]` 抛 KeyError。

注意：`chunk_to_cnn_spectrogram`（CNN 路径）已经用 `if f"amplitudes_{name}" not in csi.files: continue` 跳过缺失 RX（行 137），所以 CNN 不受影响——这就是为什么 smoke test 能出 CNN prob。

### 3.3 影响范围

| 项 | 状态 |
|---|---|
| CNN path | ✅ 已鲁棒化（CNN-only 模式工作） |
| LSTM path | ❌ 遇到缺 RX 直接 KeyError → 整个 chunk 跳过 → LSTM 永远凑不齐 16 windows |
| Ensemble path | ❌ 永远 LSTM-warming-up 状态 |
| 影响 chunks | 20/20 历史 chunks 全缺 RX3（需要新 receiver session 才能验证 4 RX 都齐） |

---

## 4. 决策可追溯

| 决策 | 依据 |
|---|---|
| 修法选 hoist 而不是 cache | cache 文件**已存在**（`.features_cache_labels_v2_w1.0_h0.5.npz` 在 3 个 session 里），但 cache 只解决"重跑相同超参"；hoist 解决"任何调用都慢"。两条都做最稳，但本轮只做了 hoist（任务 4 的 §4.2 #6 是 cache 化，留作下轮）|
| 在 infer_loop_ensemble.py 加新函数而不是改 train_lstm.py | CLAUDE.md 红线 "不动 upstream" + dev_doc/3 §D.14 "intentional duplication of work" 的同款做法（chunk_to_lstm_features 也是这种思路）|
| smoke test 在缺 RX3 的 chunks 上不算"完整通过" | 因为 LSTM path 没法验证。但 hang 修复本身已被证明（CNC-only 输出 + timing log），LSTM 鲁棒化是独立问题 |

---

## 5. 下一步（移交下一个 agent）

按 ROI 排序：

| # | 任务 | 工时 | 阻塞 |
|---|---|---|---|
| 1 | **跑一次真 receiver + 30 秒静坐**，确认新 chunks 4 RX 都齐 → 验证 LSTM path | 5 分钟 | 串口物理连 4 块板 |
| 2 | **鲁棒化 `chunk_to_lstm_features`**：处理缺 RX 的 chunk（fill zero + warn），避免整个 LSTM path 跳过 | 15 分钟 | §3.3 已分析 |
| 3 | 加 `--reprocess` flag（debug 用，看 handoff §4.2 #4）| 10 分钟 | 无 |
| 4 | 录 4 个新 session + 重训（handoff §3 #4）| 30-60 分 × 4 | 时间 |
| 5 | LOOCV 评估（注意样本稳定性）| 30 分钟 | #4 |

**推荐先做 #1 + #2**（30 分钟内把 LSTM path 完整验证），再做 #3。

---

## 6. 验证清单（已勾/未勾）

- [x] §1 hang 根因找到 + 修（extract_features_fast 已加，recover_feature_stats 已切到 fast 版）
- [x] §2 修复后实测 X bit-identical，2.58s vs 347s
- [x] §2.3 smoke test 30 秒内出首次 prob 输出（CNN-only）
- [ ] §3 LSTM path 鲁棒化（缺 RX3 chunk 不崩）
- [ ] 真 receiver 跑一次 30 秒静坐，确认 4 RX 都齐 + LSTM 输出
- [ ] §4.2 task #6：把 train_lstm.py 加 `--save-stats` 把 mu/sd 写到 .npz（解决 cache 不命中的场景）
- [ ] §4.2 task #7：在 checkpoints 旁写 `model_meta.json`（防止 §D.21 类陷阱）

---

**最后更新**：2026-06-30 by Claude
**依据**：handoff §1 + 实测 hang 复现 + npz decompress timing + 修复后 bit-identical 验证
**状态**：hang 已修，LSTM 鲁棒性遗留待下一轮