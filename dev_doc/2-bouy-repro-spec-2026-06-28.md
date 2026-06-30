# Bouy 复现 — 最终 Spec（2026-06-28）

> **本文件是项目执行的契约**。所有决策已与用户确认，可直接进入 writing-plans 阶段。
> 用户级操作指南另见 `3-bouy-repro-howto-2026-06-28.md`。
> 状态：⏸ 待复核（writing-plans 之前最后一道关）

---

## 0. 项目一句话

**用 5 块 ESP32-S3（1 TX + 4 RX，Bouy 架构），5 天内复现 Bouy CSI Fall Detection 的核心能力：在浏览器里看到实时 CSI 波形，跌倒发生时报警条亮起、报警音响起。**

跳过 Bouy 的 Twilio WhatsApp / Pusher / Next.js PWA / 多人检测 / 跨房间验证——这些对 demo 是 over-engineering。

---

## 1. 已确认的决策表（D1–D18）

| # | 决策项 | 取值 | 备注 |
|---|---|---|---|
| **D1** | 复现深度 | Phase A（跑通即可）+ 最简前端 | 不上 Twilio/Pusher/Next.js PWA |
| **D2** | 硬件拓扑 | **Bouy 架构：1 TX + 4 RX** | 5 块板：1 书架（TX）+ 4 角（RX） |
| **D3** | 代码复用 | 优先用 Bouy 训练/采集管线 + 官方 esp-csi 固件 | 不用 Mycode 的 csi_recv（质量风险）|
| **D4** | 训练数据量 | 采 **2 段**（standing 3 min + fall 5-10 次 3 min）；跳过 LOOCV | shipped 失败时用 |
| **D5** | ESP32-S3 兼容性 | IDF v6.0.1 已装且官方支持 S3 | 风险已消除 |
| **D6** | 操作系统 | Linux | flash 脚本串口路径改 `/dev/ttyUSB*` |
| **D7** | 跳过项 | Pusher、Twilio、Next.js PWA、多人检测、跨房间验证、Docker | — |
| **D8** | 工作流约束 | 持续记录到 dev_doc/ | 已记录 |
| **D9** | IDF 安装 | **本地装 v6.0.1**，不用 Docker | 与 VSCode 插件配合最佳 |
| **D10** | 模型路径 | **Day 3 上午先试 shipped**；prob 不响应/误报多 → Day 3 下午采数据 + Day 4 微调；prob 表现 OK → 跳过微调、直接进 Day 5 前端 | 条件路径，不是固定全做 |
| **D11** | Python 水平 | 熟练 + Conda + `dac_dev` 已存在 | 教程略过 pip 基础 |
| **D12** | 书架高度 | 1.8m+ | 符合 Bouy TX 要求 |
| **D13** | dev_doc 归属 | Bouy 子项目放 Bouy/dev_doc/，从 1 开始编号；不动 CLAUDE.md | 已澄清 |
| **D14** | 跳过项合并 | 与 D7 一致 | — |
| **D15** | IDF 实际版本 | v6.0.1（latest release），已装 | 用户确认 |
| **D16** | 烧录/编译工具 | VSCode 图形化为主，CLI 作备选 | 用户确认 |
| **D17** | 固件基线 | **官方 `csi_send` + `csi_recv` + Bouy patches** | 不是 `csi_recv_router` |
| **D18** | Mycode 质量警告 | `Mycode/csi_recv` 大模型生成未审，**不用** | 用户 2026-06-28 警告 |
| **D19** | USB 距离策略（用户 2026-06-28） | **先用短 USB 线验证流程**；跑通后再换长线；长线不行再考虑改 UDP | 用户洞察：作者用串口是为 4 RX 同步更稳 |

---

## 2. 架构概览

```
┌──────────┐  1a:00:00:00:00:00  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ ESP32-S3 │  WiFi 信道 6 HT40   │ ESP32-S3 │ │ ESP32-S3 │ │ ESP32-S3 │ │ ESP32-S3 │
│  TX      │  null-data 持续注入  │ RX #1    │ │ RX #2    │ │ RX #3    │ │ RX #4    │
│ 书架     │  192 子载波 ~70Hz    │ 角 1     │ │ 角 2     │ │ 角 3     │ │ 角 4     │
│ 1.8m+    │                     │ USB → PC │ │ USB → PC │ │ USB → PC │ │ USB → PC │
└──────────┘                     └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
                                      │ /dev/ttyUSB0  │ /dev/ttyUSB1  │ /dev/ttyUSB2  │ /dev/ttyUSB3
                                      ▼             ▼             ▼             ▼
                              ┌────────────────────────────────────────────────┐
                              │ PC (Linux, conda env dac_dev)                   │
                              │ ┌──────────────────────────────────────────┐  │
                              │ │ csi_io.py: 4 串口聚合 → 共享 ring buffer  │  │
                              │ └──────────────┬───────────────────────────┘  │
                              │                ▼                              │
                              │ ┌──────────────────────────────────────────┐  │
                              │ │ infer_loop.py: 推理主循环                 │  │
                              │ │   - 9 窗 × 6s 输入准备                    │  │
                              │ │   - fall_impact_seq9_ensemble.ts.pt       │  │
                              │ │   - 输出 (prob, alarm) 每秒               │  │
                              │ └──────────────┬───────────────────────────┘  │
                              │                ▼                              │
                              │ ┌──────────────────────────────────────────┐  │
                              │ │ Flask app.py: /api/status 每秒被拉取      │  │
                              │ └──────────────┬───────────────────────────┘  │
                              │                ▼                              │
                              │ ┌──────────────────────────────────────────┐  │
                              │ │ index.html: 4 RX 实时波形 + 概率 + 报警条 │  │
                              │ │ 报警时: 全屏红 + 报警音                  │  │
                              │ └──────────────────────────────────────────┘  │
                              └────────────────────────────────────────────────┘
```

---

## 3. 硬件准备（验收前必做）

| 编号 | 角色 | 位置 | 备注 |
|---|---|---|---|
| #1 | TX | 书架 1.8m+ | 书架顶层中心位置 |
| #2-5 | RX ×4 | 活动区域四角 | USB 数据线连电脑（或 USB Hub）|
| USB 数据线 | — | — | **5 根能传数据的线**（纯充电线不行）|
| USB Hub | — | — | 1 个 4 口（推荐带电源的）|

**验收**：5 块板按位置摆好、电源接好、串口线连好。

---

## 4. 软件栈

| 项 | 版本/选择 | 安装方式 |
|---|---|---|
| ESP-IDF | v6.0.1（已装） | VSCode 插件 + CLI 备选 |
| Python | 3.12 | conda env `dac_dev`（已存在）|
| esptool | latest | `pip install esptool` |
| PyTorch | ≥ 2.2 | `pip install torch` |
| Flask | ≥ 3.0 | `pip install flask` |
| pyserial | ≥ 3.5 | `pip install pyserial` |
| matplotlib | ≥ 3.7 | `pip install matplotlib` |

**跳过**：Node.js / Express / Next.js / Pusher / Twilio / Docker

---

## 5. 目录结构（最终）

```
ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/
├── CLAUDE.md                                # 不动
├── README.md                                # 不动
├── LICENSE                                  # 不动
│
├── src/                                     # 【新建】自主开发代码
│   ├── firmware/
│   │   ├── csi_send/                        # 拷官方 esp-csi/csi_send → 覆盖 Bouy patch
│   │   ├── csi_recv/                        # 拷官方 esp-csi/csi_recv → 覆盖 Bouy patch
│   │   ├── flash_notes.md                   # 5 板烧录顺序 + 注意事项
│   │   └── target_s3_notes.md               # set-target esp32s3 + 验证清单
│   ├── pc_tools/
│   │   ├── receiver/
│   │   │   ├── csi_io.py                    # 拷自 Bouy/collection/csi_io.py（Linux 路径改 /dev/ttyUSB*）
│   │   │   └── capture_multi.py             # 拷自 Bouy/collection/capture_multi.py（4 RX 无标签录入）
│   │   ├── inference/
│   │   │   ├── ensemble_loader.py           # 加载 fall_impact_seq9_ensemble.ts.pt
│   │   │   └── infer_loop.py                # 主循环：CSI → 模型 → (prob, alarm)
│   │   ├── training/                        # 【仅当 shipped 不工作时启用】见 D10
│   │   │   ├── finetune_lstm.py             # 改自 Bouy train_lstm.py
│   │   │   ├── finetune_cnn.py              # 改自 Bouy train_cnn_deep.py
│   │   │   └── finetune_ensemble.py         # 改自 Bouy ensemble_predict.py（alpha 融合）
│   │   └── frontend/
│   │       ├── app.py                       # Flask（参考 Mycode/fallRecog/app.py）
│   │       ├── templates/index.html         # 参考 Mycode/fallRecog/templates/
│   │       └── static/{style.css, app.js}
│   └── data/                                # 【gitignore】
│       ├── raw/
│       ├── labeled/
│       └── processed/
│
├── asset/
│   └── audio/alarm.wav                      # 从 Mycode/fallRecog/alarm.wav 拷
│
├── dev_doc/
│   ├── 1-bouy-repro-interim-2026-06-27.md   # 头脑风暴记录（已写）
│   ├── 2-bouy-repro-spec-2026-06-28.md      # 本文件
│   ├── 3-bouy-repro-howto-2026-06-28.md     # 【下一步写】大学生级操作指南
│   └── 0-references-2026-06-28.xml          # 【下一步写】参考资料表
│
├── # 以下沿用 Bouy 自带的（不动，作为参考/复用源）
├── fall-detection-training/                 # 仅复用 Python 部分
├── apps/                                    # 不部署
└── FontendInspo/                            # 不动
```

---

## 6. 实施步骤（5 天时间表）

### Day 1：固件准备 + 单板验证

| 时间 | 任务 | 验收 |
|---|---|---|
| 上午 | 创建 `src/firmware/{csi_send,csi_recv}/`，从官方 + Bouy patch 合并 | 文件就绪 |
| 上午 | 改 `CONFIG_LESS_INTERFERENCE_CHANNEL` 从 11 → 6 | 编译参数正确 |
| 上午 | VSCode 插件打开 csi_recv 项目，set-target esp32s3，build | build 成功 |
| 下午 | 烧 1 块 RX 板，串口看 CSI 数据 | 串口有 JSON 输出 |
| 下午 | 烧 1 块 TX 板（临时先不接），验证 TX 工作 | TX 板串口无错 |

### Day 2：5 板全烧 + 数据采集验证

| 时间 | 任务 | 验收 |
|---|---|---|
| 上午 | 烧剩下 3 块 RX 板（一次一块）| 4 块 RX 都烧完 |
| 上午 | TX 板固定在书架 1.8m+，独立供电 | 物理位置 OK |
| **上午** | **D19 Stage 1**: 4 RX 先用 0.5-1m 短 USB 线全连到 PC，验证串口都通 | 4 个 `/dev/ttyUSB*` 都识别 |
| 下午 | 拷 `Bouy/collection/csi_io.py` 到 `src/pc_tools/receiver/`，改 Linux 串口路径 | 单机能跑 |
| 下午 | 拷 `Bouy/collection/capture_multi.py`，4 板同时录 1 段 standing 30s | `data/raw/test_30s.npz` 生成 |
| **下午** | **D19 Stage 2**: 把 4 RX 放到实际"四角"位置，看 USB 线长度是否够 | 4 RX 都能稳定读数据 |

### Day 3：推理测试 + 数据采集（**条件分支**）

**先试 shipped（30 min）：**

| 时间 | 任务 | 验收 |
|---|---|---|
| 上午 | 写 `ensemble_loader.py` + `infer_loop.py` 加载 shipped 模型 | 终端每秒打印 `prob=0.XX` |
| 上午 | 在 PC 旁走动，看 prob 是否响应 | prob 有波动 |
| 上午 | 模拟一次跌倒，看 prob 是否跳到 > 0.5 | 看到报警触发 |

**判定（D10 条件路径）：**

| shipped 表现 | 后续路径 |
|---|---|
| ✅ **prob 对跌倒响应明显（> 0.5）+ 无误报** | 跳过 Day 4 微调，**直接进 Day 5** |
| ⚠ **prob 有响应但不剧烈（0.3-0.5）** | 走 Day 4 微调 |
| ❌ **prob 不响应（< 0.2）或一直报警** | 走 Day 4 微调 + 调阈值 |

**如需采数据（Day 3 下午）：**

| 时间 | 任务 | 验收 |
|---|---|---|
| 下午 | 采 1 段 standing 3 min + 1 段 fall（5-10 次重复）3 min | `dataset_v2_high_tx/session_01/` |
| 下午 | 跑 `split_fall_labels.py` | labels_v2.json 生成 |

### Day 4：微调 + 评估（**仅当 Day 3 shipped 不达标**）

| 时间 | 任务 | 验收 |
|---|---|---|
| 上午 | 跑 `finetune_lstm.py`（仅 LSTM 分支）| `checkpoints/lstm.pt` |
| 上午 | 跑 `finetune_cnn.py`（仅 CNN 分支）| `checkpoints/cnn.pt` |
| 上午 | 跑 `finetune_ensemble.py` 融合 LSTM+CNN（Transformer 用 shipped 内的）| ensemble alpha 权重 |
| 下午 | 跑 `eval_seq9_ensemble.py` 评估阈值 | window-F1、event-F1 数字 |
| 下午 | 把微调后的 ensemble 替换进 `infer_loop.py` | 终端实时打印新概率 |

**说明**：Bouy 的 ensemble 包含 CNN + LSTM + Transformer 3 分支。A 阶段 Transformer 不重训（继续用 shipped 模型里嵌入的版本），仅微调 LSTM + CNN 两个分支。

### Day 5：前端 + 真实跌倒验证

| 时间 | 任务 | 验收 |
|---|---|---|
| 上午 | 写 Flask `app.py`（参考 Mycode/fallRecog/app.py）| 浏览器打开 5000 端口能看到 |
| 上午 | 写 `index.html` + JS 拉 `/api/status` | 实时 CSI 波形 + 概率数字 |
| 下午 | 接报警：prob > 阈值连续 N 窗 → 全屏红 + 报警音 | 真实跌倒时报警触发 |
| 下午 | 写 dev_doc 收尾，标记完成 | `4-bouy-repro-completion-2026-XX-XX.md` |

---

## 7. 验收标准（A 阶段，硬性）

| 项 | 标准 | 是否硬性 |
|---|---|---|
| **5 板物理位置** | TX 书架 1.8m+，RX 4 角 | ✅ |
| **5 板烧录成功** | TX ×1 + RX ×4 都能开机 | ✅ |
| **CSI 数据流通** | 4 块 RX 都能从 USB 串口读到 CSI 数据 | ✅ |
| **模型加载** | shipped 或微调后的 `.pt` 能加载并推理 | ✅ |
| **实时推理** | 终端每秒输出 `prob=0.XX`，跌倒时概率明显升高 | ✅ |
| **前端可视化** | 浏览器打开 `localhost:5000` 看到 4 RX 实时波形 + 概率 | ✅ |
| **报警触发** | 真实跌倒时报警条 + 报警音 | ✅ |
| **F1 ≥ 0.7** | 在自采数据上 F1 ≥ 0.7（仅当走微调路径时考核）| ⚠ 软目标（不强求）|

---

## 8. 风险与回退

| 风险 | 影响 | 回退方案 |
|---|---|---|
| 官方 `csi_recv` 在 S3 上有 API 不兼容 | Day 1 阻塞 | 退到对策 D：从 Mycode 抽已验证可用的 S3 代码片段 |
| shipped 模型在用户房间 F1 < 0.5 | demo 价值低 | 走微调路径（D4）；不行就降阈值到 0.30 |
| 微调后 F1 仍 < 0.7 | 报警频繁/从不报 | 改用"振幅方差阈值法"兜底 |
| 5 块板 USB 数据线不全 | 缺线 | 1 次只烧 1 块，不同时跑 4 RX |
| shipped 模型加载失败（TorchScript 版本）| 推理阻塞 | 重新导出 / 用源 .pt 重新 trace |
| **USB 距离不够（房间 > 5×5m）** | 4 RX 无法同时连 PC | **D19 分阶段策略**：先短 USB 跑通流程 → 跑通后再换 USB 主动延长线 → 还不行改 UDP（破坏 Bouy 架构，需 +1-2 天改固件）|

### 8.1 USB 距离策略详解（D19）

**为什么 Bouy 选串口不选 UDP**（用户洞察）：
- 串口天然按到达顺序记录，4 RX 的 CSI 帧有共同时间戳基准 → **更容易做时间同步**
- UDP 是无连接协议，4 RX 的包到达 PC 顺序可能乱 → 需要额外做时间戳对齐逻辑
- CSI 数据量小（每帧 ~500 字节 × 70 Hz = 35 KB/s/板），USB 2.0 480 Mbps 完全够用

**分阶段实测策略**：

| 阶段 | 用什么 | 验收 |
|---|---|---|
| **Stage 1** | 5 块板附近（≤ 1m USB 线），验证 4 RX 数据流同步 | Day 2 下午 |
| **Stage 2** | 4 RX 放到实际"四角 + TX 书架"位置，看短 USB 线是否够 | Day 2 结束 |
| **Stage 3**（如需要）| 买 USB 主动延长线（5-10m），逐根换上 | Day 3 上午 |
| **Stage 4**（兜底）| 改 RX 固件加 UDP 发送、PC 端改 socket 接收 | +1-2 天 |

**为什么不一上来买长 USB 线**：
- 长线容易出信号完整性问题（丢包、CRC 错）
- 先用短线验证逻辑，再换长线排除环境干扰
- Stage 4 的 UDP 改动量较大（违反 D2 架构），**只在 Stage 1-3 都失败时启用**

---

## 9. 与 Bouy 原生对比（明确差异）

| 维度 | Bouy 原生 | 本项目（A 阶段）| 备注 |
|---|---|---|---|
| ESP32 芯片 | 原始 ESP32 | ESP32-S3 | D15 |
| 拓扑 | 1 TX + 4 RX | 同 | D2 |
| 子载波 | 192 | 192 | — |
| 采样率 | ~70 Hz | ~70 Hz | — |
| 信道 | 6 | 6 | — |
| 训练数据 | 7 会话 + CSI-HAR 适配 | 2 段（standing + fall），仅在 shipped 不达标时采 | D4 |
| 模型 | ensemble (CNN+LSTM+Transformer) | 同（shipped 先试）| D10 |
| 阈值 | 0.50 | 0.50（先），后续调 | — |
| 后端 | Express + SQLite | 跳过 | D7 |
| 前端 | Next.js PWA | Flask + 单 HTML | 简化 |
| 实时通道 | Pusher | HTTP 轮询 | 简化 |
| 告警通道 | Twilio WhatsApp | 浏览器 + 音频 | 简化 |
| 状态机 T1/T2/T3 | ✅ | ❌ 跳过 | 简化 |
| 多人检测 | ✅ | ❌ 跳过 | D7 |
| 跨房间验证 | ✅（7 会话 LOOCV）| ❌ 跳过 | D7 |

---

## 10. 与 writing-plans 的接口

后续 `writing-plans` 技能应基于本 spec 输出**分 5 天的实施计划**，每 Day 包含：
- 具体任务清单（按文件级别）
- 每任务的预计耗时
- 验证点（如何知道这一步成功了）
- 失败时的回退步骤

**避免**：
- 不要重写本 spec 已确定的内容
- 不要引入新的架构选择
- 不要扩展到 B 阶段范围

---

## 11. 参考资料

| id | 资料 | 类型 | 用途 |
|---|---|---|---|
| r049 | `ReferenceCode/Opensourse/esp-csi/examples/get-started/csi_send` | repo | **官方** TX 固件基线 |
| r050 | `ReferenceCode/Opensourse/esp-csi/examples/get-started/csi_recv` | repo | **官方** RX 固件基线 |
| r051 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/firmware/firmware_patches/csi_send_app_main.c` | file | Bouy TX 补丁（固定 MAC）|
| r052 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/firmware/firmware_patches/csi_recv_app_main.c` | file | Bouy RX 补丁（MAC filter + 信道 6）|
| r053 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/collection/collect.py` | file | 4 RX 串口录入（参考，Linux 路径要改）|
| r054 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/collection/csi_io.py` | file | 多端口串口读取（Linux 路径要改）|
| r055 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/training/train_lstm.py` | file | LSTM 训练（finetune 模板）|
| r056 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/training/train_cnn_deep.py` | file | CNN 训练（finetune 模板）|
| r057 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/training/ensemble_predict.py` | file | 融合（finetune 模板）|
| r058 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/evaluation/eval_seq9_ensemble.py` | file | 评估脚本（直接复用）|
| r059 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/model/fall_impact_seq9_ensemble/fall_impact_seq9_ensemble.ts.pt` | model | shipped TorchScript 模型 |
| r060 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/model/fall_impact_seq9_ensemble/config.json` | config | shipped 模型配置（阈值、shape）|
| r061 | `ReferenceCode/Mycode/fallRecog/app.py` | file | 前端 Flask 参考（246 行，结构清晰）|
| r062 | `ReferenceCode/Mycode/fallRecog/templates/index.html` | file | 前端 HTML 参考 |
| r063 | `ReferenceCode/Mycode/fallRecog/alarm.wav` | file | 报警音（直接复用）|

**XML 登记**：详见 `0-references-2026-06-28.xml`（下一步建）。

---

**最后更新**：2026-06-28 by Claude
**状态**：⏸ 待复核 → 通过后进入 `writing-plans`