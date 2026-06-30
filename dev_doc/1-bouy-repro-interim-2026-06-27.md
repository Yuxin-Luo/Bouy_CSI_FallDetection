# Bouy 复现 — 中间决策记录（待复核）

> 本文件是 **头脑风暴阶段** 的中间快照，记录已经和用户确认的关键决策。
> 完整 spec 文档会在所有问题澄清后写成 `2-bouy-repro-spec-2026-06-27.md`。
> 大学生级操作指南会写在 `3-bouy-repro-howto-2026-06-27.md`。
> 状态：**待复核**（用户确认后才会冻结）。

### 命名与编号冲突提示

按用户 2026-06-27 决定，Bouy 子项目 dev_doc 从 1 开始重新编号。
当前 Bouy CLAUDE.md L367-368 推荐的下一批文档（`1-bouy-codebase-walkthrough-...`、`2-bouy-vs-csi-pose-...`）的编号位已被本任务占用，未来撰写时需顺延。
按用户决定，**不修改任何 CLAUDE.md**（parent + Bouy）。

---

## 0. 背景

- 用户核心目标：**复现 Bouy CSI Fall Detection 项目**，最快搭一个**跌倒检测 demo + 实时展示前端**。
- 上游文档：父项目 `dev_doc/4-solution-design-2026-06-26.md`（这是另一个 2 板子方案，**与 Bouy 架构不同**，本文件按 Bouy 路线走）。
- 物理硬件：5 块 ESP32-S3。
- 工作目录：`/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/`（**当前目录**）。

---

## 1. 已确认的决策

| # | 决策项 | 用户答复 | 备注 |
|---|---|---|---|
| D1 | 复现深度 | **Phase A（跑通即可）+ 最简前端** | 不上 Twilio WhatsApp、不上 Pusher、不上 Next.js PWA |
| D2 | 硬件拓扑 | **采用 Bouy 架构：1 TX + 4 RX** | 5 块板：1 块放书架当 TX，4 块放活动区域四角当 RX |
| D3 | 实现路径 | **优先使用 Bouy 现有代码** | 训练管线、collect.py、模型结构都用 Bouy 自带的 |
| D4 | 训练数据 | **只采少量、单一跌倒类即可** | 跳过 LOOCV，目标是 demo 不是 SOTA |
| D5 | ESP32-S3 兼容性 | **用户确认 IDF v6.0 上能编译 CSI** | 参考 `ReferenceCode/Opensourse/esp-csi/` 或 `espectre/` |
| D6 | 操作系统 | **Linux** | flash 脚本串口路径 `/dev/cu.usbserial-*` → `/dev/ttyUSB*` |
| D7 | 跳过项 | Pusher、Twilio、Next.js PWA、多人检测、跨房间验证 | 这些对 demo 都是 over-engineering |
| D8 | 工作流约束 | 所有信息**持续记录**到 `dev_doc/`，方便后续回看 / 修改 |
| D9 | IDF 版本 | **本地装 v6.0**（用户 2026-06-27 选定，不用 Docker） | 决定固件 build 路径 |
| D10 | 模型路径 | **shipped 模型先试 + 采 2-3 段微调** | A 试 shipped → B 微调 |
| D11 | Python 水平 | 熟练 + 已装 Conda + 已有 `dac_dev` 环境 | 教程略过 pip 基础；优先复用 `dac_dev`，不行再新建 |
| D12 | 书架高度 | **1.8m+** ✓ | 符合 Bouy TX 要求 |
| D13 | dev_doc 归属 | **Bouy 子项目文档放 Bouy/dev_doc/，从 1 开始编号；不动 CLAUDE.md** | 路径冲突已澄清 |
| D14 | 跳过项 | Pusher、Twilio、Next.js PWA、多人检测、跨房间验证、Docker | 与 D7 合并 |
| D15 | IDF 版本细化为 | **v6.0.1（latest release）已装，已接入 VSCode 插件** | 2026-06-28 用户确认 |
| D16 | 烧录/编译工具 | **VSCode 图形化界面为主**，CLI 命令作备选 | 2026-06-28 用户确认 |
| D17 | 固件基线（重要，已纠正） | **`csi_send` + `csi_recv`（不是 csi_recv_router）**，直接用 Mycode 版作基线 | 2026-06-28 用户纠正 + 调查，详见 §6 |
| D18 | **Mycode 质量警告（用户提醒）** | `Mycode/get-started/csi_recv` 是用户结合大模型自行修改的代码，**复用前必须先审核**；目前可验证实时接收数据但代码质量未严格保证 | 2026-06-28 用户警告，详见 §6.5 |

---

## 2. 当前默认的范围

### 2.1 硬件

- 1 块 ESP32-S3 → TX（**放书架上，架到肩高以上**——Bouy 要求）
- 4 块 ESP32-S3 → RX（活动区域四角）
- WiFi 信道 6
- USB 串口 921600 波特
- 子载波 192
- 采样率 ~70 Hz

### 2.2 软件栈

- ESP-IDF **v6.0.1**（已装，已接入 VSCode 插件）
- Python 3.12（按 `requirements.txt`，conda 环境 `dac_dev` 复用）
- 跳过 Node.js / Express / Next.js / Pusher / Twilio / Docker

### 2.3 训练管线（沿用 Bouy）+ 固件基线（修订）

**固件基线（2026-06-28 第 2 次修订，用户纠正）**：
- ❌ ~~`csi_recv_router`~~ — 错！该例程用 ESP-NOW mesh 转发，不是 Bouy 的 1 TX + 4 RX 直连 USB 架构
- ✅ **TX**: `ReferenceCode/Mycode/get-started/csi_send/`（174 行，与官方几乎一致）
- ✅ **RX**: `ReferenceCode/Mycode/get-started/csi_recv/`（881 行，已包含 MAC filter + gain control）
  - 比官方 csi_recv（297 行）更接近 Bouy 的需求
  - 已使用 `CONFIG_CSI_SEND_MAC[] = {0x1a,...}`（与 Bouy 一致）
- **需要改 1 处**：把 `CONFIG_LESS_INTERFERENCE_CHANNEL` 从 `11` 改为 `6`（Mycode 默认 11，Bouy 用 6）
- **不需要改 1 处**：target 从 esp32 → esp32s3（VSCode 插件或 `idf.py set-target esp32s3`）

**训练/采集管线（沿用 Bouy）**：
- `collection/collect.py` 跑 4 RX 串口录入（**改 Linux 串口路径** `/dev/ttyUSB*`）
- `labeling/split_fall_labels.py`（如采集了 FALL 类则需要切 FALL_IMPACT + FLOORED）
- `training/train_lstm.py` 和 `training/train_cnn_deep.py` 至少跑一个
- `training/ensemble_predict.py` 做融合
- 部署产物：`model/fall_impact_seq9_ensemble/fall_impact_seq9_ensemble.ts.pt`（已有）
  - **A 阶段不重训，直接用部署模型试**——若在自己房间不工作，再采少量数据微调

### 2.4 实时推理 + 最简前端（**新增，对应 Bouy 没有的简化**）

- PC 端跑 Python，4 RX 串口 + 推理循环
- **最简前端选型**（待用户确认）：
  - 选项 a：**Flask + 单 HTML 页 + JS 自动刷新**（最简单，纯 HTTP 轮询）
  - 选项 b：**Streamlit 单页**（与现有 4-solution 一致）
  - 选项 c：**原生 WebSocket（aiohttp）** 实时性最好但代码多
- 报警触发条件：`FALL_IMPACT > 阈值（0.50）` 连续 N 窗
- 报警动作：前端显示红条 + 终端打印时间戳 + 播放 `asset/audio/alarm.wav`

---

## 3. 已回答的关键问题

| Q | 答案 |
|---|---|
| Q1 IDF 版本 | 当前 v5.x，**愿意加装 v6.0**（推荐装 v6.0） |
| Q2 书架高度 | **1.8m+** ✓ |
| Q3 模型路径 | **shipped + 2-3 段微调**（与 D10 一致）|
| Q4 技术水平 | 熟练 Python/C/C++ + Conda + `dac_dev` 环境已存在 |
| Q5 时间预算 | 用户未明确——按"D1-D7 决定 4-5 天"估算 |

---

## 4. 参考资料（待补充）

- 详见 `dev_doc/0-references-2026-06-27.xml`（待建）—— 待补充的条目：
  - `espressif/esp-csi` 仓库 S3 CSI 例程位置
  - `espectre` S3 适配点
  - Bouy README 的 fall_impact_seq9_ensemble 部署说明

---

## 5. 风险清单（已知）

| 风险 | 影响 | 应对 | 状态 |
|---|---|---|---|
| ~~ESP32-S3 在 IDF v6.0 上 CSI 例子可能 build 不过~~ | ~~阻塞~~ | ~~切到 IDF v5.x S3-stable~~ | ✅ **已解决**：本地 `managed_components/espressif__esp_csi_gain_ctrl/6.0/esp32s3/libesp_csi_gain_ctrl.a` 已存在 |
| 5 块板需要 5 根 USB 数据线 + 1 个 USB Hub | 工程 | 不一定同时插，先 TX + 1 RX 验证，再扩 | ⚠ 待用户准备 |
| shipped model 在新房间效果差 | demo 价值 | 先试 shipped；不行则采 5 段站立 + 5 段跌倒（每段 3-5 min）重新训练 | ⚠ 待验证 |
| collect.py 在 Linux 找不到串口 | 工程 | `csi_io.py` 加 `/dev/ttyUSB*` 路径 | ⚠ 待修改 |
| 单人 / 多人检测 | 暂不做 | 按用户要求跳过，只做"单人跌倒" | ✅ 已决定跳过 |

---

## 6. 关键调查结论（2026-06-28）

### 6.1 `libesp_csi_gain_ctrl.a` 风险排查

**结论**：风险不存在。

**证据**：
1. `ReferenceCode/Mycode/get-started/csi_recv_router/managed_components/espressif__esp_csi_gain_ctrl/` 目录下，**每个 IDF 兼容版本（4.4–6.0）都有 `esp32s3/libesp_csi_gain_ctrl.a`**，包括：
   - `6.0/esp32s3/libesp_csi_gain_ctrl.a`（33228 字节，对应 IDF v6.0.x）
   - `5.5/esp32s3/libesp_csi_gain_ctrl.a`（对应 IDF v5.5）
   - `5.3/esp32s3/libesp_csi_gain_ctrl.a`（Bouy README 钉死的版本）
2. 组件的 `idf_component.yml` 明确列出 `targets: esp32, esp32s3, esp32s2, esp32c3, esp32c5, esp32c6, esp32c61`
3. `Mycode/get-started/csi_recv_router/main/app_main.c` 中：
   - 有 `#include "esp_csi_gain_ctrl.h"`
   - 有 `#if CONFIG_IDF_TARGET_ESP32S3` 条件编译分支
   - 表明源码原生支持 S3
4. Mycode 的 `build/` 目录存在产物，说明此前已经成功 build 过（虽然当前 sdkconfig 是 `esp32`，但只要 `set-target esp32s3` 重新 build 即可）

### 6.2 Mycode `csi_recv` vs `csi_recv_router` 关键差异（用户纠正）

用户 2026-06-28 明确指出：**Bouy 的正确基线是 `csi_send` + `csi_recv`，不是 `csi_recv_router`**。

| 维度 | `csi_recv` (Mycode) | `csi_recv_router` (Mycode) | Bouy 的实际做法 |
|---|---|---|---|
| 用途 | 单 RX 直连 USB 串口 | **多板 mesh 通过 ESP-NOW 转发** | 单 RX 直连 USB 串口 |
| 包含 `esp_now.h` | ❌ | ✅ | ❌ |
| 包含 `esp_csi_gain_ctrl.h` | ✅ | ✅ | ❌ |
| MAC filter | ✅（`memcmp(info->mac, ctx, 6)`） | ✅ | ✅ |
| `CONFIG_CSI_SEND_MAC[]` | `{0x1a,...}` | `{0x1a,...}` | `{0x1a,...}` |
| 信道 | 11 | 11 | **6** |
| 代码行数 | 881 | ~400 | ~180 |
| 与 Bouy 匹配度 | ✅ 高 | ❌ 不匹配 | — |

**结论**：
- **用 `Mycode/csi_recv` + `Mycode/csi_send`**
- Mycode 的 csi_recv 实际上**比官方 csi_recv 更接近 Bouy**（因为已经包含 MAC filter + gain control 这两个 Bouy 必加项）
- 不需要再拷 Bouy 的 `firmware_patches/`——Mycode 已经包含等效实现
- 唯一额外改：信道 11 → 6

### 6.3 父项目 CLAUDE.md 关于 Mycode 的警告说明

父 CLAUDE.md 说：`Mycode/` 已知有 BUG，不直接复用。
- **BUG 集中在 `Mycode/fallRecog/`**（训练/识别代码）
- **`Mycode/get-started/csi_recv` 和 `csi_send` 是 ESP32 固件**，按 black-box 用即可，不改它们的 C 代码
- 这些固件已经在用户本地 build 过（build/ 目录存在）

### 6.4 路径含义

| 原计划 | 实际情况 | 影响 |
|---|---|---|
| 克隆 `esp-csi` 仓库 + 改 Bouy `csi_send/csi_recv` 模板 | **直接复用 `Mycode/get-started/csi_send` + `csi_recv` 作基线** | 工作量减半，Day1 即可上手 |
| 担心 `gain_ctrl.a` 缺失 | 已缓存可直接用 | **0 风险** |
| 需要拷 Bouy MAC filter 补丁 | Mycode 已包含等效代码 | **无需拷贝** |

### 6.5 Mycode `csi_recv` 质量警告与对策（2026-06-28 用户新增）

**用户原话**：
> Mycode/get-started/csi_recv 的代码目前可能是存在问题的（我结合大模型自行修改）虽然目前已经能验证可以实时接收数据，**复用前可能需要提前审核一下**

**警告含义**：
1. Mycode/csi_recv 是用户**自行用大模型辅助**修改的版本（881 行 vs 官方 297 行）
2. **能跑**（实时接收数据 OK）
3. **未严格审核**（可能有 bug、逻辑错误、过时 API 调用、不必要的复杂度）

**风险**：
- 跑起来没问题 ≠ 代码没问题
- 可能隐藏：资源泄漏、内存越界、CSI 解析错误、未处理的边界 case
- 我们要做的是 5 天跑通 demo，**没时间深入调试一个大模型生成的固件**

**3 种对策对比**：

| 对策 | 工作量 | 风险 | 推荐 |
|---|---|---|---|
| **A. 用官方 `csi_recv` + 拷 Bouy 的 MAC filter 补丁** | 30 min | 低（两边都是成熟代码） | ⭐⭐⭐⭐⭐ |
| **B. 用 Mycode/csi_recv，先做 Code Review** | 2-3 hour（881 行逐行读）| 中 | ⭐⭐⭐ |
| **C. 直接用 Mycode/csi_recv 不审核** | 0 | 高 | ❌ 不推荐 |

**建议**：先用 **对策 A**（官方 + Bouy patches）作为基线——这两份代码都是 Espressif 官方/HackDavis 获奖项目的成熟产物，没有"大模型辅助生成"的未知风险。如果 A 在 S3 上有兼容问题，再回头用 Mycode 的特定修改（比如它的 gain control 实现可能就是更稳的）。

**核对清单（A 方案要做的具体步骤）**：
1. 拷贝 `ReferenceCode/Opensourse/esp-csi/examples/get-started/csi_recv/` 到 `src/firmware/csi_recv/`
2. 拷贝 `ReferenceCode/Opensourse/esp-csi/examples/get-started/csi_send/` 到 `src/firmware/csi_send/`
3. 拷贝 `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/firmware/firmware_patches/csi_recv_app_main.c` 的内容覆盖到我们的 `csi_recv/main/app_main.c`（带来 MAC filter）
4. 同样覆盖 `csi_send/main/app_main.c`（带来固定 MAC `1a:00:00:00:00:00`）
5. 把 `CONFIG_LESS_INTERFERENCE_CHANNEL` 从 `11` 改为 `6`
6. VSCode 插件 `set-target esp32s3` + build + 烧录

### 6.3 父项目 CLAUDE.md 关于 Mycode 的警告说明（保留）

父 CLAUDE.md 说：`Mycode/` 已知有 BUG，不直接复用。
- **BUG 集中在 `Mycode/fallRecog/`**（训练/识别代码）
- **`Mycode/get-started/csi_recv` 和 `csi_send` 是 ESP32 固件**——按 §6.5 的建议**不再 black-box 用**，改用官方 + Bouy patches
- 这些固件已经在用户本地 build 过（build/ 目录存在），仅作参考

---

**最后更新**：2026-06-28 by Claude
**状态**：⏸ 待复核（对策选 A + spec 撰写待续）