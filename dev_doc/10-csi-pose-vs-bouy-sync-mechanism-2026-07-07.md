# 10 — csi-pose/host/csi_pipe 时钟对齐与切窗机制 vs Bouy 的一发四收做法

**日期**：2026-07-07
**作者**：Claude（应用户提问:查看 csi-pose/host/csi_pipe 实现并解释为何 Bouy 没采用类似方法做 1 发 4 收同步）
**状态**：✅ 完成（已通读 csi-pose 全部相关源码 + Bouy 采集/固件/训练三方源码）
**存放**：`Bouy_CSI_FallDetection/dev_doc/`（**不**写到父项目 `ESP32_FallRec_Reference/dev_doc/`）

---

## 1. 调研目标

对比 `csi-pose/host/csi_pipe/` 的两件事：

1. **时钟对齐**（`unwrap.py` + `clockfit.py` + `mqtt_recorder.py`）—— 怎么把每块 RX 板到达主机的 (esp_timer, t_host) 散点投影到一根可信时间轴
2. **采样切窗**（`align.py` 的 100Hz 共栅格 + `samples.py` 的 `cut_windows`，WIN=5）—— 怎么把异速 RX 链路统一到 280 通道滑动窗

并回答用户原问题：**为什么 Bouy 的 1 TX × 4 RX 没采用同样做法**。

---

## 2. 方法 / 工具

- 通读源码（**无网络搜索**，仅本地代码）：
  - csi-pose：`host/csi_pipe/{clockfit,align,samples,m15_protocol,store,mqtt_recorder,align_verify,rebuild,soak}.py`
  - csi-pose：`host/csi_host/{unwrap,gap,framing,bridge_core}.py`（支撑模块）
  - Bouy：`fall-detection-training/collection/{csi_io,collect,capture_multi}.py`
  - Bouy：`fall-detection-training/firmware/firmware_patches/{csi_recv_app_main.c,csi_send_app_main.c,README.md}`
  - Bouy：`fall-detection-training/labeling/split_fall_labels.py`
  - Bouy：`fall-detection-training/training/{train_lstm.py:90-160, ensemble_predict.py, csi_io.py}`（确认下游窗口消费方式）

---

## 3. 关键发现

### 3.1 csi-pose 的对齐链路（**二进制 130B 帧 + MQTT + 离线 clockfit**）

整个对齐方案的前提是 **RX 固件侧把可信时间戳烧进包**，所以能在主机侧重建每块板的本地钟并把它们和宿主钟 `t_host` 配对拟合。

**拓扑**: csi-pose 是 **3 TX × 3 RX = 9 链路**, 6 块 ESP32-S3 (3 块 TX 各广播 ESP-NOW beacon, 3 块 RX 监听所有 TX), 来源 [csi-pose/docs/csi-pose-techstack.html:405-543](ReferenceCode/Opensourse/csi-pose/docs/csi-pose-techstack.html#L405-L543) 与 `csi-pose/firmware/rx/main/csi_rx.c:23` (`tx_idx < 3` 硬约束)。每块 RX 板收 3 个 TX, 9 条 (rx, tx) 链路各有独立 seq 计数; clockfit 是**每块 RX 板一个模型** (见 §3.1.c `per_rx.setdefault(...)`), 共 3 个模型。

#### (a) 帧格式 `host/csi_host/framing.py`

```
130B 小端帧:
  magic u16 = 0xC51D
  rx_id   u8         ← RX 板 id (0..2), 用于多 RX 区分
  tx_idx  u8         ← TX 板 id (0..2), 用于多 TX 区分
  seq     u32        ← 链路 seq (TX 广播时塞入), 检测 gap / reset
  esp_timer_us u32   ← RX 侧 esp_timer_get_time() 在收到帧时盖戳
                       (见 csi-pose/firmware/rx/main/csi_rx.c:74)
  rssi/noise i8
  boot_id u8         ← 板重启探测 (每板独立单调 boot 计数器)
  iq      i8[112]    ← 56 个子载波的 (I,Q)
  crc16   u16
```

**TX beacon 与 RX 盖戳是分离的**: TX 端固件 (csi-pose/firmware/tx/main/main.c:2) 只广播 16B `{magic, tx_idx, seq}` —— TX 板**不在 beacon 上烧它自己的 esp_timer**; esp_timer 是 **RX 在收到包的瞬间盖戳的**, 所以是"RX 的到达时间", 不是"TX 的发送时间"。这条细节对后续 clockfit 解释很关键 (为什么我们拟合的是 RX 板钟, 不是 TX 板钟)。

`parse_frame()` + `StreamParser` 解析 + CRC 校验; `LinkTracker(gap.py)` 对每条 (rx, tx) 链路追踪 seq gap 与 reset。

#### (b) 时间展开 `host/csi_host/unwrap.py`

```python
class TimeUnwrapper:
    WRAP = 1 << 32  # 71.58 分钟
    def update(self, *, boot_id, t_us):
        if boot_id 变化:  # RX 重启 → 新 epoch, 返回 "reboot"
            epoch, last_raw = 0, None
        elif t_us < last_raw:  # u32 回绕 → epoch += 1
            epoch += 1
        return epoch * WRAP + t_us, event
```

→ 把 32-bit 回绕的 esp_timer 还原成单调递增 64-bit 区间时间。**每个 RX 板各自一个 unwrapper**。

#### (c) Clockfit `host/csi_pipe/clockfit.py`

核心创新。`fit_board(esp_us, t_ns, boot_id, window_s=600.0)` 输出一个 `BoardClockModel`，形式：

```
t_fit_ns(esp_us) = t0_ns + 1000·(esp_us − esp0) + d_us·1000
                  d_us = 分段线性 (centers, coefs), 在 _fit_epoch 中拟合
```

关键假设:USB-UART 批量到达只会**单向迟滞**(早到不可能,只能晚到)→ `(esp_us, t_host)` 散点的**下界凸包**才是真实钟线。

算法:
1. 桶化 (`window_s/20`, 最少 1s) → 每个桶保留最小 t_host 候选(压制单侧延迟噪声)
2. 对桶最小值做下凸包 `lower_hull_idx()` (monotone chain 下边)
3. 把整个会话切成 600s 窗口, 每个窗口 LS 拟合 `d_us = a·xs + b`
4. 跨窗口用线性插值连接 (`_eval_piecewise`), 端点外推
5. `wrap_continuity()` 在每个 u32 回绕边界前后 ±30s 取残差中位数, 差 < 1ms 判 OK

输出 `FitReport` 含 `slope_ppm` (µs/s 漂移) 和残差 `p5/p50/p95/max` (典型几 ms)。

#### (d) 异速对齐 + 共栅格 `host/csi_pipe/align.py`

```
1. split_epochs(seq, boot_id)        # 在 seq 后退或 boot_id 变化处切 epoch
2. fill_gaps(t_ns, seq, amp, max_run=2)  # 单 epoch 内 ≤2 连续缺失 → 线性插值;
                                          # >2 → 记入 breaks (栅格上 mask=真)
3. grid_bounds(streams, step_ns=10_000_000)  # 100Hz, 公共可用 [g0,g1]
4. grid_block(stream, tb)            # searchsorted + 双侧线性插值 + mask
```

#### (e) 锚点 + 切窗 `host/csi_pipe/samples.py` + `align.py:WIN=5`

```python
WIN = 5  # 5 packets × 56 subcarriers = 280 channels per (rx,tx)
```

锚点来自:
- 视频帧 `h["video/t_ns"]` (有摄像头会话) → 还要做 csi↔camera 校正
- 否则合成等间隔 `@anchor_rate Hz`

`cut_windows(amp, mask, starts)` 把 amp/grids 切成 `[N, 5*56, 3, 3]` float16 (3 RX × 3 TX = 9 链路), 通过 `valid[N] = (mask_in_5_packets ≥ 2)` 判定窗口是否可训练。

→ 最终 `X` shape = `[N, 280, 3, 3]` (5×56) × 9 links, 锚点对齐到视频帧的 ±10ms 抖动门 (`se_gate_ms=2`).

#### (f) 链路 `MQTT 桥 → 录制器`

`host/csi_host/bridge_core.py`: 每块 RX 一个 `BridgeCore` 通过串口读取 → 转 MQTT `csi/rx{i}` 主题; `mqtt_recorder.py` 订阅所有 `csi/#` + `cam/meta` → `SessionWriter` 写入 HDF5 (`/links/<rx><tx>`).

---

### 3.2 Bouy 的对齐链路（**CSV 串口 + 共线程读 + 在线掩码切窗**）

#### (a) 帧格式 — Espressif 官方 `ets_printf("CSI_DATA,...")` CSV

`fall-detection-training/firmware/firmware_patches/csi_send_app_main.c`:
```c
for (uint32_t count = 0; ; ++count) {
    esp_now_send(peer.peer_addr, (const uint8_t *)&count, sizeof(count));
    usleep(1000 * 1000 / CONFIG_SEND_FREQUENCY);   // 100Hz
}
```

→ TX 每秒发 100 次空包, 只带一个 seq 计数器。**没有 esp_timer_us, 没有 boot_id, 没有 rx_id 字段**。

`csi_recv_app_main.c`:
- 通过 `memcmp(info->mac, CONFIG_CSI_SEND_MAC, 6)` 过滤只接收 TX `1a:00:00:00:00:00`
- 打印: `CSI_DATA,<rx_id>,<mac>,<rssi>,<rate>,<noise_floor>,<fft_gain>,<agc_gain>,<channel>,<local_timestamp>,<sig_len>,...,[I/Q,...]"\n`
- **唯一的时间戳** 是 `rx_ctrl->timestamp` (32-bit WiFi 硬件 µs 计数器, ~71 分钟 wrap), **Bouy 不解析也不存它**

#### (b) 共线程读 `collection/csi_io.py:MultiPortReader`

```python
class MultiPortReader(threading.Thread):
    # 单线程用 selectors 监听所有串口 → 避免 GIL 争抢
    # 每条 line 解析后:
    self.buffers[name].append((time.monotonic(), amps))
```

→ 时间戳是**主机的 `time.monotonic()`**, 4 个串口都在同一进程同一线程, 时钟天然一致;但每条 (rx, ts) 的"绝对真实时间"不可知 —— 串口 buffer 抖动最多几十 ms, 没人去测。

#### (c) 在线切窗 `collection/collect.py` & `training/train_lstm.py:90-160`

`collect.py` 存的是 `csi.npz` 每 RX 独立 `(timestamps, amplitudes)`, **没有任何全局对齐步骤**:

```python
save_dict[f"timestamps_{name}"] = ts_rel   # 各 RX 各自的单调时间
save_dict[f"amplitudes_{name}"] = amps     # 各 RX 各自的振幅
```

`train_lstm.py` 消费时 (`extract_features_for_session`):
```python
anchor = rx_names[0]                       # 用 RX1 当时间锚
t_anchor = csi[f"timestamps_{anchor}"]
t_start, t_end = float(t_anchor[0]), float(t_anchor[-1])
windows = [t + win_sec/2 for t in arange(t_start, t_end, hop_sec)]   # 1s 窗, hop 0.5s

for name in rx_names:                       # 4 RX 独立取窗
    ts = csi[f"timestamps_{name}"]
    mask = (ts >= t_lo) & (ts < t_hi)       # 布尔掩码 — **不插值,不重采样**
    chunk = amps[mask]
    if chunk.shape[0] < 5:
        X[w_idx, col:col+4] = 0.0           # 缺失 → 0
```

→ 4 RX 的特征 (var / delta_var / mean_amp / spectral_centroid) 在窗中心对齐, 缺失 → 0。**完全没有 clockfit, 共栅格, 也没有搜插值**。

部署模型 (`fall-detection_seq9_ensemble`) 推理时用 `win_sec=6.0, hop_sec=0.5` 同样的锚 RX + 掩码取窗 (见 `eval_seq9_ensemble.py:241`).

---

### 3.3 为什么 Bouy **没**采用 csi-pose 的做法 —— 6 个根因

> **2026-07-08 修正**: 初稿第 1 条 "拓扑相反" 是**事实错误** —— csi-pose 不是 "1 RX × 多 TX", 而是 **3 RX × 3 TX = 9 链路**(证据见 [csi-pose/docs/csi-pose-techstack.html:461](ReferenceCode/Opensourse/csi-pose/docs/csi-pose-techstack.html#L461) 标题 `2.1 3TX × 3RX 链路矩阵`、L543 表格 `链路总数 | 9 | 3TX × 3RX`,以及 `firmware/rx/main/csi_rx.c:23` 的 `tx_idx < 3` 硬约束)。Bouy 是 **1 TX × 4 RX = 4 链路**。**两个拓扑都需要 per-RX 钟差补偿**, 只是 csi-pose 做了、Bouy 没做。下表删掉原 #1, 重排成 6 条真因。

| # | 原因 | 决策依据 |
|---|---|---|
| **1** | **Wire 格式缺失 esp_timer_us**: clockfit 模型需要的自变量不存在 | csi-pose 在 wire 烧入 `esp_timer_us u32 + boot_id u8 + seq u32` (130B LE 协议, [csi-pose/host/csi_host/framing.py:14-22](ReferenceCode/Opensourse/csi-pose/host/csi_host/framing.py#L14-L22)); Bouy 用 Espressif stock `ets_printf("CSI_DATA,...")` CSV, **wire 上没有 esp_timer 字段**; RX 固件拿到 `rx_ctrl->timestamp` (32-bit µs) 但 Python 解析时**丢弃**; host 端 `time.monotonic()` 是 t_host, **没有对应的 esp_us 给 piecewise LS 拟合** |
| **2** | **对齐对象精度差 3 个数量级** | csi-pose 对齐**视频帧**, 目标抖动 ±10ms (`se_gate_ms=2, abs_gate_ms=10`, 见 `align_verify.py:verdict`), 必须做 csi↔cam 偏移校正 (`anchor_shift_ns` + `correction-apply` 规约); Bouy 对齐**键盘按下的 label 时间戳**, 标注精度本身 ~100ms 量级, 容忍 ±1s (`ensemble_predict.py:align_by_time` 默认 `tol_sec=1.0`) |
| **3** | **训练范式: 离线 build vs 在线特征提取** | csi-pose 是**离线** build (`samples.py:build()` 把整段 HDF5 重投影到 100Hz 共栅格, 再按视频锚点切窗); Bouy 是**在线特征提取** (`collect.py` 实时落盘, `extract_features_for_session` 在每次训练前重跑, 部署时实时推理) —— 离线 clockfit 与在线推理窗口必须用同一套机制, 否则训练/部署 drift |
| **4** | **窗口 + Ensemble 吸收抖动** | csi-pose 5 帧×56SC, 任务是**人体姿态回归**, 需要 sub-window 级相位关系, 抖动直接污染特征; Bouy 9 帧×6s 窗口 + 4-RX ensemble (CNN 频谱 + LSTM + Transformer) **隐式平均掉了亚秒抖动** —— 4 RX 看同一跌倒事件的不同多径, 微小时间差在 6s 窗内被方差/频谱特征抹平 |
| **5** | **边际效用近乎为零** | 即便能做到 1ms clockfit 残差, 在 6s 窗 + ensemble + 100ms 标注精度链下**不增加任何可决策信息** |
| **6** | **改造成本 vs 项目目标** | csi-pose 是 "把 Intel WiSPPN 移植到 ESP32" 的研究原型, 自定义 wire 协议可接受; Bouy 目标是"完整业务闭环 (固件 + 训练 + 实时 + 状态机 + 告警 + PWA)", README 明确走 `flash_tx.sh / flash_rx.sh` 复用 Espressif stock + 最小 patch (BW40 重命名 + 固定 MAC + 信道 11→6) |

#### 3.3.1 真实拓扑对照 (订正后的)

| 拓扑维度 | csi-pose | Bouy |
|---|---|---|
| TX 数 | 3 | 1 |
| RX 数 | 3 | 4 |
| (rx, tx) 链路总数 | 9 | 4 |
| Per-RX clockfit 模型数 | 3 (一块 RX 一个, 见 `samples.py:157-165`) | 0 |
| 跨 RX 漂移补偿需求 | ✅ 3 RX 各晶振 ppm 不同 → 必须做 | ✅ 4 RX 各晶振 ppm 不同 → **但没做** |

---

### 3.4 关键代码片段对照

| 维度 | csi-pose | Bouy |
|---|---|---|
| **wire 时间戳** | `esp_timer_us u32` (framing.py L17) | **无** —— `rx_ctrl->timestamp` 存在但丢弃 |
| **回绕处理** | `TimeUnwrapper.update()` (unwrap.py L16) | **无** —— 不存 32-bit 计数 |
| **RX 钟差补偿** | `BoardClockModel.predict()` (clockfit.py L125) | **无** —— 假定 host `time.monotonic()` 同一进程一致 |
| **共栅格** | `grid_bounds + grid_block` @ 100Hz (align.py L81-110) | **无** —— 直接在原始时间戳上做布尔掩码 |
| **缺失处理** | `fill_gaps(max_run=2)` 线性插值 + breaks 标记 | `chunk.shape[0] < 5 → X=0` (train_lstm.py L136) |
| **切窗** | `cut_windows(WIN=5)` → `[N, 280, 3, 3]` f16 (align.py L127) | 1s/6s 滑窗 + 4-RX feature concat (train_lstm.py L114-151) |
| **锚点** | 视频帧 `video/t_ns` + csi↔cam 校正 | RX1 的 `timestamps_RX1` (train_lstm.py L107) |
| **数据落盘** | HDF5 `/links/<rx><tx>` + `/grid` + `/samples` (store.py L73-89) | NPZ `csi.npz` per session, 键 `timestamps_<RX>` + `amplitudes_<RX>` (collect.py L322) |
| **传输** | USB-UART → BridgeCore → MQTT `csi/rx{i}` → recorder (bridge_core.py L80) | 4 串口 → `MultiPortReader` 单线程 selectors (csi_io.py L139) |

---

### 3.5 Bouy 隐含承担的对齐风险

> ⚠️ 这不是建议修, 只是诚实声明 Bouy 的"我没对齐"实际意味着什么:

- **跨 RX 偏移未测**: 4 块 RX 在 `time.monotonic()` 上的相对偏移没人测过。`MultiPortReader` 用 selectors 是单线程, 但串口 buffer 抖动 + USB 调度会让 4 个 `(t_monotonic, amps)` 时间戳之间的真实偏差最大到几十 ms
- **训练窗口与部署窗口都基于 RX1 锚**: 如果 RX1 提前掉线或突发延迟, 所有窗中心跟着偏。但因为 `extract_features_for_session` 的窗口足够长 (1s / 6s), 单帧级别抖动对频谱和方差特征都不敏感
- **CSI-HAR 外部数据集适配** (`external_data_adapter/csi_har_adapter.py`) 在跨数据集时引入了 4×3 维度重排, 是另一个层面的"对齐"——不是时钟, 是子载波索引

---

## 4. 结论

### 4.1 csi-pose 时钟对齐三件套的本质

1. **wire-level 时间戳** (`esp_timer_us` + `boot_id` + `seq` 烧进帧) → 提供拟合自变量
2. **下凸包拟合** (`lower_hull_idx` + 分段 LS) → 在单向延迟噪声下恢复真实钟线
3. **共栅格 + 锚点** (`grid_block` + `window_indices`) → 把异速链路投到 100Hz 公网

### 4.2 Bouy 不采用的根因 (一句话)

**Bouy 是 1 TX × 4 RX, 4 块 RX 板各跑独立晶振, 同样存在 per-RX 钟差问题 —— 但 wire 上没有 `esp_timer_us`(用 Espressif stock CSV, `rx_ctrl->timestamp` 被丢弃),对齐目标只有键盘 label(~100ms 精度而非视频 ±10ms),且 4-RX ensemble + 6s 窗口已经把亚秒抖动摊平 —— clockfit 在这个范式下是 over-engineering。**

> ⚠️ 这里诚实声明: **csi-pose 也是 3 RX × 3 TX, 同样是多 RX** —— 两个项目都有 per-RX 钟差问题。区别**不在拓扑**, 而在 (a) wire 协议是否烧入 esp_timer、(b) 对齐目标精度、(c) Ensemble 与窗口长度。这三条都成立时, Bouy 选"不修"是工程合理, 不是拓扑简化带来的"幸运副作用"。

### 4.3 给本项目 (父 ESP32_FallRec_Reference) 的复用建议 (待用户复核)

- 如果要复用 csi-pose 的同步思路 → **必须**改固件, 把 `esp_timer_us u32` 烧进包(参考 `csi-pose/host/csi_pipe/framing.py:build_frame` —— 注意是 csi-pose 自家固件, 不是 Espressif stock)
- 如果保持 ESP-NOW + 4 RX + 1 TX 拓扑 → 复用 Bouy 的做法即可, 把 `time.monotonic()` 单线程读视为足够好的时间锚, 用 4 RX ensemble 吸收抖动
- **不要同时复用**两边的 wire 格式 —— `ets_printf("CSI_DATA,...")` (Bouy/Espressif stock) vs `0xC51D 130B 二进制` (csi-pose 自定义) 二选一

---

## 5. 待澄清事项 / 不在范围内

- ❓ Bouy 4 RX 间的真实时间偏移量没人测过 — 如果要做精密同步研究, 需要在固件侧加 `esp_timer_us` 后做一次基准实验
- ❓ csi-pose 是否真的在多 TX 拓扑下达到了 se < 2ms — README 没看到指标, 需翻 evaluation 目录
- ❓ Bouy CSI-HAR adapter 的 4×3 维度重排细节没读, 留待 11-bouy-csi-har-adapter-<date>.md

---

## 6. 参考来源 (全部本地代码, 无外部 URL)

| # | 文件 | 行号 | 引用内容 |
|---|---|---|---|
| r1 | `csi-pose/host/csi_pipe/clockfit.py` | L143-180 | `fit_board` 模型与 `BoardClockModel.predict` |
| r2 | `csi-pose/host/csi_pipe/clockfit.py` | L21-40 | `lower_hull_idx` 下凸包 |
| r3 | `csi-pose/host/csi_pipe/clockfit.py` | L87-116 | `_fit_epoch` 分段 LS |
| r4 | `csi-pose/host/csi_pipe/align.py` | L31-69 | `split_epochs` + `fill_gaps` |
| r5 | `csi-pose/host/csi_pipe/align.py` | L81-110 | `grid_bounds` + `grid_block` |
| r6 | `csi-pose/host/csi_pipe/align.py` | L113-135 | `WIN=5` + `cut_windows` |
| r7 | `csi-pose/host/csi_pipe/samples.py` | L139-256 | `build()` 编排 |
| r8 | `csi-pose/host/csi_host/unwrap.py` | L1-30 | `TimeUnwrapper` |
| r9 | `csi-pose/host/csi_host/gap.py` | L1-35 | `LinkTracker` |
| r10 | `csi-pose/host/csi_host/framing.py` | L14-22 | 130B 帧结构 |
| r11 | `csi-pose/host/csi_host/bridge_core.py` | L68-80 | `BridgeCore._on_frame` → MQTT 发布 |
| r12 | `Bouy/.../collection/csi_io.py` | L50-195 | `MultiPortReader` 单线程 selectors |
| r13 | `Bouy/.../collection/collect.py` | L254-369 | `save_session` 写 csi.npz |
| r14 | `Bouy/.../collection/collect.py` | L447-470 | 启动期 3s 等待确认所有 RX 都收包 |
| r15 | `Bouy/.../training/train_lstm.py` | L90-162 | `extract_features_for_session` 锚 RX1 + 布尔掩码切窗 |
| r16 | `Bouy/.../training/ensemble_predict.py` | L185-260 | `align_by_time` LSTM↔CNN 跨模型对齐 (1s 容忍) |
| r17 | `Bouy/.../evaluation/eval_seq9_ensemble.py` | L241-280 | 部署模型 6s win / 0.5s hop |
| r18 | `Bouy/.../firmware/firmware_patches/csi_send_app_main.c` | L141-181 | TX: esp_now_send + usleep, **无 esp_timer 字段** |
| r19 | `Bouy/.../firmware/firmware_patches/csi_recv_app_main.c` | L149-234 | RX: ets_printf CSI_DATA CSV, **丢弃 rx_ctrl->timestamp** |
| r20 | `Bouy/.../firmware/firmware_patches/README.md` | L1-81 | 固件来源说明 (Espressif 官方 + 最小 patch) |
| r21 | `Bouy/.../labeling/split_fall_labels.py` | L25-52 | FALL → FALL_IMPACT + FLOORED 切分 (1.5s 默认) |