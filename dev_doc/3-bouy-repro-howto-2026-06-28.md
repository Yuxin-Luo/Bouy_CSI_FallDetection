# Bouy CSI 跌倒检测复现 — 大学生级操作指南

> **目标读者**：已会 Python + 基本 Linux 命令的本科同学（或研究生新生）。
> **预期时长**：5 天完成 demo。
> **最终效果**：5 块 ESP32-S3 摆在房间，浏览器打开 `localhost:5000` 能看到 4 个 RX 板的实时 CSI 波形，跌倒发生时报警条 + 报警音。

---

## 0. 阅读须知

### 0.1 这份指南假设你已经会什么

| 你需要会的 | 没学过怎么办 |
|---|---|
| Linux 基本命令（cd / ls / cp / grep） | 临时学，跳过这步不现实 |
| Python 3.12 + pip + venv | 已装 Conda 就够，按 conda 用 |
| Git 克隆 + 切分支 | 不需要，写代码量小 |
| ESP32 大致原理 + 烧录过任意固件 | 不用很熟，跟着 VSCode 插件点鼠标即可 |

### 0.2 5 天总体路线图

```
Day 1  烧 1 块 RX 板验证 → 看到串口有 CSI 输出
Day 2  烧完 5 板 + 4 RX 同时录一段 standing
Day 3  先试 shipped 模型 → 看效果决定是否采数据
Day 4  （如需）微调模型
Day 5  写 Flask 前端 + 真实跌倒测试
```

如果每步都按预期走，5 天后你能：
- 跑出 window-F1 ≥ 0.7 的模型（自己采的数据）
- 浏览器看到实时 CSI + 概率 + 报警
- 5 板完整链路可重复演示

### 0.3 项目结构速览（你要建在哪儿）

```
Bouy_CSI_FallDetection/         ← 你现在的目录
├── CLAUDE.md
├── README.md
├── LICENSE
│
├── src/                          ← 【你要新建】自主代码全在这里
│   ├── firmware/                 ← ESP32 固件（从官方 + Bouy 合并）
│   ├── pc_tools/                 ← PC 端 Python
│   │   ├── receiver/             ← 串口读取
│   │   ├── inference/            ← 推理主循环
│   │   ├── training/             ← （可选）微调脚本
│   │   └── frontend/             ← Flask 前端
│   └── data/                     ← 自采数据（gitignore）
│
├── asset/audio/alarm.wav         ← 报警音（从 Mycode 拷）
│
├── dev_doc/                      ← 调研 + 方案 + 本指南
│
├── fall-detection-training/      ← Bouy 自带，复用其 Python 部分
├── apps/                         ← 不动（不部署 server/web）
└── FontendInspo/                 ← 不动
```

---

## Day 1：烧 1 块 RX 板，看到 CSI 数据流

**今天目标**：把 1 块 ESP32-S3 烧成 RX，从串口能看到 `CSI_DATA,...` 这种行输出。

### Step 1.1：准备工作

#### 硬件清单（5 块板都需要）

- ✅ **5 块 ESP32-S3**（你已有）
- ✅ **5 根能传数据的 USB-C 数据线**（⚠ 纯充电线不行——你能用它连电脑烧录，但连上后电脑看不到串口设备）
- ⚠ **1 个 USB Hub**（建议带电源，能稳定接 4 块 RX + 1 块 TX；Day 2 才用到）
- ⚠ **TX 板的独立供电**（micro-USB 5V 充电器即可）

#### 软件清单

- ✅ **ESP-IDF v6.0.1**（已装 + VSCode 插件）
- ✅ **Python 3.12 + Conda 环境 `dac_dev`**（已存在）
- ✅ **5 块板上的 micro-USB / USB-C 接口完好**

### Step 1.2：创建固件目录

打开终端（VSCode 内 Terminal 也行），进入项目目录：

```bash
cd ~/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/

# 创建 src 目录结构
mkdir -p src/firmware src/pc_tools/{receiver,inference,training,frontend} src/data/{raw,labeled,processed} asset/audio

# 创建 dev_doc 已有的几个文件确认在位
ls dev_doc/
# 应该看到 1-bouy-repro-interim-2026-06-27.md 等
```

**为什么这么建**：src/ 下分 firmware / pc_tools / data 三块，**固件 = 板子上的代码，pc_tools = 电脑上的代码，data = 采集的训练数据**——三大类物理隔离，避免文件混乱。

### Step 1.3：拷官方 csi_recv 例程作为基线

```bash
# 拷官方（来自 espressif/esp-csi 仓库的 S3 支持例程）
cp -r ReferenceCode/Opensourse/esp-csi/examples/get-started/csi_recv src/firmware/

# 看一眼结构
ls src/firmware/csi_recv/
# 应该看到 main/, CMakeLists.txt, dependencies.lock 等
```

**为什么要用官方的**：官方 esp-csi 是 Espressif 官方仓库，质量有保证、文档齐全、S3 支持成熟。Bouy 项目的固件本质上是"在官方基础上加了 MAC filter 和固定 MAC"。

### Step 1.4：覆盖 Bouy 的 RX 补丁

```bash
# 把 Bouy 改过的 main.c 盖到我们目录
cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/firmware/firmware_patches/csi_recv_app_main.c \
   src/firmware/csi_recv/main/app_main.c
```

**为什么覆盖**：Bouy 的 patch 给 csi_recv 加了三样关键东西：
1. **MAC filter**（`memcmp(info->mac, CONFIG_CSI_SEND_MAC, 6)`）—— 只接收固定 MAC `0x1a:00:00:00:00:00` 发出的包，否则 4 块 RX 会收到满世界 WiFi 包
2. **信道 6**（`CONFIG_LESS_INTERFERENCE_CHANNEL = 6`）—— 和 TX 对齐
3. **gain control**（`esp_csi_gain_ctrl.h`）—— 自动校准接收增益，让 CSI 数据更稳定

**不覆盖会怎样**：你会收到一堆杂乱 CSI 数据（4 块 RX 都收满邻居 WiFi），4 板数据完全无法对齐。

### Step 1.5：确认 main.c 改动正确

```bash
# 验证关键配置
grep -n "CONFIG_LESS_INTERFERENCE_CHANNEL\|CONFIG_CSI_SEND_MAC\|WIFI_BW" \
   src/firmware/csi_recv/main/app_main.c
```

应该看到：
- `CONFIG_LESS_INTERFERENCE_CHANNEL = 6`
- `CONFIG_CSI_SEND_MAC[] = {0x1a, 0x00, 0x00, 0x00, 0x00, 0x00}`
- `WIFI_BW40`（不是 `WIFI_BW_HT40`——后者是 IDF v5 旧名，v6 重命名了）

**如果你看到 `WIFI_BW_HT40`**：说明你拷错了文件。重新从 `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/.../firmware_patches/csi_recv_app_main.c` 拷一次。

### Step 1.6：在 VSCode 编译 + 烧录

#### 用 VSCode 插件（推荐）

1. VSCode 打开 `src/firmware/csi_recv/` 文件夹（不是整个项目！）
   - `File → Open Folder → src/firmware/csi_recv/`
2. VSCode 底部状态栏找 "Set Target" → 选 **esp32s3**
3. 找 "Build" 按钮（漏斗图标）→ 点一下
4. 等待编译（首次 2-5 分钟，依赖下载完成后 30 秒）
5. **只插 1 块 ESP32-S3 到电脑**（⚠ 一次只插 1 块！）
6. 找 "Flash" 按钮（闪电图标）→ 点
7. 弹出选串口的对话框 → 选 `/dev/ttyUSB0`（Linux）
8. 等待烧录完成（约 10-30 秒）

#### 用 CLI（备选）

```bash
cd src/firmware/csi_recv

# 装环境（如果之前没 source 过）
get_idf  # 别名：. $HOME/esp/esp-idf/export.sh

# 编译
idf.py set-target esp32s3
idf.py build

# 烧录（只插 1 块板）
idf.py -p /dev/ttyUSB0 flash
```

### Step 1.7：看串口输出

烧录完成后，板子会自动重启。看串口：

#### 用 VSCode 插件

- VSCode 底部状态栏找 "Monitor"（眼睛图标）→ 点
- 应该看到一堆这样的行：
  ```
  CSI_DATA,1234,1a:00:00:00:00:00,-45,0,0,...
  ```

#### 用 CLI

```bash
# 另开一个终端
cd src/firmware/csi_recv
idf.py -p /dev/ttyUSB0 monitor
# 按 Ctrl+] 退出
```

**⚠ 重要**：如果你看到一堆乱码或没输出：
1. 波特率不对？试试 921600（默认）
2. 板子没在发？重启板子（按 RST 按钮或重新上电）
3. 串口号不对？`ls /dev/ttyUSB*` 看哪个有

### Step 1.8：把烧录好的 RX 板放到一边，标记 RX #1

- 用便签纸写 "RX #1" 贴在板子上
- **拔掉 USB 线**（固件已写入 flash，断电不影响）
- 准备 Day 2 烧下一块

### ✅ Day 1 验收

| 项 | 怎么验证 |
|---|---|
| 编译成功 | `build/` 目录有 `csi_recv.bin` 等产物 |
| 烧录成功 | 串口看到 `CSI_DATA,...` 输出（可能为空，因还没 TX 发包） |
| **没报错** | 编译/烧录/串口监视全过程无红色错误 |

> ⚠ **可能看不到 CSI 输出**：因为还没有 TX 板发 null-data，RX 板只能"听"到空频道。**这是正常的**——Day 2 烧 TX 板后就有数据了。

---

## Day 2：5 板全烧 + 4 RX 同时录数据

**今天目标**：5 板全部烧完，4 RX 同时给 PC 传数据，存一段 30 秒的 standing 数据。

> ⚠ **2026-06-28 实际硬件修正（ESP32-S3 用户必读）**
>
> 原计划默认 `/dev/ttyUSB*`（基于 CP2102/CH340 UART 桥接芯片的传统 ESP32 开发板）。
> **ESP32-S3 用原生 USB**，Linux 内核枚举为 `/dev/ttyACM*`。
> 本文档下文所有命令已按 `ttyACM*` 改写。如果你用的是带桥接芯片的旧开发板，把 `ttyACM*` 换回 `ttyUSB*` 即可。
>
> 验证方式：
> ```bash
> $ ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
> /dev/ttyACM0  /dev/ttyACM1  /dev/ttyACM2  /dev/ttyACM3
> ```

### Step 2.1：再烧 3 块 RX 板

**重复 Day 1 Step 1.6–1.8**，依次烧 RX #2、#3、#4。每块单独插、单独烧、单独贴标签。

**⚠ 不要同时插多块板子**！烧录脚本要求一次只能看到 1 块，否则会拒绝烧录。

**为啥要单独烧**：esptool 通过 USB 串口和板子通信，多块板插着会冲突（多 ttyUSB、相同 chip id）。一次插一块是 ESP32 烧录的标准做法。

### Step 2.2：烧 TX 板

TX 板的烧录流程和 RX 类似，但用 csi_send 固件：

#### a) 准备 csi_send 固件目录

```bash
# 拷官方 csi_send
cp -r ReferenceCode/Opensourse/esp-csi/examples/get-started/csi_send src/firmware/

# 覆盖 Bouy TX 补丁
cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/firmware/firmware_patches/csi_send_app_main.c \
   src/firmware/csi_send/main/app_main.c

# 验证
grep -n "CONFIG_LESS_INTERFERENCE_CHANNEL\|CONFIG_CSI_SEND_MAC" \
   src/firmware/csi_send/main/app_main.c
# 应看到信道 6 + MAC 1a:00:00:00:00:00
```

#### b) VSCode 打开 `src/firmware/csi_send/`

- Set target → esp32s3
- Build → Flash（一次只插 1 块板）

#### c) 把 TX 板放到书架 1.8m+

- 找书架的最高层中间位置
- 用胶带或绳子固定
- 用独立 USB 充电器供电（**不**连电脑）
- 板子上的 micro-USB 接充电器即可

**为啥 TX 不连电脑**：TX 的工作就是"持续往 WiFi 信道 6 发空数据包（null-data）"。它不需要 USB 通信，连充电器就够了。RX 才需要 USB 传数据给 PC。

### Step 2.3：4 RX 全部用 USB 连 PC

- 把 RX #1–#4 放到活动区域四角
- 用 USB 数据线连到 PC（或 USB Hub）
- 验证 4 个串口都识别：

```bash
ls /dev/ttyACM* /dev/ttyUSB* 2>/dev/null
# ESP32-S3 native USB → /dev/ttyACM0  /dev/ttyACM1  /dev/ttyACM2  /dev/ttyACM3
# UART-bridge ESP32  → /dev/ttyUSB0  /dev/ttyUSB1  /dev/ttyUSB2  /dev/ttyUSB3
# （顺序不一定，看实际枚举）
```

**如果只有 1-2 个 ttyUSB 出现**：
- 检查数据线（换一根试试）
- 检查 USB Hub 是否有独立电源
- `dmesg | tail -20` 看 USB 枚举错误

### Step 2.4：Stage 1 验收——4 RX 同时有数据流

打开 4 个终端（或 4 个 VSCode 监视窗口），分别 monitor：

```bash
# 终端 1
cd src/firmware/csi_recv && idf.py -p /dev/ttyUSB0 monitor

# 终端 2
cd src/firmware/csi_recv && idf.py -p /dev/ttyUSB1 monitor

# 终端 3
cd src/firmware/csi_recv && idf.py -p /dev/ttyUSB2 monitor

# 终端 4
cd src/firmware/csi_recv && idf.py -p /dev/ttyUSB3 monitor
```

**应该看到 4 个终端都有 `CSI_DATA,...` 输出**（约 70 行/秒/板）。4 板的 MAC 字段都应是 `1a:00:00:00:00:00`（TX 的 MAC）。

**如果某一块没输出**：
- 检查 RX 板电源（指示灯亮吗）
- 检查 USB 线（换一根）
- 重新烧这块板
- 看串口是否有红色错误日志

### Step 2.5：Stage 2 验收——真实位置摆放

把 4 块 RX 从 PC 旁边挪到实际"四角"位置：

```
              TX (书架 1.8m+)
                  │
                  │
                  │
   RX #1 ──────── PC ──────── RX #2
                  │
                  │
              RX #3            RX #4
```

观察 4 个 monitor 终端：
- 数据流**继续稳定** → USB 线够长，D19 Stage 2 通过
- 数据流**中断 / 报错** → USB 线不够长，进入 Stage 3（买主动延长线）
- **完全连不上** → 进 Stage 4（改 UDP，要 +1-2 天）

**记录**：在 `dev_doc/4-bouy-repro-progress-2026-XX-XX.md` 写下哪一阶段通过、用了什么长度的 USB 线。

### Step 2.6：拷 Bouy 的串口读取脚本

```bash
# csi_io.py - 多端口串口读取器（核心）
cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/collection/csi_io.py \
   src/pc_tools/receiver/csi_io.py

# capture_multi.py - 4 RX 无标签录入
cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/collection/capture_multi.py \
   src/pc_tools/receiver/capture_multi.py
```

**为什么直接拷**：这两个脚本是 Bouy 自己写的，质量有保证（HackDavis 获奖项目代码）。

### Step 2.7：改 Linux 串口路径（实际改动记录）

> **2026-06-28 实测**：只需要改 `capture_multi.py` 一个文件。`csi_io.py` 的 `MultiPortReader` **接受外部传入的 `(path, name)` 元组**，自身不写死任何路径——所以无需改动。

打开 `src/pc_tools/receiver/capture_multi.py`，**改 1 处**：

```python
# === discover_ports() 函数 ===

# 改前（Bouy macOS 版）
def discover_ports():
    return sorted(glob.glob("/dev/cu.usbserial*") + glob.glob("/dev/cu.SLAB*"))

# 改后（Linux + ESP32-S3 native USB，保留 macOS 兼容做 fallback）
def discover_ports():
    """Auto-discover CSI RX serial ports.
    1. /dev/ttyACM*   — ESP32-S3 native USB  ← 我们用这个
    2. /dev/ttyUSB*   — CP2102/CH340 UART bridge
    3. /dev/cu.usbserial* / /dev/cu.SLAB* — macOS（保留兼容）
    """
    patterns = [
        "/dev/ttyACM*",
        "/dev/ttyUSB*",
        "/dev/cu.usbserial*",
        "/dev/cu.SLAB*",
    ]
    found = []
    for pat in patterns:
        found.extend(glob.glob(pat))
    seen = set()
    unique = []
    for p in found:
        if p not in seen:
            seen.add(p); unique.append(p)
    return sorted(unique)
```

同时建议把文件顶部的 docstring `Usage:` 示例从 `/dev/cu.usbserial-0001=RX1` 改成 `/dev/ttyACM0=RX1`，方便后续翻代码时不被 macOS 路径误导。

**为什么不"全平台探测一遍"**：实测只有 ESP32-S3 一种板子，全列出来反而增加阅读成本。如果以后接 ESP32-C3 / ESP32-C6，再追加即可。

### Step 2.8：录 30 秒 standing 测试数据

```bash
cd src/pc_tools/receiver/

# 先激活 conda 环境
conda activate dac_dev

# 录 30 秒 standing（无人活动）
# 注：脚本用的是 --port（重复多次），不是 --ports。指定名字用 =RX1 形式
python capture_multi.py \
    --port /dev/ttyACM0=RX1 \
    --port /dev/ttyACM1=RX2 \
    --port /dev/ttyACM2=RX3 \
    --port /dev/ttyACM3=RX4 \
    --duration 30 \
    --out ../../data/raw/test_30s.npz
```

**也可以省略 `--port`，让 `discover_ports()` 自动找**：

```bash
# 自动探测 ttyACM* → ttyUSB* → cu.*（按顺序）
python capture_multi.py --duration 30 --out ../../data/raw/test_30s.npz
```

**验收**：
- 终端打印每秒帧数（应该是 ~70 fps/板）
- 30 秒后 `src/data/raw/test_30s.npz` 文件存在
- 文件大小约 5-10 MB（4 板 × 30s × 70Hz × 192 子载波 × 4 bytes）

> **2026-06-28 实测（5 秒 smoke test）**：
>
> ```
> Recording 5s from 4 RX(s) → ../../data/raw/test_5s.npz
>   RX1   /dev/ttyACM0
>   RX2   /dev/ttyACM1
>   RX3   /dev/ttyACM2
>   RX4   /dev/ttyACM3
>
>   [████████████████████]   5.0/5s   386  366  397  380
>
> rx      pkts     rate  sub
>   RX1      386  69.3/s  192
>   RX2      366  65.7/s  192
>   RX3      397  71.2/s  192
>   RX4      380  68.0/s  192
>
>   ✓ saved 0.5 MB to ../../data/raw/test_5s.npz
> ```
>
> NPZ 内部结构（`np.load()` 验证）：
> - `rx_names`: `['RX1', 'RX2', 'RX3', 'RX4']`
> - `timestamps_<rx>`: shape `(N,)` float64，每帧 PC `time.monotonic()` 秒
> - `amplitudes_<rx>`: shape `(N, 192)` float32，**192 子载波振幅**（HT40 全带宽）
> - `label`: 空字符串
> - `started_at`: float64
>
> 平均帧间隔 ~14.5 ms = **~69 Hz/板**，与 Bouy README 的 70 Hz 规格吻合。
> 文件大小比例：5s → 0.5 MB → 推算 30s → ~3 MB / 会话；
> 若采 180s standing + 180s fall = 6 分钟 → ~36 MB / session（gitignore）。

**如果脚本跑不起来**：

| 现象 | 原因 | 解决 |
|---|---|---|
| `No module named serial` | 缺 pyserial | `pip install pyserial` |
| `PermissionError: /dev/ttyACM0` | 当前用户不在 dialout 组 | `sudo usermod -aG dialout $USER` 然后**重新登录** |
| 4 板都开但 fps 都很低（< 10）| USB hub 带宽/供电不足 | 换带电源的 hub，或主板直插 |
| 终端显示 `ERROR RX2: ...` | 该板未识别 | 拔插 USB；检查线是否数据线 |
| fps 正常但 NPZ 内某板 `amps.shape` 异常 | 该板 CSI 解析失败（`parse_csi_line` 返回 None）| 检查该板固件是否被覆盖回旧版 |

### ✅ Day 2 验收

| 项 | 怎么验证 |
|---|---|
| 5 板全部烧完 | 5 块板贴好标签（TX + RX ×4）|
| 4 RX 同时有数据流 | 4 个 monitor 都有 CSI 输出 |
| 真实位置摆放能跑通 | D19 Stage 1-2 通过 |
| 录到 30 秒数据 | `data/raw/test_30s.npz` 存在 |

> **如果 D19 进 Stage 3/4**：先解决距离问题再做后续 Day 3 的事。否则 inference 跑不起来。

---

## Day 3：先试 shipped 模型（NPZ 解耦架构）

**今天目标**：把 shipped TorchScript 模型跑起来，看它对你房间的跌倒是否响应。

> ⚠ **2026-06-28 架构大改（用户决策）**
>
> 原计划：单进程 `infer_loop.py`，内存 ring buffer，造假数据 smoke test。
>
> 现架构：**receiver.py + infer_loop.py 双进程解耦**：
> - `receiver.py` 持续读 4 RX 串口，每 6 秒写一个 NPZ chunk 到 `data/live/`
> - `infer_loop.py` 监视 `data/live/`，每来一个新 chunk 算 STFT，叠 9 个 chunk 喂模型
>
> **为什么这么改**：用户指出"造假数据没意义"，且双进程解耦更稳——receiver 挂了不影响推理，反之亦然；saved NPZ 可回放调试。

**条件分支**：
- ✅ shipped 模型响应好 → 跳过 Day 4 微调，进 Day 5
- ⚠/❌ 响应差 → 下午采数据，进 Day 4 微调

### Step 3.1：激活 Conda + 装 PyTorch（CPU）

```bash
conda activate dac_dev

# 装 PyTorch CPU 版（**必须 CPU**，原因见 §E.2）
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# 装其他依赖（scipy.signal.stft 是 infer_loop 的 STFT 来源）
pip install numpy scipy pyserial matplotlib flask
```

**为啥 CPU**：
1. shipped TorchScript 模型在 Windows + Python 3.13 + **CPU** 上 trace，LSTM hidden state 烤在 CPU 上；CUDA 跑会 device mismatch（实测验证，详见 §E.2）
2. 单窗推理只要 ~10ms，CPU 完全够 1 秒轮询节奏

### Step 3.2：写 receiver.py + infer_loop.py

**两个脚本 Claude 已生成**（不需手写）：

```
src/pc_tools/receiver/receiver.py         ← 持续 4 RX → 每 6 秒 1 个 NPZ
src/pc_tools/inference/infer_loop.py      ← watch data/live/ → STFT → 模型 → prob
```

关键参数表：

| 文件 | 参数 | 默认值 | 说明 |
|---|---|---|---|
| `receiver.py` | `--chunk-sec` | 6.0 | 每个 NPZ 包几秒 CSI |
| `receiver.py` | `--keep-last` | 20 | 旧 chunk 保留几个 |
| `receiver.py` | `--baud` | 921600 | 与 csi_recv 固件匹配 |
| `receiver.py` | `--out-dir` | `<project>/data/live` | 解析自 `__file__`，与 cwd 无关 |
| `infer_loop.py` | `--threshold` | 0.50 | 来自 config.balanced_demo |
| `infer_loop.py` | `--seq-len` | 9 | 9 个 chunk 堆叠 = 模型期望 |
| `infer_loop.py` | `--device` | **cpu** | 见 §E.2，CUDA 不可用 |
| `infer_loop.py` | `--poll-sec` | 0.5 | 扫 live-dir 间隔 |
| `infer_loop.py` | `--model` / `--config` | 自 `_MODEL_DIR` | 解析自 `__file__`，与 cwd 无关 |

`infer_loop.py` 内的 STFT 关键常量（**改这些参数 = 重新训练模型**，不要动）：

```python
NPERSEG = 96       # 来自 train_cnn_deep.py
NOVERLAP = 80
N_BANDS = 8        # 4 RX × 8 bands = 32 输入通道
NOMINAL_RATE_HZ = 70.0
WIN_SEC = 6.0
F_DIM = 49         # nperseg // 2 + 1
T_DIM = 21         # (6*70 - 80) // (96 - 80)
```

### Step 3.3：端到端测试（receiver + infer_loop 一起跑）

#### a) 终端 1：启动 receiver

```bash
cd src/pc_tools/receiver
python -u receiver.py        # -u 避免 Python 输出缓冲
```

应该看到（每 6 秒一行）：
```
Receiving from 4 RX(s)
  RX1   /dev/ttyACM0
  ...
Output dir : <project>/data/live
Chunk size : 6.0s   Keep last: 20

Streaming... Ctrl-C to stop.

  [15:29:34] chunk #0000  frames=420  size= 490 KB  → chunk_20260628_152934_0000.npz
  [15:29:40] chunk #0001  frames=420  size= 491 KB  → chunk_20260628_152940_0001.npz
  ...
```

#### b) 终端 2：等 9 个 chunk 写出来后启动 infer_loop

```bash
cd src/pc_tools/inference
# 等 ~58 秒让 receiver 写够 9 个 chunk
python -u infer_loop.py
```

应该看到：
```
Model      : .../fall_impact_seq9_ensemble.ts.pt
Config     : classes=['NOT_FALL_IMPACT', 'FALL_IMPACT']  input=[1, 9, 32, 49, 21]  ...
Threshold  : 0.500
Device     : cpu
Model loaded. Watching for new chunks... (Ctrl-C to stop)

  [15:30:32] warming up: 1/9 (chunk_..._0000.npz)
  [15:30:32] warming up: 2/9 (chunk_..._0001.npz)
  ...
  [15:30:32] warming up: 9/9 (chunk_..._0008.npz)
  [15:30:38] prob=0.123  ok  chunks_seen=10  ring=9/9
  [15:30:39] prob=0.087  ok  chunks_seen=11  ring=9/9
  ...
```

#### c) 故障排查

| 现象 | 原因 | 解决 |
|---|---|---|
| `ERROR RX1: read error: device disconnected` | 端口被另一进程占 | `pkill -f receiver.py` 再开 |
| `ERROR: live dir does not exist` | infer_loop 启动时 receiver 还没写 | 先等 6 秒让 receiver 写至少 1 个 chunk |
| `RuntimeError: Input and hidden tensors are not at the same device` | 你手动传了 `--device cuda` | 删掉 `--device cuda`，用默认 cpu |
| `warming up` 卡在 1/9 不动 | chunk 文件名格式不对 | 看 live-dir 里文件名是不是 `chunk_*.npz` |
| warming up 满了但一直不打印 prob | `seen_chunks` 状态问题 | Ctrl-C 重启 infer_loop |
| prob 全是 0.5x（卡在阈值附近）| shipped 模型对你的房间完全没把握 | 走 Day 3 §Step 3.5 的 ⚠ 路径，采数据 |

### Step 3.4：实测 shipped 模型效果

**测试方法**（自己一个人）：
1. 让 receiver + infer_loop 跑稳，等 prob 持续输出
2. 在 PC 旁**静坐 30 秒**——记下 prob 范围（理想 < 0.3）
3. 在 TX-RX 覆盖区域**走动 30 秒**——记下 prob 范围（应有波动，0.2-0.5）
4. **模拟跌倒 1 次**（站立 → 突然倒下躺地）—— 记下 prob 峰值

### Step 3.6：判定（条件分支）

| shipped 模型表现 | 后续路径 |
|---|---|
| ✅ **静坐 prob < 0.2 + 跌倒 prob > 0.5** | 跳过 Day 4 微调，**直接进 Day 5** |
| ⚠ **静坐 prob 0.2-0.5 + 跌倒 prob 0.3-0.5**（区分不开）| 继续 Day 3 下午：采数据；明天微调 |
| ❌ **静坐 prob > 0.5（一直误报）/ 跌倒 prob < 0.2（不响应）** | 继续 Day 3 下午：采数据；明天微调 |

> ⚠ **诚实声明**：shipped 模型是在 Bouy 作者特定 7 个会话上 LOOCV 训的，**到你房间大概率不准**。这是预期的，不丢人。
>
> **额外注意**：我们用 6s/包（非重叠）替换了 Bouy 训练时的 1s hop 重叠窗，**模型感受野从 14s 扩到 54s**。这会改变模型的时间统计特性，可能进一步降低泛化能力。如要恢复训练时的窗口对齐，需把 receiver 改成 1s/包 + infer_loop 内 6 包拼 1 窗。

### Step 3.6（如需）：采数据

按 Step 3.5 条件分支需要采数据时，用 **Day 2 的 `capture_multi.py`**（不是 receiver.py，因为采数据要一次性录完一整段）：

#### a) Standing 数据

```bash
cd src/pc_tools/receiver/
# 你一个人，站在区域中心，不动
python capture_multi.py \
    --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 --port /dev/ttyACM2=RX3 --port /dev/ttyACM3=RX4 \
    --duration 180 \
    --out ../../data/raw/session_01_standing.npz
```

#### b) Fall 数据

```bash
# 你一个人，重复 5-10 次"站立 → 倒下 → 躺 30 秒 → 站起来"
python capture_multi.py \
    --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 --port /dev/ttyACM2=RX3 --port /dev/ttyACM3=RX4 \
    --duration 180 \
    --out ../../data/raw/session_01_fall.npz
```

> ⚠ **保护自己**：在床垫/瑜伽垫上模拟跌倒，**不要真摔在硬地板上**。

#### c) 切标签（如需）

如果你采了 fall 数据，需要切 FALL → FALL_IMPACT + FLOORED：

```bash
cd fall-detection-training/
python labeling/split_fall_labels.py --dataset ../../../../../src/data/raw/
```

### ✅ Day 3 验收

| 项 | 怎么验证 |
|---|---|
| receiver.py 持续写 NPZ | 每 6 秒一行 `chunk #XXXX` |
| infer_loop.py 加载模型 | "Model loaded" 行 |
| infer_loop.py 累计 9 个 chunk 后开始打 prob | "warming up: 9/9" 后看到 `prob=0.XXX` |
| 真实 CSI 流通 | prob 对你走动有反应（> 0.2）|
| 已判定走 shipped / 微调路径 | 看 §Step 3.5 表格 |

---

## Day 4：微调（如需）

**触发条件**：Day 3 §Step 3.6 判定为 ⚠ 或 ❌。

> 如果 Day 3 已经判定 ✅（shipped 模型够用），**跳过 Day 4 直接进 Day 5**。

### Step 4.1：拷 Bouy 训练脚本

```bash
# 拷到我们的 src/pc_tools/training/
cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/training/train_lstm.py \
   src/pc_tools/training/finetune_lstm.py

cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/training/train_cnn_deep.py \
   src/pc_tools/training/finetune_cnn.py

cp ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/training/ensemble_predict.py \
   src/pc_tools/training/finetune_ensemble.py
```

### Step 4.2：训练 LSTM

```bash
cd src/pc_tools/training/

python finetune_lstm.py \
    --dataset ../../data/raw/ \
    --labels ../../data/raw/labels_v2.json \
    --source ours --t-seq 16 --epochs 30 \
    --ckpt checkpoints/lstm.pt
```

**首次跑**：可能要 5-15 分钟（数据量小）。

### Step 4.3：训练 CNN

```bash
python finetune_cnn.py \
    --dataset ../../data/raw/ \
    --labels ../../data/raw/labels_v2.json \
    --source ours --epochs 80 --augment \
    --ckpt checkpoints/cnn.pt
```

### Step 4.4：融合 + 评估

```bash
# Alpha 融合
python finetune_ensemble.py \
    --dataset ../../data/raw/ \
    --labels ../../data/raw/labels_v2.json \
    --source ours \
    --lstm-ckpt checkpoints/lstm.pt \
    --cnn-ckpt checkpoints/cnn.pt

# 用 shipped 的 eval 脚本评估
cd ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/evaluation/
python eval_seq9_ensemble.py
```

**预期**：window-F1 在 0.6-0.8 之间（数据量小，达不到 Bouy 的 0.81）。

### Step 4.5：替换 infer_loop.py 的模型

把 `ensemble_loader.py` 改成加载 `checkpoints/lstm.pt` + `checkpoints/cnn.pt`，重新跑 `infer_loop.py`，看 prob 是否改善。

### ✅ Day 4 验收

| 项 | 怎么验证 |
|---|---|
| 训练脚本不报错 | loss 在降 |
| F1 数字出来 | `eval_seq9_ensemble.py` 报告 |
| 新模型加载运行 | `infer_loop.py` 用新模型跑通 |

---

## Day 5：写 Flask 前端 + 真实测试

**今天目标**：浏览器打开 `localhost:5000` 看到 4 RX 实时 CSI 波形 + 跌倒时报警。

### Step 5.1：拷前端参考

```bash
# 拷 Flask 主程序（结构清晰，参考实现）
cp ReferenceCode/Mycode/fallRecog/app.py \
   src/pc_tools/frontend/app.py

# 拷 HTML 模板
mkdir -p src/pc_tools/frontend/templates
cp ReferenceCode/Mycode/fallRecog/templates/index.html \
   src/pc_tools/frontend/templates/

# 拷静态资源
cp -r ReferenceCode/Mycode/fallRecog/static src/pc_tools/frontend/

# 拷报警音
cp ReferenceCode/Mycode/fallRecog/alarm.wav asset/audio/
```

### Step 5.2：改数据源

打开 `src/pc_tools/frontend/app.py`，找到数据来源部分。Mycode 的版本是从 UDP H 矩阵读的，**你得改成从 infer_loop 读**。

**最简单的做法**：让 `infer_loop.py` 把当前 `(prob, alarm, csi_amplitudes)` 写到一个共享变量（或小文件），`app.py` 每秒读一次。

```python
# infer_loop.py 末尾加：
import json
state = {"prob": 0.0, "alarm": False, "csi": [[0]*192 for _ in range(4)]}
while True:
    # ... 推理 ...
    state["prob"] = prob
    state["alarm"] = alarm
    state["csi"] = csi_amplitudes.tolist()
    with open("/tmp/bouy_state.json", "w") as f:
        json.dump(state, f)

# app.py 加：
@app.route("/api/status")
def status():
    with open("/tmp/bouy_state.json") as f:
        return jsonify(json.load(f))
```

### Step 5.3：HTML 改报警条

打开 `templates/index.html`，找到 siren div，把触发条件改成：

```javascript
setInterval(async () => {
    const r = await fetch('/api/status');
    const s = await r.json();
    
    document.getElementById('prob').innerText = s.prob.toFixed(3);
    
    if (s.alarm) {
        document.getElementById('warning').style.display = 'block';
        document.getElementById('siren').style.display = 'block';
        new Audio('/static/soundEffect/alarm.wav').play();  // 简化报警音
    } else {
        document.getElementById('warning').style.display = 'none';
        document.getElementById('siren').style.display = 'none';
    }
}, 1000);
```

### Step 5.4：启动

两个终端：

```bash
# 终端 1：推理循环
cd src/pc_tools/inference/
python infer_loop.py

# 终端 2：Flask 前端
cd src/pc_tools/frontend/
python app.py
```

浏览器打开 `http://localhost:5000`，应该看到 CSI 实时滚动。

### Step 5.5：真实跌倒测试

在 TX-RX 覆盖区域：
1. 静坐 10 秒 → 确认 prob < 0.2，无报警
2. 走动 10 秒 → 确认 prob 0.2-0.5，无误报
3. 模拟 1 次跌倒 → 确认 prob > 0.5，**报警条 + 报警音触发**
4. 站起来 → 确认 prob 回落，报警清除

### Step 5.6：写收尾文档

在 `dev_doc/` 下写 `4-bouy-repro-completion-2026-XX-XX.md`，记录：
- 实际用的 USB 线长度
- shipped / 微调哪个走的
- 实测 F1 / 误报率 / 延迟
- 已知 bug / 后续改进方向

### ✅ Day 5 验收（最终）

| 项 | 标准 |
|---|---|
| 浏览器打开 5000 端口 | 看到 4 RX 实时 CSI 滚动 |
| 实时概率显示 | prob 数字每秒更新 |
| 跌倒时报警条亮起 | 全屏红 + 报警音 |
| 5 板链路完整可重复 | 重启后仍能跑 |

---

## 附录 A：故障排查清单

### A.1 编译失败

| 报错 | 原因 | 解决 |
|---|---|---|
| `idf.py: command not found` | 没 source ESP-IDF | `get_idf` 或 `. $HOME/esp/esp-idf/export.sh` |
| `target esp32s3 not supported` | IDF 版本太低 | 用 `idf.py --version` 确认 ≥ v6.0 |
| `undefined reference to esp_csi_gain_ctrl_xxx` | gain_ctrl 组件没装 | 看 [A.2](#a2) |
| `error: 'WIFI_BW_HT40' undeclared` | 用了 IDF v5 旧名 | 全局替换 `WIFI_BW_HT40` → `WIFI_BW40`、`WIFI_BW_HT20` → `WIFI_BW20` |

### A.2 gain_ctrl 组件缺失

```bash
cd src/firmware/csi_recv/
# 检查 idf_component.yml 是否声明依赖
cat main/idf_component.yml
# 应有：
# dependencies:
#   idf: ">=4.4.1"
#   esp_csi_gain_ctrl: ">=0.1.4"

# 如果没有，加上
# 然后 idf.py build 会自动从 component manager 下载
```

### A.3 烧录失败

| 现象 | 原因 | 解决 |
|---|---|---|
| `Failed to connect to ESP32-S3` | 板子在自动复位状态 | **按住 BOOT 按钮** 烧录全程，最后松手 |
| `A fatal error occurred: Failed to write to target RAM` | 串口被占用 | 关闭所有 monitor 窗口、其他串口工具 |
| 烧录一半卡住 | USB 线供电不稳 | 换短粗的数据线、插电脑后置 USB 口 |

### A.4 串口看不到 CSI 输出

1. 确认 TX 板在发包：TX 板的串口应有 `WiFi connected` 或类似日志（不是 CSI_DATA，是状态信息）
2. 确认信道对：RX 和 TX 都用 `CONFIG_LESS_INTERFERENCE_CHANNEL = 6`
3. 确认 MAC 对：4 块 RX 看到的 MAC 都应是 `1a:00:00:00:00:00`
4. 物理距离：TX-RX 距离不要太远（> 10m 信号弱），也不要太近（< 0.5m 容易饱和）

### A.5 `infer_loop.py` 报 shape 错

```python
# 在 infer_loop.py 加打印
print(f"输入 shape: {x.shape}")
print(f"模型期望: {INPUT_SHAPE}")
```

对照 `config.json` 的 `input_shape` 字段调整。

### A.6 4 RX 时间不同步

CSI 帧的时间戳是 RX 板自己的 `rx_ctrl->timestamp`（微秒级本地计数器），不是绝对时间。
- 简单同步：以 PC 端 `time.monotonic()` 为基准，每收到一帧打 PC 时间戳
- 严格同步：需要 4 块 RX 板先做时间同步（参考 NTP / PTP，但复杂）

**Bouy 也没做严格时间同步**，按"PC 时间戳"对齐就够 demo。

---

## 附录 B：你应该读的其他文档

| 想了解 | 读什么 |
|---|---|
| Bouy 整体架构 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/README.md` |
| 训练管线细节 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/README.md` |
| 固件 patch 解释 | `ReferenceCode/Opensourse/Bouy_CSI_FallDetection/fall-detection-training/firmware/firmware_patches/README.md` |
| 本项目的方案设计 | `dev_doc/2-bouy-repro-spec-2026-06-28.md` |
| 调研过程 + 决策记录 | `dev_doc/1-bouy-repro-interim-2026-06-27.md` |
| 参考资料登记表 | `dev_doc/0-references-2026-06-28.xml` |

---

## 附录 C：FAQ

**Q：5 天做不完怎么办？**
A：延长到 7 天。Day 1-2 最关键（硬件 + 数据流），如果 Day 2 结束还没看到 4 RX 同时有数据流，整个项目要重评估。

**Q：为什么不用 Next.js PWA？**
A：demo 用 Flask + 单 HTML 够了（参考 Mycode/fallRecog/app.py）。Next.js PWA 是 Bouy 用来"被监护人/护理人两端 + WhatsApp 推送"的产品级方案，对一个 5 天的 demo 是 over-engineering。

**Q：shipped 模型为什么大概率不准？**
A：模型在 Bouy 作者的 7 个特定会话上训的。你的房间、你的身高、你的步态都是新分布。LOOCV 显示 0.90 F1 是"在自己数据上的 held-out 表现"，**不能跨房间跨人泛化**——这是 Bouy README 自己写的诚实声明。

**Q：Mycode/fallRecog 的代码能用吗？**
A：固件部分（get-started/）**不复用**——用户 2026-06-28 警告是大模型辅助生成、未经严格审核。前端部分（fallRecog/app.py）的 Flask 框架可参考，**但数据源要改成 Bouy 推理循环**。

**Q：USB 线最长能多长？**
A：USB 2.0 官方 5m。带芯片的"主动延长线"可达 10-30m。够不到时改 UDP（要改 RX 固件，+1-2 天）。

**Q：能否多人检测？**
A：本项目**跳过**。Bouy 原项目有，但需要 CSI 振幅方差分类器、额外训练数据，5 天内做不完。

---

## 附录 D：Day 2 实测记录（2026-06-28）

> 本节由 Claude 在协助用户走完 Day 1+2 后自动补全，作为后续 Day 3+ 的基线。

### D.1 实际硬件清单

| 项 | 实际值 |
|---|---|
| 板子型号 | 5 块 ESP32-S3（含原生 USB，无 UART 桥接芯片）|
| 串口设备 | `/dev/ttyACM0` / `ttyACM1` / `ttyACM2` / `ttyACM3` |
| TX 板 MAC | `1a:00:00:00:00:00`（已写死在 RX 固件的 MAC filter）|
| 信道 | 6（HT40，全带宽）|
| 子载波数 | 192 |
| 采样率 | ~69 Hz / RX（实测，规格 70 Hz）|

### D.2 计划与实际的偏差

| 计划假设 | 实际 | 影响 | 已修正方式 |
|---|---|---|---|
| `/dev/ttyUSB*` | `/dev/ttyACM*` | capture_multi.py `discover_ports()` 找不到端口 | 已改 `discover_ports()` 优先探测 ttyACM* |
| `csi_io.py` 要改 | 不用改 | —— | 文档已说明（接受外部 port_specs）|
| `--ports` 单参数 | `--port` 重复多次 | 命令报错 | 文档已改用 `--port /dev/ttyACM0=RX1 ...` |

### D.3 验收数据（5 秒 smoke test）

| RX | pkts | rate (Hz) | 子载波 |
|---|---|---|---|
| RX1 (ttyACM0) | 386 | 69.3 | 192 |
| RX2 (ttyACM1) | 366 | 65.7 | 192 |
| RX3 (ttyACM2) | 397 | 71.2 | 192 |
| RX4 (ttyACM3) | 380 | 68.0 | 192 |

- **NPZ 文件**：`src/data/raw/test_5s.npz`（0.5 MB）
- **NPZ keys**：`rx_names`, `label`, `started_at`, `timestamps_RX*`, `amplitudes_RX*`
- **振幅 shape**：`(N, 192)` float32，**符合 Bouy 模型期望的 HT40 192 子载波**
- **平均帧间隔**：14.1–15.3 ms（≈ 67–71 Hz）
- **结论**：Day 2 验收 ✅，可直接进 Day 3 跑 shipped 模型

### D.4 Day 2 留下的文件

```
src/
├── data/raw/test_5s.npz          ← 5s smoke test（验证用）
├── pc_tools/receiver/
│   ├── csi_io.py                 ← 从 Bouy 原样拷贝（无需改动）
│   └── capture_multi.py          ← 改 discover_ports() + docstring
└── firmware/                     ← 空的（firmware 留在 fall-detection-training/firmware/ 暂未移）
```

### D.5 给后续 Agent 的提示

1. **进 Day 3 前确认**：5s smoke test 是否能稳定重跑（重新执行 Step 2.8 命令，每次都应得到 ~70 Hz/板）
2. **如果要跑 30s/180s**：把 `--duration` 改一下即可；NPZ 命名建议 `session_<NN>_<activity>.npz`
3. **如果 fps 突然降一半**：先 `idf.py monitor` 单板验证 TX 是否还在发包（长时间运行 ESP32 可能进入 power-save）
4. **不要去改 `csi_io.py`**：它是 Bouy 跨多个采集/可视化脚本共用的核心 reader，改了会牵连 dashboard_multi.py

### D.6 2026-06-30 增补：默认输出路径 bug 修复

**问题**：`capture_multi.py` 原版用相对路径生成默认 `--out`：

```python
if args.out is None:
    args.out = Path(f"capture_{datetime.now().strftime('%Y%m%d_%H%M%S')}.npz")
```

意味着：从哪个 cwd 跑就在哪里写。用户报告一次跑完之后在 `Bouy_CSI_FallDetection/` 根目录（不是 `data/raw/`）找到了 `capture_20260630_091123.npz`。**这是 bug，不是 feature**。

**影响**：其他开发者 / 未来的你从不同 cwd 跑，NPZ 会散落到不可预测的位置；如果有人用 `git add -A` 会把这些 blob 提交进 git（NPZ 一份几 MB）。

**修复**（2026-06-30 by Claude）：

```python
# src/pc_tools/receiver/capture_multi.py L37-42
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DEFAULT_OUT_DIR = _PROJECT_ROOT / "data" / "raw"
_DEFAULT_OUT_DIR.mkdir(parents=True, exist_ok=True)

# L97-101 — default now absolute under project root
if args.out is None:
    args.out = _DEFAULT_OUT_DIR / (
        f"capture_{datetime.now().strftime('%Y%m%d_%H%M%S')}.npz"
    )
```

与 `receiver.py` 的 `--out-dir` 处理保持一致（用 `__file__` 锚定项目根，与 cwd 无关）。

**Smoke test 验证**（从 `/tmp` 跑）：
```
✓ saved 0.4 MB to <absolute>/data/raw/capture_20260630_091653.npz
/tmp 干净（cwd 不再污染）
```

**额外清理**：

1. 已将孤儿文件 `capture_20260630_091123.npz` (2.3 MB, 30.6s @ 70Hz × 4RX × 192subs) 从根目录移到 `data/raw/`，并 `np.load()` 验证完整性。
2. `.gitignore` 末尾追加 3 行（**这是修复链中重要的一环**）：
   ```gitignore
   # CSI captures + live chunks (large binary blobs, regenerate from hardware anytime)
   data/
   **/capture_*.npz
   **/chunk_*.npz
   ```
   验证：`git status --short` 不再列出 `?? capture_*.npz` 和 `?? data/`。

**给后续 Agent 的提示**：
- 不要把任何 CSI 数据 `.npz` 文件 commit 进 git，永远用 `data/raw/`
- 如果你新写脚本，请同样用 `Path(__file__).resolve().parent.parent...` 模式锚定项目根
- 默认值要保证**运行结果不依赖调用方 cwd**——这是脚本可重用的最基本要求

---

## 附录 E：Day 3 实测记录（2026-06-28）

> 本节由 Claude 在协助用户实现 NPZ 解耦架构后自动补全，作为 Day 4+ 的基线。

### E.1 文件清单

```
src/
├── pc_tools/
│   ├── receiver/
│   │   ├── csi_io.py          ← Day 2 原样拷贝（Bouy 公共 reader）
│   │   ├── capture_multi.py   ← Day 2 改了 discover_ports() 适配 Linux
│   │   └── receiver.py        ← 【新】持续 4 RX → 6s NPZ chunks
│   └── inference/
│       └── infer_loop.py      ← 【新】NPZ watcher → STFT → ensemble → prob
└── data/
    └── live/                  ← 默认 NPZ 输出目录（gitignore）
```

### E.2 关键发现：CUDA device-mismatch bug

**症状**：第一次跑 infer_loop（CUDA auto-detect）时报：
```
RuntimeError: Input and hidden tensors are not at the same device,
              found input tensor at cuda:0 and hidden tensor at cpu
  File "code/__torch__/torch/nn/modules/rnn.py", line 30, in forward
    out, _3, _4 = torch.lstm(input, _1, _2, True, 1, 0., False, True, True)
```

**根因**：shipped TorchScript 模型导出时，trace 路径里有 LSTM hidden state 常量被烤在 CPU：
```
Traceback of TorchScript, original code (most recent call last):
C:\Users\sbval\AppData\Local\...\Python313\site-packages\torch\nn\modules\rnn.py(1124): forward
C:\Users\sbval\PycharmProjects\CSIModel\export_fall_model.py(35): forward
```
模型作者 Bouy 在 **Windows + Python 3.13 + CPU** 环境下用 `torch.jit.trace` 导出，hidden state 是 CPU tensor。

**解决**：`infer_loop.py` 的 `pick_device()` 默认改成 `cpu`。CPU 单窗推理 ~10ms，远低于 1 秒轮询节奏。

**给后续 Agent 的提醒**：
- 跑这个 shipped 模型**永远不要 `--device cuda`**，会撞同一个 bug
- 如果重新训练并 re-export，确保 trace 时用什么 device，推理就用什么 device
- 验证推理环境：在 Python REPL 里跑
  ```python
  import torch
  m = torch.jit.load(".../fall_impact_seq9_ensemble.ts.pt", map_location="cpu")
  x = torch.randn(1, 9, 32, 49, 21)
  m(x)  # 应该返回 shape (1, 2) 的 calibrated probs
  ```

### E.3 receiver.py 实测数据（58 秒）

```
[15:29:34] chunk #0000  frames=420  size= 490 KB  → chunk_..._0000.npz
[15:29:40] chunk #0001  frames=420  size= 491 KB  → chunk_..._0001.npz
[15:29:46] chunk #0002  frames=420  size= 491 KB  → chunk_..._0002.npz
[15:29:52] chunk #0003  frames=420  size= 495 KB  → chunk_..._0003.npz
[15:29:58] chunk #0004  frames=420  size= 493 KB  → chunk_..._0004.npz
[15:30:04] chunk #0005  frames=420  size= 496 KB  → chunk_..._0005.npz
[15:30:10] chunk #0006  frames=420  size= 492 KB  → chunk_..._0006.npz
[15:30:16] chunk #0007  frames=420  size= 495 KB  → chunk_..._0007.npz
[15:30:22] chunk #0008  frames=420  size= 493 KB  → chunk_..._0008.npz
```

- **每个 chunk = 420 帧 × 4 RX × 192 子载波 × 4 bytes ≈ 490 KB**（验证 STFT 输入尺寸）
- **9 个 chunk / 58 秒 ≈ 6 秒/包**（与 `--chunk-sec 6.0` 完全对齐）
- `frames=420` 证明 ~70 Hz 采样率（6s × 70Hz = 420）

### E.4 infer_loop.py 实测数据（warm-up + 首次推理）

```
Model      : .../fall_impact_seq9_ensemble.ts.pt
Config     : classes=['NOT_FALL_IMPACT', 'FALL_IMPACT']  input=[1, 9, 32, 49, 21]  ...
Threshold  : 0.500
Device     : cpu
Model loaded. Watching for new chunks... (Ctrl-C to stop)

  [15:30:32] warming up: 1/9 (chunk_..._0000.npz)
  [15:30:32] warming up: 2/9 (chunk_..._0001.npz)
  ...
  [15:30:32] warming up: 9/9 (chunk_..._0008.npz)
```

⚠ **首次推理尚未跑出 prob**——用户在我跑出第一次 prob 前中断了测试（要先整理文档）。下一步：再跑一次完整 70 秒测试，捕获 `prob=0.XXX` 行。

### E.5 模型规格速查（来自 config.json）

| 字段 | 值 |
|---|---|
| 模型名 | `fall_impact_seq9_lstm_transformer_ensemble` |
| 格式 | TorchScript |
| 输入 shape | `(1, 9, 32, 49, 21)` float32 |
| 输出 shape | `(1, 2)` calibrated probs |
| 类别 | `NOT_FALL_IMPACT` (0), `FALL_IMPACT` (1) |
| temperature | 0.3 |
| thresholds | balanced_demo = 0.50, low_false_alert = 0.84 |
| post_processing | merge_gap=2s, cooldown=8s, hop=1s, win=6s, seq_len=9 |
| shipped eval | impact F1 = 0.645（threshold 0.50）/ 0.583（threshold 0.84） |

### E.6 给后续 Agent 的提示

1. **不要改 `infer_loop.py` 里的 STFT 常量**（NPERSEG=96, NOVERLAP=80, N_BANDS=8, NOMINAL_RATE_HZ=70.0）——这些是训练时定的，改了 = 重新训练
2. **路径解析用 `__file__`**——两个脚本都用 `Path(__file__).resolve().parent.parent...` 锚定项目根，从任何 cwd 都能跑
3. **CUDA 永远关掉**——见 §E.2
4. **`receiver.py` 写完直接 Ctrl-C**——`MultiPortReader` 是 daemon 线程，会自动退出
5. **如果想恢复训练时的 14s 感受野**：改 receiver 为 1s/包 + infer_loop 内 6 包拼 1 窗（栈 9 窗 = 9s × 6 = 54s？还是 9×1=9s？需重新算）。**当前 6s/包 + 9 堆叠 = 54s 感受野**，比 Bouy 训练时宽 4 倍。

---

**最后更新**：2026-06-28 by Claude
**状态**：✅ Day 1-3 代码完成；端到端测试部分完成（receiver 验证通过，infer_loop warm-up 通过，首次推理待复测）
**预期完成时间**：5 天（Day 1-3 已用约 1.5 天）
**预计代码量**：~500 行 Python（receiver.py 130 行 + infer_loop.py 270 行 + 之前 200 行）+ 2 个 ESP32 固件 + 1 个 HTML 模板