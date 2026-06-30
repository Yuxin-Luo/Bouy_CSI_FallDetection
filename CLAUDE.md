# CLAUDE.md — Bouy (CSI Fall Detection) 行为规范

> 本目录是开源参考项目 **Bouy -- CSI Fall Detection**（HackDavis 黑客松获奖项目，基于 WiFi CSI 的无摄像头/无穿戴跌倒检测 + 实时告警平台）。
> 本文件定义 Claude 在本目录下工作的行为边界。
> 用户拥有最终决定权，Claude 不得违背用户明示要求。

---

## 0. 第一性原理（最重要）

**从原始需求和问题本质出发，不从惯例或模板出发。**

做任何决策前，必须能回答"为什么"。如果一个动作、推荐、参数没有清晰的"为什么"，立刻停下澄清，而不是用套话敷衍。

Bouy 的"为什么"清单（每次改代码前先对一遍）：

- 为什么要 **1 TX + 4 RX** 而不是更多？因为单次会话脚本化采集成本高，4 RX 已足够画等高线图、训练集外推到单房间尺度
- 为什么要 **ensemble**（CNN + LSTM + Transformer）？因为三模型对不同时间尺度敏感，融合比单模型更鲁棒（窗口 F1 0.81，事件 F1 0.90）
- 为什么要 **TorchScript** 而非 ONNX？TorchScript 自带 Pythonic 控制流，导出 CI/CD 不引入额外依赖
- 为什么要 **T1→T2→T3 三段式状态机**？因为先问被监护人、再问护理人、最后升级，符合照护伦理；同阈值超时但优先级不同
- 为什么要 **9 帧堆叠 × 6s 窗口**？9×6=14s 感受野正好覆盖跌倒全程（站立→失稳→冲击→倒地）+ 落地后的缓冲；单窗口 6s 太短看不出"事件"，更短则触发噪声压不住

---

## 1. 项目定位与诚实声明

| 字段 | 内容 |
|---|---|
| **项目名** | Bouy -- CSI Fall Detection |
| **一句话** | 基于 WiFi CSI 的实时跌倒检测平台：无摄像头/无穿戴，检测到跌倒后通过仪表盘 + WhatsApp 告警护理人 |
| **诞生背景** | HackDavis 黑客松（MIT License） |
| **硬件** | 1 块 ESP32 TX（架在肩高以上） + 4 块 ESP32 RX（房间四角）；WiFi 信道 6、921600 波特率、192 子载波、约 70 Hz |
| **核心创新** | 把"CSI → 跌倒事件"做成完整产品闭环：硬件 + 训练管线 + 实时推理 + 事故状态机 + 双向告警（SMS/WhatsApp） + 仪表盘 |
| **训练范式** | 7 次脚本化会话 + LOOCV；CNN 频谱图 + LSTM + Transformer 集成 → TorchScript 部署 |
| **输出** | 后端事件 → Twilio WhatsApp + Pusher 实时推送 → Next.js PWA 仪表盘 |

### 1.1 Honest scope（必须承认的局限）

- 训练集**仅 7 次会话**，LOOCV 在单房间同受试者下拿到 0.90 F1；**未经跨房间、跨受试者验证**
- 模型阈值 `0.50` 由单次 held-out 会话选定，**不能直接套用**
- 模型针对 **FALL_IMPACT** 单一二分类；站/躺姿态、活体确认、CSI 静止检测均**未做**
- T1/T2/T3 计时为工程经验值，**无临床证据支持**
- **这不是验证过的医疗或安全设备**；MIT 许可证免责

任何对模型阈值、状态机计时、判定窗口的调整都必须**先**回到 LOOCV + held-out 会话复现基线指标，再考虑外推。

---

## 2. 4 个子系统（目录树视角）

```
① apps/web/            Next.js 16 App Router PWA（Vercel 部署）
                        - Bouy Care:   被监护人端  /household/[code]/at-risk
                        - Bouy Dashboard:  护理人端  /household/[code]/contact
                        - 实时通道: Pusher Channels
② apps/server/         Express + better-sqlite3 后端（Railway 部署）
                        - src/state-machine.ts: 事故生命周期 + T1/T2/T3 进程内计时器
                        - src/routes/incidents.ts: 跌倒接收、用户响应、护理人确认、911 升级
                        - src/routes/households.ts, sensors.ts, devices.ts
                        - WhatsApp: Twilio
③ fall-detection-training/  CSI 训练与推理（Python）
                        - firmware/    ESP32 csi_send / csi_recv 源码 + 烧录脚本
                        - collection/  多 RX 串口录制 + matplotlib 标注 UI
                        - labeling/    FALL → FALL_IMPACT + FLOORED 切分
                        - training/    LSTM + CNN + ensemble
                        - evaluation/  LOOCV + 集成评估 + 类可分性
                        - model/       TorchScript 部署权重 + config.json
                        - external_data_adapter/  CSI-HAR 公共数据集适配
④ FontendInspo/         设计参考组件（仅参考，不直接使用）
                        Hackathon_Davis Hacks_*/  Build Prompt + Design Canvas（过程文档，保留）
```

数据流：**4 RX ESP32 → 串口 → collection → labels → LSTM+CNN → ensemble (TorchScript) → 设备端实时推理 → state-machine → Twilio + Pusher → PWA**

---

## 3. 关键设计决策（决策可追溯）

| 决策 | 依据 |
|---|---|
| **1 TX + 4 RX 拓扑** | 单房间多径覆盖 + 采集成本可控；4 RX 足够画等高线热图 |
| **WiFi 信道 6 + 192 子载波** | ESP32 CSI Tool 默认；信道 6 在 2.4GHz 中段，多径稳定 |
| **9 帧 × 6s 窗口 = 14s 感受野** | 单次跌倒完整过程（站立→失稳→冲击→倒地）+ 落地缓冲；窗口过短则噪声压不住 |
| **Ensemble：CNN 频谱 + LSTM + Transformer** | 三模型对不同时间尺度敏感，融合鲁棒性 > 单模型；窗口 F1 0.81，事件 F1 0.90 |
| **TorchScript 部署（而非 ONNX）** | 自带 Pythonic 控制流；导出链路短、CI/CD 不引入额外依赖 |
| **LOOCV 而非 k-fold** | 数据少（7 会话）+ 时序强相关，跨会话验证才反映真实泛化 |
| **三段状态机 T1→T2→T3** | 被监护人优先 → 护理人 → 911，符合照护伦理 |
| **Pusher Channels 实时推送** | WebSocket 长连接托管，免自建；与 Vercel Serverless 兼容 |
| **Twilio WhatsApp 而非 SMS** | 海外用户更普及；模板消息审核简单；MIT 项目避免电信合规成本 |
| **better-sqlite3 而非 Postgres** | 单进程内嵌，零运维；适合中小流量 SaaS demo |
| **CSI-HAR 外部数据适配器** | Nexmon-on-Pi 90Hz×52 子载波 → 适配到 4RX×192 子载波 70Hz，弥补自有数据量不足 |

---

## 4. 目录结构（Bouy 实际布局）

```
Bouy_CSI_FallDetection/
├── README.md                                ← 项目总览
├── CLAUDE.md                                ← 本文件
├── LICENSE                                  ← MIT
├── package.json                             ← 根 npm workspaces
├── package-lock.json
├── .env.example                             ← 环境变量模板
│
├── apps/
│   ├── server/                              ← Express + SQLite 后端（Railway）
│   │   ├── src/
│   │   │   ├── state-machine.ts             ← 事故生命周期（核心）
│   │   │   └── routes/
│   │   │       ├── incidents.ts             ← 跌倒入口 + 响应/确认/911
│   │   │       ├── households.ts            ← 家庭 + 护理人 + 暂停监控
│   │   │       ├── sensors.ts               ← CSI 板上行遥测
│   │   │       └── devices.ts               ← 设备状态 + 心跳
│   │   ├── railway.toml                     ← Railway 部署配置
│   │   └── vercel.json
│   └── web/                                 ← Next.js PWA 前端（Vercel）
│       ├── app/                             ← App Router
│       ├── lib/
│       ├── public/
│       ├── next.config.ts
│       ├── AGENTS.md                        ← Next.js 16 特殊规则
│       └── CLAUDE.md                        ← 仅一行 @AGENTS.md
│
├── fall-detection-training/                 ← 训练管线（Python 3.12）
│   ├── README.md                            ← 训练管线详细说明
│   ├── firmware/                            ← ESP32 csi_send / csi_recv
│   │   ├── firmware_patches/
│   │   └── flash_tx.sh / flash_rx.sh
│   ├── collection/                          ← 录制脚本
│   │   ├── collect.py                       ← 4 RX + matplotlib 标注
│   │   ├── record_v2.sh / delete_v2.sh
│   │   ├── capture_multi.py                 ← 无标签多 RX 抓包
│   │   ├── check_boards.py                  ← 串口健康检查
│   │   └── csi_io.py                        ← 多端口串口读取
│   ├── labeling/
│   │   └── split_fall_labels.py             ← FALL → FALL_IMPACT + FLOORED
│   ├── training/
│   │   ├── train_lstm.py                    ← 16 特征时序 LSTM
│   │   ├── train_cnn_deep.py                ← 频谱图 2D CNN
│   │   ├── ensemble_predict.py              ← alpha 加权融合 + per-class report
│   │   └── csi_io.py
│   ├── evaluation/
│   │   ├── loocv_eval.py                    ← LOOCV 主评估
│   │   ├── eval_seq9_ensemble.py            ← 部署模型 window/event 评估
│   │   └── class_separability.py            ← Cohen's d 类可分性
│   ├── model/fall_impact_seq9_ensemble/     ← TorchScript 部署产物
│   │   ├── fall_impact_seq9_ensemble.ts.pt  ← 主模型
│   │   ├── config.json                      ← 阈值 + 后处理 + 输入 shape
│   │   └── *.pt                             ← LSTM / Transformer 源权重
│   └── external_data_adapter/
│       └── csi_har_adapter.py               ← CSI-HAR 公共数据集适配
│
├── FontendInspo/                            ← 设计参考组件（不直接复用）
└── Hackathon_Davis Hacks_ CSI Fall Detection Project/   ← 过程文档（保留）
    ├── Buoy - Build Prompt.md
    ├── .design-canvas.state.json
    └── uploads/frontend_design.md
```

---

## 5. 关键文件速查

| 想找什么 | 看哪里 |
|---|---|
| 系统总览 / 部署 | `README.md` |
| 训练管线详细说明 | `fall-detection-training/README.md` |
| 事故状态机（T1/T2/T3 计时） | `apps/server/src/state-machine.ts` |
| 跌倒事件入口 / 响应 / 911 | `apps/server/src/routes/incidents.ts` |
| 家庭 + 暂停监控 | `apps/server/src/routes/households.ts` |
| CSI 上行遥测 | `apps/server/src/routes/sensors.ts` |
| 被监护人 PWA | `apps/web/app/household/[code]/at-risk/` |
| 护理人 PWA | `apps/web/app/household/[code]/contact/` |
| Next.js 16 特殊规则 | `apps/web/AGENTS.md` |
| ESP32 固件源码 | `fall-detection-training/firmware/` |
| 录制脚本（含标注 UI） | `fall-detection-training/collection/collect.py` |
| 标签切分（FALL → IMPACT + FLOORED） | `fall-detection-training/labeling/split_fall_labels.py` |
| LSTM / CNN 训练 | `fall-detection-training/training/train_lstm.py`, `train_cnn_deep.py` |
| 集成融合 | `fall-detection-training/training/ensemble_predict.py` |
| LOOCV 评估 | `fall-detection-training/evaluation/loocv_eval.py` |
| 部署模型评估 | `fall-detection-training/evaluation/eval_seq9_ensemble.py` |
| 部署模型权重 + 阈值 | `fall-detection-training/model/fall_impact_seq9_ensemble/` |
| 外部数据适配 | `fall-detection-training/external_data_adapter/csi_har_adapter.py` |

---

## 6. 沟通原则

| 规则 | 说明 |
|---|---|
| **不要假设我清楚自己想要什么** | 动机或目标不清晰时，停下来**主动提问**，不要猜测 |
| **目标清晰但路径不是最短的** | 直接告诉我，并**建议更好的办法** |
| **遇到问题追根因** | **不打补丁**。每个决策都要能回答"为什么" |
| **输出说重点** | **砍掉一切不改变决策的信息**。少废话 |

---

## 7. API 速率限制（硬约束）

| 指标 | 上限 |
|---|---|
| **RPM（Requests Per Minute）** | **< 200** |
| **TPM（Tokens Per Minute）** | **< 10,000,000** |

超出时 Claude 必须主动降速（串行代替并行、合并请求）。

> **本项目额外的外部依赖速率限制**：
> - **Twilio WhatsApp**：沙箱账户有 TPS 限制（默认 ~1 msg/s），生产需申请提升
> - **Pusher Channels**：免费层 100 并发连接 / 200K 消息/天，超出后付费
> - **Vercel Serverless**：函数执行时间 10s（hobby）/ 60s（pro）
> - **Railway**：按 vCPU + 内存计费，长任务注意 cold start

> 注：ESP32 烧录受 USB 串口物理限制（典型 < 5 次/分钟），不必单独设限。

---

## 8. 开发/调研文档规范（强制）

### 8.1 文件命名（必读）

每次进行开发或调研类的任务，**必须**留下过程文档，存入 **`dev_doc/`**（**本子项目根目录下的 `Bouy_CSI_FallDetection/dev_doc/`，**不要**写到父项目 `ESP32_FallRec_Reference/dev_doc/`），命名格式：

```
<序号>-<内容>-<日期>.md
```

示例：
- `1-bouy-codebase-walkthrough-2026-06-26.md`
- `2-state-machine-timer-tuning-2026-06-26.md`
- `3-ensemble-weights-vs-csi-pose-2026-06-26.md`

序号从 1 开始，**XML 参考表**使用 `0-references-<日期>.xml`。

### 8.2 文档内容最低要求

每份 dev_doc 至少包含：
- **调研/开发目标**
- **方法/工具**（用了哪些 API、库、命令）
- **关键发现 / 决策依据**（附可信链接）
- **结论 / 待澄清事项**

### 8.3 XML 参考表（强制）

进行调研过程中必须维护一份 XML 表格（`0-references-<日期>.xml`），每个参考资料登记：

```xml
<ref id="r001">
  <title>...</title>
  <type>repo|paper|doc|dataset|tool|user-code</type>
  <url>...</url>
  <local_path>...</local_path>
  <status>active|archived|contact-required|404</status>
  <trust>high|medium|low</trust>
  <used_in>...（被哪些 dev_doc 引用）</used_in>
  <notes>...</notes>
</ref>
```

目的：便于未来其他 agent 快速查证、复用引用、避免重复调研。

---

## 9. 代码开发规范（强制）

### 9.1 连续 5 个报错退出机制

进行代码开发工作时，如果当前采用的方法遇到 **连续 5 个报错**，**必须**：

1. **立即退出自动模式**
2. **重新审视当前解决方法本身**（不是补丁，是质疑方法）
3. **生成一份简要 debug 报告**：
   - 已尝试的方法
   - 每个方法的报错摘要
   - 怀疑的根因（不是症状）
   - 建议的下一步方向（**不**是直接给出答案）
4. **等待人工手动确认**才继续

### 9.2 根因优先

打补丁 = 失败。出现 bug 时**先问"为什么"，再问"怎么办"**。

### 9.3 每次决策可追溯

每个决策（参数、模型选择、阈值）都要能在对应 dev_doc 中找到依据。

**Bouy 特定的可追溯清单**（改这些参数时必须先有 dev_doc 支撑）：

- 模型阈值（`config.json` 中的 0.50）
- 事故状态机计时（T1/T2/T3）
- 训练超参（epochs、batch size、alpha 加权）
- LOOCV 分折策略
- 窗口/帧数（9 × 6s）
- 任何"我猜这样能行"的常量

### 9.4 基准会话复现

任何对阈值、计时或代码的修改都必须**先**用 7 会话 LOOCV + held-out 会话复现基线指标（窗口 F1 0.81、事件 F1 0.90），再考虑新方案。**不能**直接套用 README 数字。

### 9.5 Next.js 16 特别警告

`apps/web/AGENTS.md` 已注明：**Next.js 16 有破坏性变更**，API、约定、文件结构都可能与训练数据不同。任何前端改动前必须**先**读 `node_modules/next/dist/docs/` 相关指南，并留意 deprecation 通知。

### 9.6 跨子系统接口稳定

`apps/server/` 与 `apps/web/`、`apps/server/` 与设备端 CSI 板通过 HTTP/JSON 交互。**任何接口变更必须先看上下游再改**，避免前后端/HW 失同步。

---

## 10. 任务规模管理

- 任何任务开始前，先评估**是否需要 brainstorm**：单文件小改可跳过；多文件 / 跨子系统 / 新功能**必须 brainstorm**
- 任务被中断后，**不要猜测进度**，先看 git、文件、task 列表核对
- 同一会话里如果用户已经改了方向，**不要延续旧路径**

### 10.1 Bouy 跨子系统影响面

修改前必查：

| 改这里 | 至少要看 |
|---|---|
| `apps/server/src/state-machine.ts` | `apps/server/src/routes/incidents.ts`、`apps/web/` Pusher 事件订阅 |
| `apps/server/src/routes/incidents.ts` | `state-machine.ts`、`apps/web/` 仪表盘 |
| `fall-detection-training/model/.../config.json`（阈值） | `evaluation/eval_seq9_ensemble.py`、对应 dev_doc |
| `fall-detection-training/training/` 损失/模型 | `model/` 部署产物 + `evaluation/` |
| `fall-detection-training/labeling/split_fall_labels.py` | `training/`、`evaluation/` 全链路 |
| `fall-detection-training/firmware/` | `collection/csi_io.py` 解析逻辑 |
| `apps/web/` UI | `apps/web/AGENTS.md` + `node_modules/next/dist/docs/` |

---

## 11. Claude 必须遵守的红线

1. ❌ **不动 LICENSE** — MIT 版权信息原样保留
2. ❌ **不把单次 held-out 会话的指标当真理** — 7 会话 LOOCV 数字仅作起点
3. ❌ **不绕过 LOOCV 直接评估** — 时序数据必须跨会话验证
4. ❌ **不绕过 Next.js 16 警告** — `apps/web/AGENTS.md` 是硬约束
5. ❌ **不在前端硬编码后端地址** — 走环境变量（`BASE_URL`）
6. ❌ **不在事故状态机里漏掉任一终态** — DETECTED/AWAITING_USER_RESPONSE/CONTACTS_NOTIFIED/CONTACT_RESPONDING/RESOLVED/ESCALATION_AVAILABLE/ESCALATED 都要可终止
7. ❌ **不在没确认 Twilio 沙箱限制前批量发消息** — 默认 1 msg/s
8. ❌ **不写未确认的方案** — 任何 dev_doc 在用户复核前都标注"待复核"
9. ❌ **不打补丁** — 出现连续 5 报错必须退出自动模式
10. ❌ **不复用旧路径** — 用户改方向后，旧的 dev_doc 必须明确标注"已废弃"
11. ❌ **不堆废话** — 输出必须有可决策性
12. ❌ **不超速率** — RPM < 200 / TPM < 10M

---

## 12. 当前项目状态速查

| 项 | 状态 |
|---|---|
| README / 训练管线 README | ✅ 完整 |
| 4 个子系统代码 | ✅ 完整 |
| MIT License | ✅ |
| TorchScript 部署模型 | ✅（`fall_impact_seq9_ensemble/`）|
| LOOCV 评估管线 | ✅ |
| 事故状态机（T1/T2/T3）| ✅ |
| Twilio WhatsApp + Pusher | ✅ |
| Vercel + Railway 部署配置 | ✅ |
| 跨房间 / 跨受试者验证 | ❌ 未做 |
| 单元测试 / CI | ⏸ 待核对 |
| 与 csi-pose 的对比 / 复用关系文档 | ⏸ 待写 |
| 中文 README | ❌ 缺失（可选）|

**下一步（如需推进）**：
1. 在 `dev_doc/1-bouy-codebase-walkthrough-2026-06-26.md` 把代码与决策对齐
2. 写 `dev_doc/2-bouy-vs-csi-pose-2026-06-26.md` 比较两个开源项目的架构差异
3. 用 LOOCV 复现基线指标（窗口 F1 0.81 / 事件 F1 0.90）
4. 核对 Next.js 16 与训练数据的差异范围

> ⚠️ 上方所有 `dev_doc/` 相对路径均指 **本子项目根目录**：`Bouy_CSI_FallDetection/dev_doc/`，**不要写到父项目 `ESP32_FallRec_Reference/dev_doc/`**。父项目 `dev_doc/` 是父项目调研文档（4 份 `*-research/design-2026-06-26.md`）的归档地，与本子项目无关。

---

**最后更新**：2026-06-26 by Claude
**依据**：父项目 `ESP32_FallRec/CLAUDE.md` 格式 + `csi-pose/CLAUDE.md` 同类规范 + Bouy `README.md` 与 `fall-detection-training/README.md` 内容