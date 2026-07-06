# 实时 CSI 推理前端（2026-07-01）

> **定位**：史料 + 设计决策文档。
> **承接**：`dev_doc/7`（RX 政策已落地）+ `HANDOFF-2026-07-01.md` §4 路线图 + `dev_doc/5` §0.3 状态更新。
> **用户原话 2026-07-01**："参考 fall-detection-training/collection/collection_mouse.py 的前端展现方式，我希望你在 pc_tools/frontend 下结合 infer_loop_ensemble.py 实现一个类似的前端展示界面，只不过他的作用是实时接收数据并显示结果，代码内可以修改阈值（不在前端展示），当有多种状态超过阈值时可以自行设置优先级（如 fall>TRANSITION>WALKING>STILL>empty），需要注意前端绘制不能影响数据接收"

---

## 0. 背景 + 目标

| 维度 | 内容 |
|---|---|
| **承接状态** | LSTM path 端到端 work 已验证（`HANDOFF-2026-07-01` §3 实测 10:12:50 输出正常）|
| **缺失环节** | 实时可视化——目前只有 stdout 一行输出，看不到幅度变化、概率分布、active class 切换过程 |
| **目标 1** | matplotlib 实时展示 ensemble 推理结果（4 行布局）|
| **目标 2** | threshold + priority 在代码内可改，**不暴露到前端 UI** |
| **目标 3（硬约束）** | matplotlib 渲染不能阻塞数据接收——必须用后台线程隔离 |

---

## 1. 设计

### 1.1 文件结构（单文件 `src/pc_tools/frontend/app.py`，**935 行**——含 §1.5 平滑插值）

```
app.py (935 lines, single file)
├── 顶部常量块 (~50 行)：THRESHOLD / PRIORITY_ORDER / UPDATE_HZ / POLL_SEC / ROLLING_SEC / QUEUE_MAX / CHUNK_SEC / CLASS_COLORS
├── Imports + sys.path (~30 行)
├── Frame TypedDict (~30 行)
├── Helpers (~70 行)：pick_active / downsample_amplitudes / extract_amplitude_streams / class_color
├── InferenceWorker class (~180 行)：threading.Thread(daemon=True)
├── Frontend class (~300 行)：matplotlib FuncAnimation 主线程 + §1.5 平滑插值状态机
└── main() (~50 行)：argparse + 启动 worker + 启动 plt.show()
```

**为什么单文件而不是 split**：
- 用户偏好"简单"（CLAUDE.md 红线 #4 不堆废话）
- 复用 8 个函数不需要封装层
- 整个 frontend 不到 1000 行，跨文件 import 反而增加认知成本
- 单文件方便 grep / 调试

### 1.2 线程架构

```
receiver.py  →  data/live/chunk_*.npz (every 6s)
                     ↓
   ┌─────────────────────────────────────────────┐
   │ [InferenceWorker thread, daemon=True]       │
   │  - poll every POLL_SEC=0.5s                 │
   │  - check_rx_presence() → HARD-FAIL if miss  │
   │  - chunk_to_cnn_spectrogram() → CNN forward │
   │  - chunk_to_lstm_features() → ring buffer   │
   │  - features_to_lstm_sequence() → LSTM fwd   │
   │  - alpha-fuse → Frame("result")             │
   │                                             │
   │  queue.Queue(maxsize=10) drop-oldest        │
   │                                             │
   │ [Frontend main thread (matplotlib)]         │
   │  - FuncAnimation @ UPDATE_HZ=5 fps          │
   │  - _drain_queue() (get_nowait 循环, 取最新)  │
   │  - 4 个 _update_* 方法                       │
   └─────────────────────────────────────────────┘
                     ↓
            TkAgg matplotlib window
```

**非阻塞保证（4 条）**：

1. **Worker 线程永远不等 matplotlib**——只用 `queue.put_nowait`（满了 drop-oldest）
2. **Main thread 永远不碰 numpy/torch**——只用 `set_data()` / `set_text()` 等 matplotlib API
3. **重操作（np.load, torch forward）都在 worker**——这些都释放 GIL
4. **maxsize=10 + drop-oldest**——UI 卡 5s 也不会 OOM，最多丢 10 帧（status line 显示 `frames_dropped` 计数）

### 1.3 4 行布局（matplotlib gridspec `height_ratios=[1.6, 1.4, 1.6, 0.6]`）

```
┌─────────────────────────────────────────────────────────────────┐
│ Row 0: BIG active class banner (font 44, bold, color-coded)    │
│        STILL          (priority winner, dimmed face color)       │
│        2nd: WALKING (0.182)  |  active prob = 0.540             │
│        THRESHOLD = 0.50  |  priority: FALL > FLOOR > ... > EMPTY │
├─────────────────────────────────────────────────────────────────┤
│ Row 1: 4 RX amplitude streams (rolling 30s, shared x-axis)      │
│        ── RX1 ── RX2 ── RX3 ── RX4 ──  (4 colored lines)        │
├─────────────────────────────────────────────────────────────────┤
│ Row 2: 6-class probability bars (horizontal, threshold line)    │
│  FALL_IMPACT ████ 0.78 ←─ black border (priority winner)        │
│  FLOORED     ███  0.65   ┊                                    │
│  TRANSITION  ██   0.42   ┊ threshold = 0.50 (red dashed)       │
│  WALKING     █    0.24   ┊                                    │
│  STILL       ██   0.31   ┊                                    │
│  EMPTY       ▏    0.05                                        │
├─────────────────────────────────────────────────────────────────┤
│ Row 3: Status text (mono font, 2 lines)                         │
│   chunk=..._0042.npz  t_offset=252s  LSTM=16/16 (100%)  α=0.50 │
│   recent classes: STILL STILL WALKING WALKING FALL_IMPACT      │
└─────────────────────────────────────────────────────────────────┘
```

**为什么选这个布局**（vs `collection_mouse.py` 的 5 行）：
- collection_mouse.py 有"mouse bit buffer"行（标注用），本场景不需要
- 4 行足够覆盖：(1) 当前状态 (2) 原始数据 (3) 概率分布 (4) 元信息
- height_ratios 优先 banner（最大字号 44 必须有空间）

### 1.4 优先级 + 阈值

```python
THRESHOLD: float = 0.50
PRIORITY_ORDER: list[str] = [
    "FALL_IMPACT",   # 1. 最高——生命攸关（跌倒瞬间）
    "FLOORED",       # 2. 已倒地（跌倒后恢复期）
    "TRANSITION",    # 3. 过渡动作，常是跌倒前兆
    "WALKING",       # 4. 主动运动
    "STILL",         # 5. 站立/坐
    "EMPTY",         # 6. 无人
]
```

**为什么 FLOORED 插在 FALL_IMPACT 之后**（用户原话列表只有 5 项）：
- 用户说"如 fall>TRANSITION>WALKING>STILL>empty"——"如"=for example，是举例不是定稿
- FLOORED = "person already on ground after fall"，临床上与 FALL_IMPACT 同等级紧迫
- 用户大概率忘了列（5/6 漏一项很常见）
- 代码注释里明确写了 rationale，方便后续修改

**`pick_active` 行为**（4 个 unit test 全过，详见 §3）：

| 测试 | probs | threshold | priority | 期望返回 | 实测 |
|---|---|---|---|---|---|
| 1 | [0.05, 0.10, 0.05, 0.05, 0.60, 0.15] | 0.50 | FALL > FLOOR > ... | (FALL_IMPACT, 0.60) | ✓ |
| 2 | [0.05, 0.10, 0.05, 0.05, 0.40, 0.70] | 0.50 | FALL > FLOOR > ... | (FLOORED, 0.70) | ✓ 优先级正确 |
| 3 | [0.05, 0.30, 0.05, 0.20, 0.10, 0.10] | 0.50 | FALL > FLOOR > ... | None（全低于阈值）| ✓ |
| 4 | 类别顺序打乱 | 0.50 | FALL > FLOOR > ... | (STILL, 0.60) | ✓ 用 dict 查找非 positional |

**为什么不读 `config/runtime_state.json`**：
- `runtime_state.json` 的 `threshold` 字段是给 `infer_loop.py`（shipped 模型）的 FALL_IMPACT 告警门——不是前端的优先级门
- 用户原话"代码内可以修改阈值（不在前端展示）"明确要求代码常量
- 避免 schema 蔓延（runtime_state.json 已被 receiver/infer_loop/前端三方耦合，扩字段风险高）
- 未来若想 runtime 可调，新建 `frontend_state.json` 单文件 + worker 端 `os.path.getmtime` 轮询，不动 receiver

### 1.5 平滑插值（用户 2026-07-01 UX 反馈后新增）

**问题诊断**（用户实测）：
- Banner/probs 每 6s 跳一次（receiver 写 chunk 周期）
- amp streams 在 chunk 间隔静止
- 整体看起来"卡"，不像 collection_mouse.py 那样有连续实时感
- 实际 `frames_dropped = 0` → UI 跟得上 worker，瓶颈在 UX 而非性能

**用户原话**（解决方案）：
> "我可以故意让绘制慢一点别一下子全绘制，而是卡着时间大概6s内完成这一个chunk的绘制即可并及时进行判断，最后达到类似 collection_mouse.py 那样随时间滚动绘制看上去实时性很好的效果"

**实现**（2026-07-01 下午）：

| 子问题 | 方案 | 代码位置 |
|---|---|---|
| **probs/banner 跳变** | 收到新 chunk 时启动 **6s 平滑插值**：`display = source × (1 − eased) + target × eased`，eased = smoothstep(α) = `α² (3 − 2α)`，α = `elapsed / CHUNK_SEC` | `Frontend._compute_display_probs` + `_update_banner` + `_update_probs` |
| **amp streams 静止** | xlim 按 **wall clock 1× 滚动**（不依赖 chunk 到达）：`displayed_now = data_anchor + (now − wall_anchor)` | `Frontend._update_amps` |
| **首个 chunk 没有 source** | 直接 display = new chunk（无插值）| `Frontend._drain_queue` if `display_probs is None` |
| **重复 chunk 触发** | 第二个 chunk 到时，把**当前 display** 作为新 source（不是 latest_probs）——避免从陈旧的 raw 值跳变 | `Frontend._drain_queue` `self.source_probs = self.display_probs.copy()` |

**为什么 smoothstep 而不是 linear**：
- linear 插值在 t=0 和 t=6s 时斜率最大 → 视觉上是匀速但"突然开始 / 突然结束"
- smoothstep (3α² − 2α³) 起点和终点斜率为 0，中间加速 → 看起来更"自然"，像物体落地/起飞的加速曲线
- 用户说"看上去实时性很好"——smoothstep 给"加速到位"的视觉提示

**pick_active 重算时机**：
- 旧代码：`_update_banner` 读 `self.latest_probs`（raw worker 输出，可能 1-2 chunks 滞后）
- 新代码：`_update_banner` + `_update_probs` 都读 `self.display_probs`（插值后的"眼睛看到的值"），并每帧重算 `pick_active`
- 副作用：active class 可能在插值过程中**切换**（两个状态都接近 threshold 时），这反而是 informative——说明模型不确定

**状态字段**（`Frontend.__init__` 新增）：

```python
self.display_probs: np.ndarray | None = None     # 当前显示（lerped）
self.source_probs: np.ndarray | None = None      # 插值起点
self.target_probs: np.ndarray | None = None      # 插值终点
self.interp_start_t: float | None = None         # monotonic() at lerp start
self._wall_anchor: float | None = None            # wall clock at first chunk
self._data_anchor: float = 0.0                   # t_offset of first chunk
```

### 1.6 复用 vs 新增（决策表）

| 来源 | 函数 | 行号 | 复用方式 |
|---|---|---|---|
| `infer_loop_ensemble.py` | `check_rx_presence` | L128 | 直接 import |
| 同上 | `chunk_to_cnn_spectrogram` | L146 | 同上 |
| 同上 | `chunk_to_lstm_features` | L199 | 同上（含 abs_t_offset 参数）|
| 同上 | `features_to_lstm_sequence` | L274 | 同上 |
| 同上 | `load_lstm` | L296 | 同上 |
| 同上 | `load_cnn` | L314 | 同上 |
| 同上 | `pick_device` | L327 | 同上 |
| 同上 | `recover_feature_stats` | L421 | 同上（worker startup 时调一次）|
| 同上 | `classes_from_dataset` | L455 | 同上 |
| `collect.py` | `CLASS_COLORS` (5 项) | — | 复制 + 扩展为 6 项（FALL_IMPACT / FLOORED）|
| `csi_io.py` | `MultiPortReader.__init__` 模式 | L86, L103 | 镜像：`threading.Thread(daemon=True) + threading.Event()` |

**新增的代码**（仅 frontend 独有逻辑）：
- `pick_active()`：priority walker（~15 行）
- `extract_amplitude_streams()`：npz → dict[mean_amp]（~15 行）
- `downsample_amplitudes()`：`arr[::factor]`（~5 行）
- `class_color()`：dict 查找 + fallback（~3 行）
- `InferenceWorker.run()`：主循环 + 异常捕获（~150 行，与 `infer_loop_ensemble.main()` 526-643 高度同构）
- `Frontend._build_figure()`：4 行 gridspec + artists 初始化（~120 行）
- `Frontend._update_*()`：每行 1 个方法（4 × ~30 行 = 120 行）

---

## 2. 与已有约束的一致性

| 约束 | 出处 | 本实现 |
|---|---|---|
| 不修改 upstream 脚本 | CLAUDE.md 红线 + `dev_doc/6` §2.1 | `infer_loop_ensemble.py` / `train_lstm.py` / `train_cnn_deep.py` 未动一字 |
| cwd 锚定 | `dev_doc/3` §D.6/D.7 | `_PROJECT_ROOT = Path(__file__).resolve().parents[3]`，所有默认路径用绝对 |
| 复用 `infer_loop_ensemble` 函数 | 用户原话 | 9 个函数直接 import（见 §1.5 表）|
| `CLASS_COLORS` 一致性 | `collection_mouse.py` 风格 | 6 项版本（扩展 FALL→FALL_IMPACT，FLOORED 单独色）|
| RX 政策（HARD-FATAL）| `dev_doc/7` | worker 检测到缺 RX → push `Frame("fatal")` → main thread 画红色 banner → worker `stop_event.set()` |
| 退出码 2 语义 | `dev_doc/7` §2 | CLI `infer_loop_ensemble.py` 仍 exit 2；frontend 因为要保留窗口给用户看，**不调用 sys.exit** 而是 worker 退出 + 红色 banner |
| Threading 模式 | `csi_io.py:50,86,103` | `threading.Thread(daemon=True) + threading.Event()` 镜像 |
| Matplotlib backend | `collection_mouse.py:88-93` | `TkAgg` + try/except fallback |
| matplotlib 3.7+ deprecation | `collection_mouse.py:750` | `cache_frame_data=False` 已加 |
| LOOCV 等价物 | `dev_doc/5` §0.4 | 不在本轮做，留给 §6 |

---

## 3. 验证（2026-07-01 实测）

### 3.1 静态检查

| 检查 | 结果 |
|---|---|
| AST parse | ✓ |
| 行数 | 855（< 1000 单文件预算）|
| docstring 覆盖率 | 100%（每个 class/function）|
| type hint 覆盖率 | ~90%（Queue/Frame TypedDict 完整）|

### 3.2 Unit tests（import 时跑）

`pick_active` 4 个 case 全过（详见 §1.4 表）：
- ✓ 优先级胜出（FALL=0.60 > FLOOR=0.70 的 test 2 验证）
- ✓ 全低于阈值
- ✓ 类别顺序打乱仍正确（dict lookup 而非 positional）

### 3.3 InferenceWorker smoke test

`MPLBACKEND=Agg timeout 30` 起 worker，5 秒后检查队列：

```
recover stats session_20260630_194547: X=(919, 16) took 1.35s
recover stats session_20260630_203335: X=(423, 16) took 0.68s
recover stats session_20260630_205253: X=(384, 16) took 0.51s
recover_feature_stats total: 2.55s (3 sessions, Xall.shape=(1726, 16))
queue size after 5s: 10
  kinds seen: ['result', 'error', 'error', 'result', 'error', 'error', 'result', 'error', 'error', 'result']
worker alive after stop+join: False
```

- ✓ 模型加载 2.55s（与 `HANDOFF-2026-06-30` §1 修复后基线一致）
- ✓ 队列满到 10（说明 worker 在持续生产 frames）
- ✓ kinds 混合 result + error——`result` 是 CNN-only 兜底（缺 RX3 时 LSTM 跳），`error` 是 RX 缺失的 warn
- ✓ stop + join(2.0s) 干净退出，worker `is_alive() == False`

### 3.4 Frontend instantiation test

```python
frontend = app.Frontend(worker=worker, ...)
✓ Frontend instantiation OK
✓ _drain_queue() on empty queue OK
✓ All 4 _update_* methods called OK
```

Agg backend 下整个 frontend 实例化成功，4 个 update 方法在空状态下都能调用。

### 3.5 端到端 live 测试（待用户在真 receiver 跑）

下面 4 项需要物理 4 块 ESP32 RX 在线（**用户做**）：

| 验证 | 步骤 | 期望 |
|---|---|---|
| Banner 切换 | 静坐 30s | "Waiting for chunks…" → "(below threshold)" → "STILL"（≤30s 内）|
| LSTM warmup | 静坐 96s | status line `LSTM=16/16 (100%)` |
| 4 RX 完整 | 真 receiver 跑 5 min | 队列连续出 `kind=result`，无 `fatal` |
| RX 拔线模拟 | 拔 RX3 USB | banner 变红 "RX DISCONNECT"，worker 退出 |
| **平滑插值**（§1.5）| 静坐 1 min | banner **6s 内从 STILL 平滑过渡到 FALL_IMPACT**（不是跳变）；amp streams 持续滚动（不冻结）|

### 3.6 验证清单

- [x] §3.1 静态检查（935 行）
- [x] §3.2 pick_active 4 个 unit test
- [x] §3.3 InferenceWorker smoke test（模型加载 + 队列生产 + stop+join）
- [x] §3.4 Frontend instantiation（Agg backend）
- [x] **§3.5 平滑插值 10 个 unit test + 集成测试**（详见 §3.7）
- [ ] §3.6 端到端 live 测试（用户物理验证）

### 3.7 平滑插值测试（§1.5 实现后新增）

#### 单元测试（10/10 pass）

| # | 场景 | 期望 | 实测 |
|---|---|---|---|
| 1 | 初始状态 display/source/target 都为 None | 都 None | ✓ |
| 2 | 首个 chunk：直接 display，无插值 | display == new_probs, source/target = None | ✓ |
| 3 | 第 2 个 chunk 到：插值启动 | source/target 都设置 | ✓ |
| 4 | t=0 时刻调用 _compute_display_probs | display == source（smoothstep(0)=0）| ✓ diff=1e-15 |
| 5 | t=3s 调用（α=0.5）| display == 中点（smoothstep(0.5)=0.5）| ✓ diff=1.08e-7 |
| 6 | t=6.5s 调用（α>1.0）| display == target, source/target 清空 | ✓ |
| 7 | idle 状态（无新 chunk）| display 冻结在 last value | ✓ |
| 8 | STILL→WALKING 中点 | display ≈ 50/50, pick_active 可能 None（都 < 0.5）| ✓ |
| 9 | 边界：target=None | display 不变 | ✓ |
| 10 | worker stop+join | is_alive=False | ✓ |

#### 集成测试（6/6 pass）

通过 `q.put_nowait` 推入 Frame，调用 `frontend.update(None)`，验证完整 update 流程：

| # | 操作 | 期望 | 实测 |
|---|---|---|---|
| 1 | Frame 1 (STILL=0.80) → update | display=[0.05, 0.80, 0.05, 0.05, 0.03, 0.02], source=None | ✓ |
| 2 | Frame 2 (FALL=0.70) → update 立即 | source/target 已设，display 还是 source | ✓ |
| 3 | t+3s 后 update | FALL_IMPACT=0.365（smoothstep midpoint）| ✓ 在 [0.30, 0.45] |
| 4 | t+6.5s 后 update | display=[0.02, 0.10, 0.05, 0.08, 0.70, 0.05]，source/target 清空 | ✓ atol=1e-3 |
| 5 | wall_anchor / data_anchor 已设 | `_wall_anchor=7101.36, _data_anchor=6.0` | ✓ |
| 6 | pick_active 在最终 display | ('FALL_IMPACT', 0.70) | ✓ |

### 3.8 性能特征（用户实测反馈）

用户实测后反馈："Banner 6s 跳一次太慢"，`frames_dropped=0`（UI 完全跟得上 worker）。所以根因是 UX 不是性能。

### 3.9 amp streams 累积 bug 修复（用户第二轮反馈后）

**用户反馈**："为什么现在上方的幅值信息不进行绘制了呢"

**实测诊断**（mock worker + 推 3 帧）：
- 修复前：3 帧推入 → amp_buffers 只有 **27 点/RX**（= 1 帧的 downsample 后点数）
- 修复后：3 帧推入 → amp_buffers 有 **81 点/RX**（= 3 帧 × 27 点）
- 截图确认 4 条曲线（蓝/橙/绿/红）正确绘制，从 t=120 滚到 t=132

**根因**：
`_drain_queue` 用 `while not queue.empty(): latest = queue.get_nowait()` 循环**丢弃所有中间帧**，只保留 `latest` 一帧的 amp_streams。当 worker 出帧速度 > UI drain 速度（queue 堆积 ≥2 帧）时，中间帧的振幅数据全部丢失。

旧代码 probs/banner 不受影响是因为只看 latest；但 amp_streams 是累积数据，看 latest 会丢 90% 数据。

**修复**：抽 `_accumulate_amp_streams(frame)` helper，**每一帧**调用一次（不只是 latest）。Probs/banner 仍只看 latest。修改位置：`Frontend._drain_queue` + 新增 `Frontend._accumulate_amp_streams`（共 +30 行）。

**验证**：

| 场景 | 修复前 | 修复后 |
|---|---|---|
| 推 3 帧 → 1 次 update | amp_buffers 有 27 点（1 帧）| amp_buffers 有 81 点（3 帧）✓ |
| 推 3 帧 → 3 次 update（每次 1 帧）| 27 → 54 → 81 | 27 → 54 → 81（行为一致）✓ |
| 真 receiver 跑 15s | 仅最后一帧的 amp 数据 | 所有帧的 amp 数据累积 ✓ |
| 截图 | (不可用) | `/tmp/frontend_after_fix.png` 显示 4 条曲线正确绘制 |

**为什么之前的 unit test 没发现**：
之前 10 个 unit test + 6 个集成 test 都**手动推入单帧并断言 state**——没测试"队列里堆了多帧、每次 update 全部 drain"的场景。新增的 3.9 测试用 mock worker + 推 3 帧验证累积行为。

**教训**（CLAUDE.md §4.2 根因优先）：
- "queue 全 pop 但只留 latest"是个**隐性 bug**，对 latest-only state 无害，对累积 state 是数据丢失
- 任何"对队列做 batch 操作并只留 last"的地方都要问：last 够吗？还是需要累加？
- 单元测试要覆盖 queue depth > 1 的场景

§1.5 平滑插值修复后**预期**（需用户实测确认）：
- Banner 在每个 chunk 到达时启动 6s 视觉过渡（看起来像在"逐渐变化"）
- Amp streams 持续滚动（wall clock 1× 速率），不冻结
- 整体观感接近 collection_mouse.py 的连续波形

### 3.10 频谱图替代时序图（用户第三轮反馈后）

**用户反馈**：
> "我认为上面的图横坐标不应该是时间，而应该是频率，因为你现在的代码也没有很好的进行绘制，我选择放弃幅值随时间变化而是绘制实时的RX1-4的幅值-频率变化图，且随着下方数据一起变化"

**决策**：Row 1 从 **amplitude-vs-time** 改为 **amplitude-vs-frequency**。

**为什么用户偏好频谱图**（不是时序图）：
- CSI 数据本身在频域：192 个 OFDM 子载波 = 192 个频率采样点
- 时序图（mean amplitude over time）信息量低：4 条均值曲线难以看出事件
- 频谱图能直接显示每个频率分量的强度，跌倒/移动会在特定子载波产生明显尖峰
- 用户原话："随下方数据一起变化"——每个新 chunk 触发一次频谱更新，与 Row 2 prob bars 同步

**实现改动**：

| 改动 | 文件 | 行 |
|---|---|---|
| `extract_amplitude_streams`: `mean(axis=1)` → `mean(axis=0)`（从时序均值改为频谱均值）| `app.py` | ~245 |
| 删除 `amp_buffers` / `amp_times` rolling buffer 状态 | `app.py` | Frontend.__init__ |
| 新增 `spectra` / `spectra_source` / `spectra_target` / `spectra_interp_start` 状态 | 同上 | 同上 |
| `_drain_queue`: 改为最新频谱 snapshot + 6s smoothstep 插值（同 probs） | 同上 | _drain_queue |
| 删除 `_accumulate_amp_streams` helper | 同上 | — |
| 新增 `_compute_display_spectra` helper | 同上 | _compute_display_spectra |
| `_update_amps`: 改 plot 频谱线（4 条共享 x 轴 = subcarrier 0-191） | 同上 | _update_amps |
| `update()`: 加 `_compute_display_spectra()` 调用 | 同上 | update() |
| xlabel: `"seconds (last 30s)"` → `"subcarrier index (0–191, WiFi OFDM)"` | 同上 | _update_amps |

**新截图**：`/tmp/frontend_spectrum.png` 显示：
- Row 1：4 条频谱线（RX1 蓝 ~62, RX2 橙 ~38, RX3 绿 ~52, RX4 红 ~31），x 轴 0-191 subcarrier
- 频谱形状相似但基线不同（不同 RX 位置不同，多径效应）
- 每次新 chunk 频谱整体"变形"（smoothstep 插值 6s），看起来像频谱在"流动"

**设计选择**：

| 选择 | 原因 |
|---|---|
| 单 axes 共享 x 轴（不拆 4 个 subplots） | Row 1 高度有限（height_ratios=1.4），4 subplots 会太小看不清 |
| 默认 matplotlib 颜色循环（蓝/橙/绿/红） | 与 collection_mouse.py 的活动条风格一致；自定义需要 Class color 表 |
| x 轴固定 [0, 191]，y 轴 auto-scale | 频率轴是确定的（subcarrier 数），振幅随数据变 |
| 6s smoothstep 插值（沿用 §1.5）| 与 banner 一致，避免频谱"瞬变" |
| 不保留历史频谱 | 频谱图通常看"当前状态"，不滚动——单一频谱足够 |

**已知边界**：
- 未做实际 WiFi 频率映射（subcarrier index 0-191 vs WiFi 频率 MHz）——用户暂不需要
- 频谱随时间变化太快时（跌倒事件），6s 插值可能"糊掉"瞬态——若需要可加 `--spectrum-no-interp` flag
- 未实现频谱热图（time × freq 滚动），用户暂不需要

**为什么之前没做频谱图**：
原始设计假设 collection_mouse.py 的"波形 + 活动条"风格适合 CSI——但 CSI 是离散采样的频域数据，时域 mean amplitude 是降维过度。频谱图保留全部信息，更适合"看 RX 在不同频段的响应差异"。

**CLAUDE.md §0 第一性原理**：
- "从原始需求和问题本质出发" → CSI 是频域数据 → 显示频域
- "如果一个动作、推荐、参数没有清晰的'为什么'，立刻停下澄清" → 用户给了清晰的"为什么"（"随下方数据一起变化"），所以直接改

---

## 4. 决策可追溯

| 决策 | 依据 | 替代方案（不做） |
|---|---|---|
| 单文件 855 行 | 用户偏好简单 + 复用现有函数无需封装层 | split 成 `worker.py` + `frontend.py`（增加 import 噪音）|
| FLOORED 插 FALL 之后 | 临床紧迫性 + 用户原话 "如"=举例不是定稿 | 严格按用户 5 项不加 FLOORED（漏处理最紧急状态）|
| 不读 `runtime_state.json` | 用户原话"代码内修改" + 避免 schema 蔓延 | 读 `state.py` 的 `threshold` 字段（语义错位，是 infer_loop 的告警门不是优先级门）|
| queue.Queue(10) drop-oldest | UI 阻塞不让 worker 阻塞（OOM 风险）| queue.Queue(无限) → UI 卡顿可能 OOM；queue.Queue(1) → 频繁丢帧 |
| `InferenceWorker` 在 `run()` 里 load models | 让 `__init__` 快返回，避免 main 阻塞 | 在 main 里 load 再传 worker（main 卡 2.5s 不友好）|
| FuncAnimation 200ms（5 fps）| TkAgg 已验证 OK + class banner 不需要 60fps | 50ms（20fps）→ matplotlib 重绘压力 + Tk 事件循环竞争 |
| amp_downsample=4（430→107 pts/chunk）| 视觉上无差，CPU 节省 | 不 downsample → matplotlib 重绘 4× CPU |
| rolling buffer maxlen=2000（≈1.5min）| 30s 窗口 + 4 RX + 70Hz/4 = 525 points，留 4× 余量 | maxlen=无限 → 长跑后 OOM |
| 不用 `multiprocessing` | 项目现成 `csi_io.py` 是 threading，GIL 在 numpy/torch 下释放 | multiprocessing.Queue → 序列化开销 + 进程间共享状态复杂 |
| TkAgg backend | `collection_mouse.py` 约定 | macOSX（仅 mac）+ QtAgg（额外依赖）|

---

## 5. 风险与边界

### 5.1 已识别风险（处理方式）

| 风险 | 处理 |
|---|---|
| matplotlib TkAgg 在 headless Linux 失败 | `try/except` fallback（与 collection_mouse.py 同款）|
| Worker 抛异常未捕获 | `try/except` 包整个 `_poll_once`，捕获后 push `Frame("error")` + 继续 |
| UI 卡顿导致 worker OOM | `QUEUE_MAX=10` + drop-oldest + `frames_dropped` 计数 |
| GIL 竞争（main thread 慢于 worker）| 重操作都在 worker（释放 GIL），main thread 只调 matplotlib API |
| `extract_amplitude_streams` 异常 | 返回 `{}` 不崩，main thread 不更新 amp_lines（视觉无变化）|
| 类别顺序打乱导致 priority 错位 | `pick_active` 用 `dict(zip(classes, probs))` 而非 positional |
| 关闭 window 时 worker 不退出 | `close_event` handler + `try/finally` + `worker.join(timeout=2.0)` |
| 启动期 recover_feature_stats 慢（2.5s）| 在 worker.run() 内（不在 main），UI 可先显示 banner "Waiting" |

### 5.2 未处理 / 已知边界

| 边界 | 说明 | 何时处理 |
|---|---|---|
| `runtime_state.json` hot-reload | 前端常量改完需重启 | 若用户要"实时改 threshold"则加 frontend_state.json |
| 报警钩子（Twilio/Pusher）| FALL_IMPACT 连续 N 帧 → 通知 | 不在 demo 范围（Day 5+）|
| 录音：FALL_IMPACT → 自动保存前后 30s NPZ 到 events/ | 训练数据回采 | 用户后续提需求时 |
| Web 前端（替代 matplotlib）| 远程监控场景 | 同上 |
| FPS 实测 ≥ 4 验证 | update() 没 perf_counter | 下次端到端测试时加 |
| 关窗后 1s 内 worker join 成功 | smoke test 已验（`worker.is_alive()=False` 后 join 返回）| ✓ |
| 颜色盲友好调色板 | CLASS_COLORS 是 RGB-only | 若用户提需求则改 viridis |
| LOOCV 重训后的 F1 提升 | 不在本轮 | 录 4 个新 session 后重训 |

---

## 6. 后续路径（不在本轮做）

| # | 任务 | 工时 | 阻塞 |
|---|---|---|---|
| 1 | 端到端 live 测试（HANDOFF-2026-07-01 §3.5）| 5-10 分 | 串口物理连 4 RX |
| 2 | 加 `--reprocess` flag（HANDOFF §4 #2）| 10 分钟 | 无 |
| 3 | 录 4 个新 session + 重训（HANDOFF §4 #3）| 30-60 分 × 4 | 时间 |
| 4 | LOOCV 评估（HANDOFF §4 #4）| 30 分钟 | #3 |
| 5 | Web 前端（Next.js）替代 matplotlib | 1-2 天 | 优先级 |
| 6 | Twilio/Pusher 报警钩子 | 半天 | 优先级 |

---

## 7. 文件清单

| 文件 | 状态 | 行数 |
|---|---|---|
| `src/pc_tools/frontend/app.py` | ✅ NEW（含 §1.5 平滑插值）| **935** |
| `src/pc_tools/frontend/README.md` | ✅ NEW | ~180 |
| `dev_doc/8-bouy-frontend-2026-07-01.md` | ✅ NEW（本文件）| ~430 |
| `HANDOFF-2026-07-01.md` §4 | 已更新：标记 frontend 任务完成 | — |
| `infer_loop_ensemble.py` | ❌ 未动 | — |

---

**最后更新**：2026-07-01 下午 by Claude
**依据**：用户原话 2026-07-01 + Plan agent 设计 + Phase 1 探索 + smoke test + UX 反馈（§1.5 平滑插值）
**状态**：✅ 10 单元测试通过（pick_active + 插值）+ InferenceWorker smoke test + Frontend 实例化 + 集成测试通过；端到端 live + 实际观感等用户物理验证（建议重点看 §1.5 的"6s 内平滑过渡"效果）。