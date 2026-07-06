# Spec — Bouy 技术栈全链路 HTML 复盘页 (2026-07-06)

## 0. 定位

| 字段 | 值 |
|---|---|
| **目标产物** | `dev_doc/9-bouy-tech-stack-2026-07-06.html`（单文件，CDN 引用）|
| **目标读者** | 你 / 团队工程师（深度技术向，默认懂 CSI / STFT / LSTM）|
| **范围** | ESP32 固件 → 1 TX + 4 RX 采集 → 标签切分 → LSTM + CNN 训练 → alpha 融合 → 实时推理 → 前端展示 |
| **不在范围内** | Twilio / Pusher / Next.js / PWA 业务层、Vercel 部署、SQLite schema |
| **目的** | 把"Wifi 信号 → 跌倒判定"整条链路**完整**写下来。便于：(a) 新成员 onboarding；(b) 你自己 6 个月后回看；(c) 改动任何超参 / 阈值 / 架构前，先看这份对齐决策依据 |
| **风格** | 完全白底 + 灰边框（github-readme / 官方文档风）。默认高密度展开，关键推导用 `<details>` 折叠 |
| **视觉元素** | Mermaid 流程图 + 手画 SVG 几何 + ASCII 示意。三者各取所长 |
| **代码引用策略** | 形式 `file.py:L10-L20`，**不抄整段代码**，避免代码漂移 |
| **日期标注** | 顶部显著位置写"基于 2026-07-06 代码复盘" |

## 1. 文件输出

```
dev_doc/9-bouy-tech-stack-2026-07-06.html   (单文件, ~2500 行内, CDN 引用 Tailwind + mermaid)
```

不在 `dev_doc/assets/` 下放额外资源（Mermaid + SVG 内联）。

## 2. 12 节骨架

| § | 标题 | 关键视觉 | 深度需求 |
|---|---|---|---|
| 0  | 索引 / TOC | sticky left | 中 |
| 1  | 硬件层 (1 TX + 4 RX + CSI packet) | SVG 房间示意 + ASCII packet 字节 | 高 |
| 2  | 采集层 (collect_mouse.py → NPZ) | Mermaid 时序 + ASCII NPZ 结构 | 中 |
| 3  | 标签切分 (FALL → FALL_IMPACT + FLOORED) | SVG 时间轴 + split 公式 | 中 |
| 4  | ★ 特征提取 (16 维 LSTM + 32 通道 CNN 频谱) | SVG 192→8 band 切片 + ASCII 4×4 特征向量 | **高** |
| 5  | 模型架构 (LSTM 1×64 + ResNet-CNN) | ASCII 简化架构图 + 表格对比 | 中 |
| 6  | 训练 (session-disjoint + Adam + ReduceLROnPlateau) | ASCII 三折分 + `<details>` 优化器参数 | 中 |
| 7  | ★ Ensemble 融合 (α·lstm + (1-α)·cnn) + 阈值 + 优先级 | SVG 融合条 + Mermaid priority walker | **高** |
| 8  | 实时推理 (NPZ → ensemble → 输出) | SVG streaming + Mermaid InferenceWorker + `<details>` 冷启动时序 | 中 |
| 9  | ★ 前端 (matplotlib 4 行 + smoothstep + bounded queue) | ASCII 4 行布局 + `<details>` smoothstep 公式 | **高** |
| 10 | 端到端时延累计 (跌倒 → 屏幕) | ASCII 时延图 | 低 |
| 11 | 决策表 (12 个"为什么") | 表格 | 中 |
| 12 | 已知限制 (Honest scope) | 列表 | 低 |

## 3. 关键超参集中表（在 §4 末尾）

| 超参 | 值 | 位置 |
|---|---|---|
| NOMINAL_RATE_HZ | 70 | infer_loop_ensemble.py:94 |
| LSTM_WIN_SEC | 1.0 | infer_loop_ensemble.py:99 |
| LSTM_HOP_SEC | 0.5 | infer_loop_ensemble.py:100 |
| LSTM_T_SEQ | 16 | infer_loop_ensemble.py:101 |
| LSTM_N_FEAT_PER_RX | 4 | infer_loop_ensemble.py:102 |
| NPERSEG | 96 | infer_loop_ensemble.py:91 |
| NOVERLAP | 80 | infer_loop_ensemble.py:92 |
| N_BANDS | 8 | infer_loop_ensemble.py:93 |
| α | 0.5 | ensemble_predict + state.json |
| THRESHOLD | 0.5 | frontend/app.py 顶部 |
| PRIORITY_ORDER | FALL_IMPACT > FLOORED > TRANSITION > WALKING > STILL > EMPTY | frontend/app.py |
| CHUNK_SEC | 6.0 | receiver.py + infer_loop |
| UPDATE_HZ | 5.0 | frontend/app.py |
| QUEUE_MAX | 10 | frontend/app.py |
| smoothstep CHUNK_SEC | 6.0 | frontend/app.py |

## 4. 数据流顶层架构（贯穿全页）

```
[ESP32 TX, 信道6] ──802.11n HT-LTF──> [4× ESP32 RX, /dev/ttyACM*]
                                          ↓ MultiPortReader 线程
[receiver.py] ──── 6s NPZ chunk ────> data/live/chunk_*.npz
                                          ↓
[infer_loop_ensemble.py  InferenceWorker 线程]
   ├ chunk_to_cnn_spectrogram    → (32, 49, 21) tensor
   ├ chunk_to_lstm_features      → (n_windows, 16) matrix
   └ features_to_lstm_sequence   → (16, 16) sequence
                                          ↓
[α·lstm_prob + (1-α)·cnn_prob]  α=0.5
                                          ↓
[priority walker + threshold 0.5] → 6 类概率 → 屏幕 banner
```

## 5. 排除清单（明确不写在 HTML 内）

- ❌ 完整源代码块（>5 行）
- ❌ Pusher / Twilio / Next.js / Vercel / Railway / SQLite 业务层
- ❌ 任何 LOOCV / 复现数字（除 §12 简短"已知限制"）
- ❌ 任何完整 NPZ 字节布局（只画 ASCII 简化版）
- ❌ 训练 checkpoints SHA / git hash
- ❌ 任何 PyTorch tensor API 详解（默认懂）

## 6. 关键事实（不写会错的）

| 事实 | 出处 |
|---|---|
| 1 TX + 4 RX | 项目定义 |
| WiFi 信道 6 + 192 子载波 | ESP32 CSI Tool 默认 |
| ~70 Hz packet 率 | ESP32 firmware 实测 |
| 921600 baud 串口 | receiver.py 默认 |
| 6 类：EMPTY / STILL / WALKING / TRANSITION / FALL_IMPACT / FLOORED | labels_v2.json |
| FALL_IMPACT 切片时窗 = 1.5s | split_fall_labels.py 默认 |
| LSTM 16 窗口 × 0.5s hop = 9s 感受野 | train_lstm.py 默认 |
| CNN 频谱 = (32通道, 49 freq, 21 time) | chunk_to_cnn_spectrogram 输出 |
| α 默认 0.5 | ensemble_predict 实测最优 |
| FALL_IMPACT recall = 91% @ threshold 0.5 | shipped README（仅作 reference） |
| 实时队列入上限 10 | frontend/app.py QUEUE_MAX |
| 6s smoothstep 插值 | frontend/app.py CHUNK_SEC |
| THRESHOLD=0.50 + PRIORITY_ORDER | frontend/app.py 顶部 |
| 严格 RX 政策（无伪造数据 fallback） | dev_doc/7 |
| LOOCV ensemble test macro-F1 = 0.444（实测） | dev_doc/5 §0.4 |

## 7. 验收标准

1. 打开 HTML 不联网（本机 CDN cache 命中即可；如果无网，Mermaid 也能降级显示）
2. 12 节齐全，TOC sticky 工作
3. 至少 1 个 Mermaid 流程图 + 1 个 SVG 几何 + 5 个 ASCII 示意
4. 所有超参/阈值/常量引用具体 `file.py:line` 格式
5. 表格可读（github-readme 风格，窄边框）
6. `<details>` 折叠默认隐藏但可点开
7. 顶部"基于 2026-07-06 代码复盘"显著
8. §12 已知限制明确写"MIT 免责 + 非医疗设备"
9. 不出现任何"训练复现 0.81 F1"误导（项目实测 0.444）
10. 浏览器内 Ctrl+F 能直接搜到关键概念（"alpha"、"spectrogram"、"smoothstep"）

## 8. 不在范围内（avoid scope creep）

- ❌ 实时数据接入（这次纯静态文档）
- ❌ 一键 reproduce 按钮
- ❌ 任何 React / Vue 重写
- ❌ 多页拆分（保持单 HTML）
- ❌ 用户系统 / 权限
- ❌ 自动同步代码漂移（行号引用是一次性快照）

---

**最后更新**：2026-07-06 by Claude
**依据**：用户 2026-07-06 原话"将本项目利用接收到的 CSI 信息结合什么特征进行训练模型并最后用于跌倒检测的全流程的技术栈整理为一个直观的 html 存放在 dev_doc"
**前置**：8 份 dev_doc + 2 份 HANDOFF（提供溯源材料）
