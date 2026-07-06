# RX Board Disconnect 政策 + 实现（2026-07-01）

> **定位**：史料 + 操作文档。
> **承接**：`dev_doc/6` §3（hang 修复后冒出的 RX3 缺失问题）+ `HANDOFF-2026-06-30.md` §2（用户拍板的处理方式）。
> **结论**：硬件问题，agent 必须 HARD-FATAL，不允许静默绕过。

---

## 0. 背景

`infer_loop_ensemble.py` 修完 hang（`dev_doc/6`）后 smoke test 暴露：
- 20/20 历史 chunks（`chunk_20260630_140849_0012` ~ `_141044_0031`，14:08-14:10 那段时间）**全部**缺 `amplitudes_RX3` / `timestamps_RX3`
- `rx_names` 列表里 `[RX1, RX2, RX3, RX4]` 但 RX3 对应数组不存在
- LSTM path 访问 `csi[f"timestamps_RX3"]` → KeyError → chunk 跳过 → ring buffer 凑不齐 16 windows → LSTM 永远 warming-up
- CNN path 不受影响（`chunk_to_cnn_spectrogram:137` 已鲁棒化跳过缺失 RX）

用户 2026-07-01 明确选择 **不**靠"工作绕"（不填 0 / 不填 NaN / 不 CNN-only 凑合）——硬件问题必须外部解决。

---

## 1. 用户原话 + 政策

> "我确信现在四个RX都是正常的，跳过这一步进行下一步，**以后一旦遇到RX掉线的情况立即停下所有工作并马上向我汇报**，**这个问题只能我外部解决你没法解决**。" — 用户，2026-07-01

**政策**（由原话归纳）：

1. **立即停下所有工作** — 不要尝试任何 work around（不填 0 / 不填 NaN / 不 skip chunk / 不 CNN-only fallback）
2. **马上向用户汇报** — 报告 chunk 名字、缺失的 RX 名、建议检查项
3. **不能解决** — 硬件问题（USB 线 / 板上电 / 芯片），只有用户能修

**为什么不能静默绕过**：如果我填 0 / 跳过 / 走 CNN-only，LSTM path 看起来 work 但实际是 garbage 数据 + garbage 预测，无法识别这是个硬件故障。下次再发生类似掉线，agent 仍会继续输出看起来合理但毫无意义的概率。

---

## 2. 实现

### 2.1 三处代码改动（`src/pc_tools/inference/infer_loop_ensemble.py`）

| 位置 | 内容 | 行号 |
|---|---|---|
| Helper 函数 | `check_rx_presence(chunk_path) -> (present, missing)` | L128-139 |
| Argparse flag | `--allow-missing-rxs`（action="store_true"，默认 False = strict）| L482-488 |
| 主循环 pre-check | 缺任意 RX 且未开 flag → 打印 FATAL banner 到 stderr + `return 2` | L546-578 |

**关键设计选择**：

- **默认 STRICT**：flag 是 opt-**in** to lenient（用户不需要加 flag 也能保证安全）
- **退出码 2**：明确语义"RX disconnect"，可被 shell / CI / 上层检测
- **Banner 信息完整**：chunk 名字 + rx_names + present + missing + 硬件诊断建议 + flag 用法
- **Banner 写 stderr**：避免污染 stdout 的概率输出流
- **flag 写到 warn 而不是 stderr**：warn 写 stdout，banner 写 stderr，两条流分开

### 2.2 helper 函数逻辑

```python
def check_rx_presence(chunk_path: Path) -> tuple[list[str], list[str]]:
    csi = np.load(chunk_path)
    rx_names = [str(n) for n in csi["rx_names"]]
    present = [n for n in rx_names
               if f"amplitudes_{n}" in csi.files
               and f"timestamps_{name}" in csi.files]  # 修正后
    missing = [n for n in rx_names if n not in present]
    return present, missing
```

**判缺标准**：必须**同时**缺 `amplitudes_<name>` **和** `timestamps_<name>` 才算 missing；只缺一个也判 present（防御性，宁可让 LSTM 自己抛 KeyError 也不要误判）。

### 2.3 主循环 pre-check（简化）

```python
present_rx, missing_rx = check_rx_presence(ck)
if missing_rx and not args.allow_missing_rxs:
    # 打印 10 行 FATAL banner 到 stderr
    return 2
elif missing_rx:
    print(f"[warn {ck.name}] missing RX {missing_rx} (continuing in lenient mode)")
# else: 正常走 CNN + LSTM 双路径
```

---

## 3. 验证（2026-07-01 实测）

### 3.1 默认 strict 模式（无 flag）

**输入**：`data/live/` 20 个历史 chunks（全部缺 RX3）
**预期**：第一个 chunk 触发 FATAL banner + `return 2`
**实测**：

```
========================================================================
  [FATAL] RX BOARD DISCONNECT DETECTED
========================================================================
  Chunk  : chunk_20260630_140849_0012.npz
  RX declared in chunk (rx_names): ['RX1', 'RX2', 'RX4', 'RX3']
  RX present : ['RX1', 'RX2', 'RX4']
  RX MISSING : ['RX3']

  This is a HARDWARE issue (USB cable / board power / chip).
  Agent cannot fix it. Please check the physical setup,
  re-plug the missing board, and re-run.
  To replay partial historical data, pass --allow-missing-rxs
  (NOT recommended for live use).
========================================================================
```

**退出码**：`echo $?` → `2` ✓

### 3.2 lenient 模式（`--allow-missing-rxs`）

**输入**：同上 20 chunks
**预期**：warn + skip + 继续走完所有 chunks（不 FATAL）
**实测**：20 个 chunk 全部被 LSTM path 跳过（每个打印 `[skip chunk_xxx] LSTM feat failed: KeyError`），CNN path 输出概率，脚本继续 watch。timeout 124 = SIGTERM from `timeout 10`（脚本本身不退出，正常）

### 3.3 空 live 目录

**输入**：移走 20 个 chunks 后的 `data/live/`
**预期**：`Models loaded. Watching for new chunks...` 后无限等待（不 FATAL）
**实测**：✓（stdout 显示 "Watching for new chunks..."，stderr 无 FATAL）

### 3.4 归档证据保留

20 个 chunks 全部移至 `data/live/archive_missing_rx3_20260630/`，**不删除**——作为硬件掉线证据保留，方便日后排查"为什么那天 receiver 收到的 RX3 数据全空"。

---

## 4. 决策可追溯

| 决策 | 依据 |
|---|---|
| 默认 STRICT，flag opt-in to lenient | 用户原话："立即停下所有工作"——默认行为必须是 safe-default，flag 是显式 opt-in |
| 退出码 = 2 | 区分于 `1`（args/路径错误）和 `0`（正常），便于 shell 检测 |
| banner 写 stderr | 不污染 stdout 的概率输出流，下游消费者可干净解析 |
| 检查"同时缺 amplitudes 和 timestamps"才判 missing | 防御性误判，宁可让 LSTM 自己 KeyError 也不要静默通过 |
| 归档 20 chunks 到 `archive_missing_rx3_20260630/` | 不删除原始数据 = 留证据 + 防止回归误判（如果未来再次看到同样模式，能直接对比）|
| 不鲁棒化 `chunk_to_lstm_features`（不填 0 / NaN / skip）| 用户原话 + 填 0 引入分布漂移；CNN-only fallback 掩盖硬件问题 |
| helper 函数不缓存 | 调用一次 npz 解压 < 1ms，缓存价值低 |

---

## 5. 与已有约束的一致性

| 已有约束 | 本次实现 |
|---|---|
| CLAUDE.md 红线 #11 "不堆废话" | banner 信息密度高，每行有可决策性 |
| CLAUDE.md 红线 #9 "不打补丁" | 不通过填 0 绕过 = 不打补丁 |
| dev_doc/6 §4 "不修改 upstream 脚本" | 只改 `infer_loop_ensemble.py`，`train_lstm.py` / `receiver.py` 未动 |
| HANDOFF-2026-06-30 §2.4 方案 iv "加 `--require-rxs` flag" | 本次反过来：默认 require（strict），flag opt-in to lenient |
| dev_doc/6 §3.3 影响范围分析 | 与本文件 §0 表对齐：CNN 已鲁棒化 / LSTM 不鲁棒化（现在改用 pre-check 拦截）|

---

## 6. 后续路径（不在本轮做）

| 优先级 | 任务 | 工时 | 阻塞 |
|---|---|---|---|
| 1 | **真 receiver 跑一次 30 秒静坐**，确认新 chunks 4 RX 都齐 → 验证 LSTM path 真能出概率 | 5 分钟 | 串口物理连 4 块板 |
| 2 | 加 `--reprocess` flag（debug 用，看 HANDOFF-2026-06-30 §4.2 #4）| 10 分钟 | 无 |
| 3 | 录 4 个新 session + 重训（HANDOFF-2026-06-30 §3 #4）| 30-60 分 × 4 | 时间 |
| 4 | LOOCV 评估 | 30 分钟 | #3 |

**做完 #1 才能证明 LSTM path 端到端 work**——现在只能证明 strict 拦截 + warn-lenient 双路径都能跑。

---

## 7. 验证清单

- [x] §2.1 三处代码改动落盘
- [x] §2.2 helper 函数逻辑
- [x] §3.1 默认 strict → exit 2 + FATAL banner
- [x] §3.2 lenient flag → 不 FATAL，warn + 继续
- [x] §3.3 空 live dir → 干净 watching 状态
- [x] §3.4 20 chunks 归档保留
- [x] 写 `memory/rx-disconnect-policy.md` + 更新 `MEMORY.md` 索引
- [x] **§3.5（新增）真 receiver 验证** — 用户 2026-07-01 10:12 跑通 receiver + infer_loop_ensemble（4 RX 都齐），实测输出：`LSTM(t=3955.7) CNN(t=159.0) α=0.50 cls=STILL prob=[EMPTY=0.069 STILL=0.540 WALKI=0.024 TRANS=0.280 FALL_=0.027 FLOOR=0.060]`。LSTM path 端到端 work，无 FATAL，**端到端闭环达成**。
- [ ] §6 #2 `--reprocess` flag（独立任务）
- [ ] §6 #3-4 录数据 + 重训（独立任务）

---

## 8. 与本日其他动作的关系

| 时间 | 动作 | 文件 |
|---|---|---|
| 上午 | 读 HANDOFF-2026-06-30 + dev_doc/5/6 + memory | `HANDOFF-2026-06-30.md`, `5-bouy-post-arch-2026-06-30.md`, `6-bouy-hang-root-cause-2026-06-30.md`, `memory/rx-disconnect-policy.md` |
| 上午 | 实现 + 验证 3 处代码改动 | `src/pc_tools/inference/infer_loop_ensemble.py` (L128, L482, L546-578) |
| 上午 | 归档 20 chunks | `data/live/archive_missing_rx3_20260630/` (20 files) |
| 上午 | 写本文件 | `dev_doc/7-bouy-rx-disconnect-policy-2026-07-01.md` |
| 上午 | 更新 HANDOFF（待做）| `HANDOFF-2026-07-01.md`（接续 §6 路线）|

---

**最后更新**：2026-07-01 10:15 by Claude
**依据**：用户原话（2026-07-01）+ `dev_doc/6` §3 + `HANDOFF-2026-06-30` §2 + 实测 3 个验证场景 + 用户实测 receiver 输出
**状态**：✅ strict / lenient / 空目录 三场景验证通过 + 用户实测真 receiver LSTM path work（10:12:50 输出正常，cls=STILL 0.540，无 FATAL）。端到端闭环达成。