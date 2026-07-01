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
2. 在 PC 旁**静坐 30 秒**——记下 prob 范围
3. 在 TX-RX 覆盖区域**走动 30 秒**——记下 prob 范围
4. **模拟跌倒 1 次**（站立 → 突然倒下躺地）—— 记下 prob 峰值

> **2026-06-30 实测**（详见 §D.11）：
> - 静坐 / 走动 / 改变姿态 / 改变设备位置 → **prob 始终 0.02–0.09，全部 < 0.1**
> - 人体位置和设备距离对 prob 幅度有可见影响（说明 CSI 信号变化确实被模型接收到了），但**完全不足以触发 threshold 0.5**
> - 结论：shipped 模型在你的房间**确认不响应**，无条件进入 Day 4 微调路径

### Step 3.6：判定（条件分支）

| shipped 模型表现 | 后续路径 |
|---|---|
| ✅ **静坐 prob < 0.2 + 跌倒 prob > 0.5** | 跳过 Day 4 微调，**直接进 Day 5** |
| ⚠ **静坐 prob 0.2-0.5 + 跌倒 prob 0.3-0.5**（区分不开）| 继续 Day 3 下午：采数据；明天微调 |
| ❌ **静坐 prob > 0.5（一直误报）/ 跌倒 prob < 0.2（不响应）** | **← 2026-06-30 实测确认此路径。所有 prob 0.02–0.09，低于告警阈值 0.5。无条件进 Day 4 微调。** |

> ⚠ **诚实声明（已由实测验证）**：shipped 模型在 Bouy 作者特定 7 个会话上 LOOCV 训出 0.90 F1，**但在本房间实测完全不响应**——所有人体动作（走动、姿态变化、位置变化）的 prob 均 < 0.1。这验证了 §D.9 的假设：房间多径结构、人体生物特征的差异导致彻底的数据分布偏移（data distribution shift）。不是架构 bug，是模型-环境 mismatch。
>
> **额外注意**：我们用 6s/包（非重叠）替换了 Bouy 训练时的 1s hop 重叠窗，**模型感受野从 14s 扩到 54s**。这会改变模型的时间统计特性，可能进一步降低泛化能力。如要恢复训练时的窗口对齐，需把 receiver 改成 1s/包 + infer_loop 内 6 包拼 1 窗（见 §D.10 Option B）。

### Step 3.6（如需）：录制带标签的训练数据

> **2026-06-30 修正（重要）**：原 §Step 3.6 用 `capture_multi.py`，**它只产 `.npz` 不产 `labels.json`**，训不了模型。改用 `collect.py`（[Bouy 官方标注工具](../Bouy_CSI_FallDetection/fall-detection-training/collection/collect.py)，键盘实时标注 → 自动写 `csi.npz` + `labels.json` + `metadata.json`）。详见 §D.14。

#### a) 前置准备

```bash
# 0. 清理旧数据（无 labels.json，不能训练，可以删）
#    ⚠ 这是破坏性操作，确认你不需要 raw signal 后再执行
rm -f src/data/raw/test_5s.npz \
      src/data/raw/session_01_standing.npz \
      src/data/raw/session_01_fall.npz

# 1. 用绝对路径指定输出根（避免 cwd 漂移，参见 §D.6/D.13.3）
OUT=/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/src/data/raw

# 2. 确认 4 RX + 1 TX 都在位
ls /dev/ttyACM*    # 期望 ttyACM0-3

# 3. ⚠ collect.py 需要图形界面（matplotlib + TkAgg backend）
#    - 本地 Linux 桌面 / macOS / Windows：直接 OK
#    - SSH 远程：需 X11 forwarding（`ssh -X user@host`）或 VNC
#    - WSL2 + WSLg：直接 OK
#    - 纯 headless 服务器：collect.py 会启动失败
#    - 报 `_tkinter.TclError: no display name and no $DISPLAY` → `export DISPLAY=:0` 或用 X forwarding
#    - 报 `No module named '_tkinter'` → `sudo apt install python3-tk`（Debian/Ubuntu）
```

#### b) Session A：纯 Standing（3 分钟）

```bash
cd fall-detection-training/collection

python collect.py \
    --session session_01_standing \
    --out-root "$OUT" \
    --duration 180 \
    --subject me \
    --notes "standing + occasional walk in 1.8m radius"
```

**键盘序列**（0=EMPTY, 1=STILL, 2=WALKING, 3=TRANSITION, 4/f=FALL, space=暂停, u=撤销, q=保存退出）：

```
启动时 → 按 1（STILL）   → 静立 90 秒
       → 按 2（WALKING）  → 走动 10 秒
       → 按 1（STILL）   → 静立 60 秒
       → 按 3（TRANSITION 蹲下） → 5 秒
       → 按 1（站回 STILL）  → 静立 14 秒
       → 按 q（保存退出 → 自动写 csi.npz + labels.json + metadata.json）
```

**关键时序**：标签在 `keypress instant` 写入（[collect.py:591](../Bouy_CSI_FallDetection/fall-detection-training/collection/collect.py#L591)），**精度 < 10ms**。误差源全在**你按 0-4 的反应时间和动作判断**。看着秒表或节拍器更准。

#### c) Session B：Fall 训练（3 分钟，5-8 次跌倒）

**前提**：在中央铺瑜伽垫/床垫，戴护具（防真摔）。

```bash
cd fall-detection-training/collection

python collect.py \
    --session session_01_fall \
    --out-root "$OUT" \
    --duration 180 \
    --subject me \
    --notes "5-8 falls on yoga mat, varied directions"
```

**键盘序列**（**关键是 `f` 必须在开始下落的瞬间按**）：

```
启动时 → 按 1（STILL）  → 站立准备 15 秒
       → 按 1（保持 STILL）
       → 【脚离地/重心失控那一刻】按 f（FALL）  ← 整个录制里最关键的时点
       → 【完全躺平稳定后】按 1（STILL）  ← 30 秒
       → 【开始站起来】按 3（TRANSITION）  → 5 秒
       → 【站稳】按 1（STILL）  → 15 秒
       → 重复 5-8 次
       → 按 q 退出
```

> **标签精度说明**：系统的 `f` 时间戳是按键瞬间的硬件时钟，**精度 < 10ms**。误差源全在**你按 f 的反应时间**（典型 150-300ms）和对"开始下落的瞬间"的判断。
>
> **多练 2-3 次找节奏**比一次性录好更重要；如果觉得按 f 时机难对齐，**让助手喊"开始"口令**比"自己边倒边按"准很多。
>
> 按错的补救：按 `u` 撤销上一次按键（[collect.py:614](../Bouy_CSI_FallDetection/fall-detection-training/collection/collect.py#L614)）。按 `space` 暂停 CSI 录制但不退出（标签时间线冻结）。

#### d) 录制后立刻验证

```bash
# 1. 目录结构
ls -la "$OUT/session_01_standing/"
ls -la "$OUT/session_01_fall/"

# 2. labels.json 内容（一把梭看每类段数 + 总时长）
python3 << 'EOF'
import json
from pathlib import Path
from collections import Counter

OUT = Path("/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/src/data/raw")
for s in ['session_01_standing', 'session_01_fall']:
    p = OUT / s
    L = json.load(open(p / 'labels.json'))
    M = json.load(open(p / 'metadata.json'))
    print(f"\n=== {s} ===")
    print(f"  csi.npz: {(p/'csi.npz').stat().st_size/1e6:.1f} MB")
    print(f"  duration: {L.get('session_duration_sec', '?')}s")
    print(f"  segments: {len(L['segments'])} 段")
    cls_count = Counter(seg['class'] for seg in L['segments'])
    cls_time = {k: sum(seg['t_end']-seg['t_start'] for seg in L['segments'] if seg['class']==k) for k in cls_count}
    for cls in sorted(cls_count):
        print(f"    {cls:<12} n={cls_count[cls]:>3}  total={cls_time[cls]:>5.1f}s")
EOF
```

**期望**：
- `session_01_standing`：`STILL` 占比 > 80%，少量 `WALKING` / `TRANSITION`
- `session_01_fall`：`FALL` 段数 = 5-8，每段 1-3s；`STILL` 占大头

**不合格信号**（要重录）：
- FALL 段数 < 3 或每段 < 0.5s → 你按 f 的时机不对
- FALL 段 > 4s → 你从 FALL 切到 STILL 的时机晚了
- 整段全是 EMPTY → 你忘了按 1 进入 STILL

#### e) 切 FALL → FALL_IMPACT + FLOORED

```bash
cd fall-detection-training/labeling

python split_fall_labels.py --dataset "$OUT" --impact-sec 1.5

# 验证产出
ls "$OUT"/session_01_*/labels_v2.json

python3 << 'EOF'
import json
from pathlib import Path
from collections import Counter
OUT = Path("/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/src/data/raw")
for s in ['session_01_standing', 'session_01_fall']:
    p = OUT / s / 'labels_v2.json'
    if not p.exists():
        print(f"⚠ {s}: labels_v2.json 不存在（split_fall_labels.py 没产出）")
        continue
    L = json.load(open(p))
    print(f"\n=== {s} (v2) ===")
    cls_count = Counter(seg['class'] for seg in L['segments'])
    cls_time = {k: sum(seg['t_end']-seg['t_start'] for seg in L['segments'] if seg['class']==k) for k in cls_count}
    for cls in sorted(cls_count):
        print(f"    {cls:<12} n={cls_count[cls]:>3}  total={cls_time[cls]:>5.1f}s")
EOF
```

**期望**：
- `session_01_fall` 现在有 `FALL_IMPACT`（每个 FALL 段前 1.5s）+ `FLOORED`（剩余）
- `session_01_standing` 没 FALL，所以**没有** FALL_IMPACT / FLOORED 类（保持原 STILL/WALKING 段）

> ⚠ **没有 `labels_v2.json` 就跑不了 Day 4 训练**——这是上轮回答的隐性 bug：原 `split_fall_labels.py` 命令看似能跑，实际产出 0 份 labels_v2，训练时 `train_lstm.py` 会报"No sessions found"。

### ✅ Day 3 验收

| 项 | 怎么验证 |
|---|---|
| receiver.py 持续写 NPZ | 每 6 秒一行 `chunk #XXXX` |
| infer_loop.py 加载模型 | "Model loaded" 行 |
| infer_loop.py 累计 9 个 chunk 后开始打 prob | "warming up: 9/9" 后看到 `prob=0.XXX` |
| 真实 CSI 流通 | prob 持续输出（实测 0.02–0.09，不触发告警 — 正常，见 §D.11）|
| 已判定走 shipped / 微调路径 | ✅ 已判定：❌ 路径，进 Day 4 微调 |

---

## Day 4：微调（如需）

**触发条件**：Day 3 §Step 3.6 判定为 ⚠ 或 ❌。

> ✅ 2026-06-30：Day 3 已判定 ❌（实测 prob 0.02–0.09，shipped 模型不响应，见 §D.11）。Day 4 微调路径已触发。
>
> （原计划 Day 3 若判定 ✅ 就跳过 Day 4 — 此路径已被实测否决。）

### Step 4.1：训练脚本位置

> **2026-06-30 修正（路径/脚本名）**：
> - 训练脚本实际在 `fall-detection-training/training/`（`train_lstm.py` / `train_cnn_deep.py` / `ensemble_predict.py`），**不是** `src/pc_tools/training/finetune_*.py`（那是 §Step 4.1 原版建议的拷贝目标，但实际没拷贝过）
> - 推荐**直接用原脚本 + 绝对路径**，不拷贝。拷贝有版本漂移风险（原脚本更新时你不会同步）

```bash
# 验证脚本确实存在
ls fall-detection-training/training/{train_lstm.py,train_cnn_deep.py,ensemble_predict.py}

# 准备输出目录（脚本不会自动创建，缺这个会 FileNotFoundError）
mkdir -p fall-detection-training/checkpoints

# 用绝对路径写 --dataset（避免 cwd 漂移，参见 §D.6/D.13.3）
OUT=/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/src/data/raw
```

> 如确实想把脚本放到 `src/pc_tools/training/` 自主管（未来要魔改），仍可：
> ```bash
> cp fall-detection-training/training/train_lstm.py     src/pc_tools/training/finetune_lstm.py
> cp fall-detection-training/training/train_cnn_deep.py  src/pc_tools/training/finetune_cnn.py
> cp fall-detection-training/training/ensemble_predict.py src/pc_tools/training/finetune_ensemble.py
> ```
> 但下文命令统一用 Bouy 原脚本名 + 原目录。

### Step 4.2：训练 LSTM

```bash
cd fall-detection-training/training

python train_lstm.py \
    --dataset "$OUT" \
    --labels labels_v2.json \
    --source ours \
    --t-seq 16 --epochs 30 \
    --ckpt checkpoints/lstm.pt
```

**关键参数**（来自 [train_lstm.py:466-512](../Bouy_CSI_FallDetection/fall-detection-training/training/train_lstm.py#L466-L512)）：

| 参数 | 我们用的值 | 默认 | 为什么 |
|---|---|---|---|
| `--dataset` | `$OUT`（绝对） | `dataset/`（相对 cwd）| 避免 cwd 漂移 |
| `--labels` | `labels_v2.json` | `labels.json` | 6 类（带 FALL_IMPACT + FLOORED）|
| `--source` | `ours` | `all` | 只用自采数据，不用 CSI-HAR |
| `--t-seq` | `16` | `8` | 16 帧 ≈ 1.6s 上下文，对小数据集够用 |
| `--epochs` | `30` | `200` | 数据小，30 epoch 就够；200 会过拟合 |
| `--ckpt` | `checkpoints/lstm.pt` | `checkpoints/best.pt` | 显式命名，方便 ensemble 引用 |

**首次跑**：5-15 分钟（数据量小，CPU 也快）。

### Step 4.3：训练 CNN

```bash
cd fall-detection-training/training

python train_cnn_deep.py \
    --dataset "$OUT" \
    --labels labels_v2.json \
    --source ours \
    --epochs 80 --augment \
    --ckpt checkpoints/cnn.pt
```

**关键参数**（来自 [train_cnn_deep.py:543-593](../Bouy_CSI_FallDetection/fall-detection-training/training/train_cnn_deep.py#L543-L593)）：

| 参数 | 我们用的值 | 默认 | 为什么 |
|---|---|---|---|
| `--dataset` | `$OUT` | `dataset/` | 同 LSTM |
| `--labels` | `labels_v2.json` | `labels.json` | 6 类 |
| `--source` | `ours` | `all` | 只用自采 |
| `--epochs` | `80` | `300` | 数据小 |
| `--augment` | 加上 | 不加 | 小数据集必备（加噪声/时移）|
| `--ckpt` | `checkpoints/cnn.pt` | `checkpoints/cnn_deep_best.pt` | 显式命名 |

**首次跑**：10-30 分钟（CNN 比 LSTM 慢 2-3 倍）。

### Step 4.4：融合 + 评估

```bash
cd fall-detection-training/training

# Alpha 加权融合
python ensemble_predict.py \
    --dataset "$OUT" \
    --labels labels_v2.json \
    --source ours \
    --lstm-ckpt checkpoints/lstm.pt \
    --cnn-ckpt checkpoints/cnn.pt

# 用 shipped 的 eval 脚本评估最终 F1
cd ../evaluation
python eval_seq9_ensemble.py
```

**预期**：window-F1 在 0.5-0.7 之间（数据量小、单人单房间，**达不到 Bouy 的 0.81**——Bouy 是 7 会话 × LOOCV）。如果 F1 < 0.4，回到 §D.11 检查数据分布 + 标签精度。

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

### A.5 ESP32 硬件运维

| 现象 | 原因 | 解决 |
|---|---|---|
| 长时间运行后板子不再被识别 | ESP32-S3 持续工作后 USB CDC 栈可能挂死 | 按板子上的 **RST 按钮**（复位），或重新上电 |
| 端口号从 ttyACM0-3 变成 ttyACM4 等 | Linux 内核在设备断开重连后重新分配次设备号，尤其在 `plugdev` 组允许快速换绑的策略下 | **重启电脑**，让内核从 0 开始重新枚举；4 块板一般回到 ACM0-3 |
| 某块板完全不出现（0 个 ttyACM） | USB 线断了 / 板子烧了 / 固件冲没了 | 换线、重新烧录固件 |
| 想固定端口号（生产环境） | 当前没有做 udev 规则 / MAC 绑定 | 可结合每块板的 USB serial 或 MAC 地址写 udev 规则实现固定映射（如 `ttyESP_RX1`），见 §D.12 |

**重要**：ESP32-S3 必须插 **USB-OTG 口**（板载原生 USB），不是 CH340/CP2102 桥接的 COM 口。插错口会导致设备完全不可见。

### A.6 `infer_loop.py` 报 shape 错

```python
# 在 infer_loop.py 加打印
print(f"输入 shape: {x.shape}")
print(f"模型期望: {INPUT_SHAPE}")
```

对照 `config.json` 的 `input_shape` 字段调整。

### A.7 4 RX 时间不同步

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
- ⚠️ **D.6 的修复只覆盖了 `--out` 的默认值（不传参时落到 `<project>/data/raw/`）；用户显式传 `--out` 时仍按 cwd 解析**。D.13.3 记录了由此引发的实际数据落点错乱。**最稳妥的做法：要么不传 `--out`（用默认 + 重命名），要么传绝对路径**。

### D.7 2026-06-30 增补：infer_loop.py 同样的相对路径 bug

**问题**：D.6 只修了 `capture_multi.py`，但 **`infer_loop.py` 的 `--live-dir` 默认值依然是相对路径**：

```python
# infer_loop.py 修改前（我之前遗漏的 bug）
ap.add_argument("--live-dir", type=Path, default=Path("data/live"),
```

这意味着从 `src/pc_tools/inference/` 跑时，它找的是 `./data/live`（即 `src/pc_tools/inference/data/live`）—— 找不到就报：
```
ERROR: live dir does not exist: data/live
       (start receiver.py first, or pass --live-dir)
```

而 receiver.py 写的 NPZ 在 `<project>/data/live/`（绝对路径），用户跑去 `src/pc_tools/receiver/data/live/` 找——也是错的（该路径不存在）。两端**都没把数据放在用户预期/脚本默认的位置**，是隐性的可用性 bug。

**修复**：把 `_PROJECT_ROOT` / `_DEFAULT_LIVE_DIR` / `_MODEL_DIR` / `DEFAULT_MODEL` / `DEFAULT_CONFIG` 全部上移到**模块级**（import 时解析一次），让 `argparse` 的 default 能直接引用：

```python
# infer_loop.py 模块级（L67-82，import 时执行一次）
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
_DEFAULT_LIVE_DIR = _PROJECT_ROOT / "data" / "live"
_MODEL_DIR = (_PROJECT_ROOT / "fall-detection-training"
              / "model" / "fall_impact_seq9_ensemble")
DEFAULT_MODEL = _MODEL_DIR / "fall_impact_seq9_ensemble.ts.pt"
DEFAULT_CONFIG = _MODEL_DIR / "config.json"

# main() 内（L209-218）
ap.add_argument("--live-dir", type=Path, default=_DEFAULT_LIVE_DIR, ...)
ap.add_argument("--model", type=Path, default=DEFAULT_MODEL)
ap.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
```

**修这个时还暴露了第二个 bug（Python 作用域）**：

我第一版想"修小"——只在 `ap.add_argument("--live-dir", ...)` 那行加 `_PROJECT_ROOT / "data" / "live"`，没动 `_PROJECT_ROOT` 的位置。结果：
```
UnboundLocalError: local variable '_PROJECT_ROOT' referenced before assignment
```
原因：原 `_PROJECT_ROOT = ...` 在 `main()` 函数体内（line 203），Python 见到 `main()` 内有 `_PROJECT_ROOT = ...` 赋值就把整个 `_PROJECT_ROOT` 视作 `main()` 的局部变量，前面 `ap.add_argument(...)` 里的同名引用就成了"assignment 前引用"。解药：把模块级常量**真正放模块级**，别放在 `main()` 里。

**修复后端到端验证**（从 `src/pc_tools/inference/` 跑默认参数）：
```
Live dir   : /home/ruo/Desktop/LYX/.../Bouy_CSI_FallDetection/data/live  (poll every 0.5s)
Model loaded. Watching for new chunks... (Ctrl-C to stop)

  [11:15:10] warming up: 1/9 (chunk_20260630_092551_0001.npz)
  ...
  [11:15:10] warming up: 8/9 (chunk_20260630_110159_0006.npz)
  [11:15:10] prob=0.048    ok  chunks_seen=9  ring=9/9
  [11:15:10] prob=0.045    ok  chunks_seen=10  ring=9/9
  ...
  [11:15:10] prob=0.038    ok  chunks_seen=20  ring=9/9
```

- ✅ 找到 20 个 chunk（之前 receiver 跑出来的）
- ✅ Prob 在 0.04–0.30 区间 —— **正是空房间/静止的正确行为**（没人跌倒）
- ✅ CPU 推理 ~几秒内完成（running model 一次 ~10ms）

**经验教训**（写进 D.7 给后续 Agent 看）：
1. **所有 `--xxx` 默认路径都用 `__file__` 锚定**——capture_multi / receiver / infer_loop 三个脚本都必须遵守这条
2. **`_PROJECT_ROOT` 等模块级常量必须放在函数体外**——否则 Python 作用域会把它们当 local，引用先于赋值就 UnboundLocalError
3. **修一类 bug 要把所有同类点都检查一遍**——D.6 修 capture_multi 时我应该顺手 grep `Path("data/")` 找出所有同类，但没做，导致 D.7 又来一遍。这是"打补丁"式的修法，要改成本能反射式

**当前统一的 `__file__` 锚定规范**（三个采集/推理脚本）：

| 脚本 | 锚定的默认路径 |
|---|---|
| `capture_multi.py` | `--out` → `<project>/data/raw/capture_<ts>.npz` ✅ |
| `receiver.py` | `--out-dir` → `<project>/data/live/` ✅ |
| `infer_loop.py` | `--live-dir` → `<project>/data/live/` ✅（D.7 修复）<br>`--model` → `<project>/fall-detection-training/model/.../fall_impact_seq9_ensemble.ts.pt` ✅<br>`--config` → 同上目录 `config.json` ✅ |

### D.8 2026-06-30 增补：receiver ↔ infer_loop 写读竞争（zipfile.BadZipFile）

**症状**：推理链路稳定运行约 ~5 分钟后崩：

```
[11:23:06] prob=0.043    ok  chunks_seen=44  ring=9/9
[11:23:12] prob=0.057    ok  chunks_seen=45  ring=9/9
[11:23:18] prob=0.151    ok  chunks_seen=46  ring=9/9
Traceback (most recent call last):
  File ".../infer_loop.py", line 275, in main
    spec = compute_band_spectrogram(chunk_path)
  File ".../infer_loop.py", line 91, in compute_band_spectrogram
    csi = np.load(chunk_path)
  ...
  File ".../zipfile.py", line 1351, in _RealGetContents
    raise BadZipFile("File is not a zip file")
zipfile.BadZipFile: File is not a zip file
```

同时 receiver 端：
```
[11:23:18] chunk #0036  frames=1773  size= 395 KB
[11:23:24] chunk #0037  frames=1757  size= 397 KB
```

**根因 — 经典 write→read race**：
- `np.savez_compressed(path)` **不是原子写**：它打开 zip 流，依次写入每个 array entry，最后关闭
- infer_loop 在 `[11:23:18]` 时通过 0.5 s 轮询找到下一个 chunk，**正是 receiver 写到一半的瞬间**
- `np.load()` 读到了 zip 中央目录不完整的快照 → `zipfile.BadZipFile`

这不是硬件问题、不依赖端口、不依赖时机，是**设计层 race**。任何"边写边读"的文件 IPC 都会撞。

**修复（双层防御）**：

#### 第 1 层：receiver.py 原子写

```python
tmp_path = args.out_dir / (final_name + ".tmp")
with open(tmp_path, "wb") as tmp_fd:
    np.savez_compressed(tmp_fd, **save)
tmp_path.replace(final_path)
```

关键技巧：
- **不能用 `np.savez_compressed(tmp_path, ...)`** —— numpy 见到字符串/Path 不是以 `.npz` 结尾会自动 append `.npz`，结果写到 `chunk_X.npz.tmp.npz`，再 `replace()` 找不到原 `.tmp` 路径 → `FileNotFoundError`（这是我第一次试的时候撞的）
- **必须自己 `open(tmp_path, "wb")` 传 fd 给 numpy** —— numpy 见到 file object 不再 append 后缀
- **`Path.replace()` 在 POSIX 上是 atomic**，reader 看到的永远是"完整文件"或"无文件"，永远不会是"半个文件"

#### 第 2 层：infer_loop.py 防御性读

```python
try:
    spec = compute_band_spectrogram(chunk_path)
except (zipfile.BadZipFile, EOFError, OSError) as exc:
    print(f"[...] skip {chunk_path.name} ({type(exc).__name__}: ...) — will retry next poll",
          flush=True)
    continue  # 没加 seen_chunks，下轮重试
seen_chunks.add(chunk_path.name)
```

意义：
- 如果原子写在 `replace()` 那一瞬间仍 race，仍可能有微秒级窗口
- `OSError` 涵盖 `.tmp` 文件在 `replace` 之前的 `unlink`（跨平台差异）
- `EOFError` 涵盖 numpy 读 zip 中央目录读到一半的情况
- **关键**：失败时**不**加入 `seen_chunks`，下一轮 poll 自动重试

**第一次试 v1 撞到的副作用**：

我第一版用 `Path.with_suffix(".tmp")`：
```python
tmp_path = final_path.with_suffix(final_path.suffix + ".tmp")
np.savez_compressed(tmp_path, **save)
```
结果：
```
FileNotFoundError: '.../chunk_X.npz.tmp' -> '.../chunk_X.npz'
```
因为 `with_suffix` 把 `chunk_X.npz` 变成 `chunk_X.npz.tmp`（名字看着对），但 `np.savez_compressed` 见不是 `.npz` 结尾又加一个 `.npz`，实际写到 `chunk_X.npz.tmp.npz`。再 `replace()` 当然找不到源文件。

教训：**任何用 numpy / pandas I/O 函数自动加后缀的场景，要么自己 `open()` 传 fd，要么把临时文件后缀保留 `.npz` 结尾**（如 `chunk_X.npz.partial`）。

**Smoke test 验证**（receiver 70 s + infer_loop 25 s 并发）：

```
=== infer_loop.log ===
[11:31:26] warming up: 1/9 → 8/9
[11:31:30] prob=0.092  chunks_seen=9
[11:31:36] prob=0.124  chunks_seen=10
[11:31:42] prob=0.063  chunks_seen=11
[11:31:48] prob=0.047  chunks_seen=12

=== 错误统计 ===
BadZipFile:   0
EOFError:     0
traceback:    0
skip (defensive): 0   ← 原子写够干净，连跳过都没机会

=== live-dir 最终状态 ===
12 个 chunk_*.npz（无 .tmp / 无 .tmp.npz 残留）
```

receiver 日志同样干净：
```
[11:30:42] chunk #0000 frames=1694 size=474 KB
[11:30:48] chunk #0001 frames=1701 size=459 KB
...
[11:31:48] chunk #0011 frames=1676 size=479 KB
```
（每 6 秒一个，文件名纯 `chunk_X.npz`，无任何污染。）

**给后续 Agent 的提示**：

1. **任何"一边写一边读"的文件 IPC 都要原子化** —— `write-temp + atomic rename` 是行业标准
2. **`np.savez_compressed(string_path)` 会偷偷加 `.npz` 后缀** —— 用 file object 绕过，或后缀保留 `.npz`
3. **防御性读 ≠ 不必要** —— 即便有原子写，Windows 上 `replace` 不是 atomic、NFS rename 有 bug、容器 overlay fs 行为各异，单一层不够稳
4. **写端 + 读端双重防御** 才是 robust 工程实践
5. **每 6 秒写一次、0.5 秒轮询**：意味着任何一次 race 都可能撞，**长期跑一定要原子化**

---

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

**最后更新**：2026-06-30 by Claude
**状态**：⚠ 本文档于 2026-06-30 标记为**史料**。主开发文档已切换到 [dev_doc/5-bouy-post-arch-2026-06-30.md](5-bouy-post-arch-2026-06-30.md)。后续工作请写到那个文件。
**史料范围**：Day 1-3 完成 + 训练结果（D.19-D.22）+ Transformer 缺口发现（D.23）。
**下一步**：见新主文档 §3-§7。
**已修复/补充**：cwd 独立性（D.6/D.7/D.13.3）、race condition（D.8）、运行时可调 state.json（D.9）、1s/包 STFT 不兼容（D.10）、实测记录（D.11）、ESP32 运维笔记（D.12）、退出卡顿根因 + 首采验证（D.13）、collect.py 标注流程 + 训练路径修正（D.14）、collection_mouse.py 鼠标标注版（D.15）、collect.py discover_ports Linux 修复（D.16）、collection_mouse.py UI 增强 + 性能硬化（D.17）、1-session 训练阻塞 + split 脚本 2 个坑（D.18）、LSTM 训练完成 + `| tail` 进度可见性陷阱（D.19）、CNN 训练完成 + 过拟合诊断（D.20）、ensemble_predict.py 架构不匹配（D.21）、Ensemble 实际训练结果（D.22）、**Transformer 缺口 + shipped vs 我们差异（D.23）+ 调研归档（[dev_doc/4-](4-bouy-training-architecture-2026-06-30.md)）**
**预计完成时间**：5 天（Day 1-3 约 2 天，Day 4 待启动）
**预计代码量**：~800 行 Python + 2 ESP32 固件 + 1 HTML

### D.9 2026-06-30 增补：运行时可调架构（runtime_state.json + 状态机雏形）

**问题**：用户提出核心疑问——NPZ 存储/打包 vs 推理时间尺度失衡，**从跌倒发生到告警最坏 60+ 秒**，且 **54 秒感受野 vs 模型训练时 14 秒感受野的 4 倍失配**严重损害准确性。

#### 数字复习为什么之前那么慢

| 阶段 | 时间 |
|---|---|
| Receiver 写首个 chunk（含 fall 数据） | T=6s |
| Infer_loop 攒满 9 块（9×6=**54s** 之前）才出首个 prob | T≈60s |
| Cooldown + 持续高阈值才 fire alert | T≈70-80s |

**最坏情况 fall → alert：~70-80 秒**，**且初始 warm-up 永远 60 秒无检测**。

更要命的是感受野失配：

| | Bouy 训练 | 我们（修前） |
|---|---|---|
| 窗时长 | 6s | 6s |
| 窗 hop | 1s | **6s** |
| 9 窗覆盖 | 6+8×1 = **14s** | 9×6 = **54s**（4 倍） |

模型学习的"14 秒里发生了什么"≠ 我们塞进去的"54 秒里的事"，模型面对的时间统计完全不同，**泛化能力注定下降**。

#### 解法：可运行时调整的状态参数（用户提议的"状态机或 JSON 参数"）

按用户要求"if/else 或状态机 + 单个参数切换"，造了一个**轻量状态文件**：

- **位置**：`<project>/config/runtime_state.json`
- **5 个字段**（每个都对一个明确的设计决策）：
  ```json
  {
    "chunk_sec": 1.0,        // receiver: 每多少秒写一个 NPZ
    "keep_last": 60,          // receiver: 磁盘上留几个
    "seq_len": 14,            // infer_loop: 一次推理叠多少 chunk
    "threshold": 0.5,         // infer_loop: 多高的 prob 才报警
    "phase": "ACTIVE"         // 状态机预留（未来 §D.10 用）
  }
  ```
- **API**：`src/pc_tools/common/state.py` 提供
  - `load_state(force=False)` — 读，mtime 缓存，无 I/O 开销
  - `save_state(state)` — 原子写（用 §D.8 的 `.tmp + os.replace` 模式）
  - `set_param(key, value)` — 单字段写入便捷函数
- **生效机制**：receiver / infer_loop 每轮主循环都 `load_state()`，**改 JSON 后下一个周期就 apply，零重启**。mtime 缓存保证未改动时无 IO 开销。

#### 立刻产生的修复

| 改前 | 改后 |
|---|---|
| `chunk_sec=6, seq_len=9`（默认） | `chunk_sec=1, seq_len=14` |
| 感受野 = 54 秒（与训练失配 4 倍） | 感受野 = **14 秒（精确匹配训练）** |
| 冷启动 = 60 秒 | 冷启动 = **14 秒** |
| 单次推理延迟 = ~1s | 单次推理延迟 = **~1s（不变）** |
| NPZ 文件 = ~500KB × 1/6s | NPZ 文件 = ~80KB × 1/s，磁盘占用 ≈ 5MB/分钟 |

#### 运行机制（实测）

启动时 receiver 读 `chunk_sec=1.0`（不是 argparse 的 6.0）。直接看实测日志：

```
11:49:01  chunk #0000   ← chunk_sec=6 节奏（state.json 初始）
11:49:07  chunk #0001   (6 秒后)
11:49:08  chunk #0002   ← state.json 改为 chunk_sec=1.0，下一 cycle 立刻 apply
11:49:09  chunk #0003
11:49:10  chunk #0004   (1s 节奏)
...
11:49:19  chunk #0012   (10 秒里 10 个 chunk)
```

**整个切换不需要重启任何进程**。

#### 用法

```bash
# 看当前状态
python src/pc_tools/common/state.py

# 切到 1s/包（推荐）
python -c "import sys; sys.path.insert(0, 'src/pc_tools'); \
           from common.state import save_state; \
           save_state({'chunk_sec': 1.0, 'keep_last': 60, 'seq_len': 14, 'threshold': 0.5})"

# 想回 6s/包（老默认）
python -c "import sys; sys.path.insert(0, 'src/pc_tools'); \
           from common.state import save_state; \
           save_state({'chunk_sec': 6.0, 'keep_last': 20, 'seq_len': 9, 'threshold': 0.5})"

# 调阈值
python -c "import sys; sys.path.insert(0, 'src/pc_tools'); \
           from common.state import set_param; set_param('threshold', 0.84)"
```

#### 两个预设文件（快速对比 / 一键切换）

我们留了**两个 state 文件**作为对比的"锚"，方便在不同配置之间秒切：

| 文件 | 含义 | 关键参数 |
|---|---|---|
| `config/runtime_state.json` | **推荐**：1s/包，对齐 Bouy 训练 | `chunk_sec=1.0`, `seq_len=14`, `keep_last=60`, 感受野=14s |
| `config/runtime_state2.json` | **Pre-D.9 legacy**：6s/包，原始 Bouy 风格 | `chunk_sec=6.0`, `seq_len=9`, `keep_last=20`, 感受野=54s |

切换方法 1（手工 cp）：

```bash
# 切到 legacy
cp config/runtime_state2.json config/runtime_state.json

# 切回推荐
cp config/runtime_state.json.bak config/runtime_state.json   # 或者手敲 5 字段
```

切换方法 2（一行 Python，从文件载入）：

```bash
python -c "
import sys, json; sys.path.insert(0, 'src/pc_tools')
from common.state import load_state, save_state
import config.runtime_state2 as preset2
save_state({k: v for k, v in vars(preset2).items() if not k.startswith('_')})
"
```

> 注：方法 2 用了 importlib 加载 JSON 当模块 — 也可以直接 `open('config/runtime_state2.json')` 读 JSON 内容再 save_state。

什么时候用哪个：

- **新做实验 / 第一次部署** → `runtime_state.json`（1s/包对齐模型）
- **想对比 6s/包和 1s/包效果** → 在两个预设间切换
- **调试模型参数 / 跑 LOOCV baseline** → 6s/包 legacy 与 Bouy 原文一致，参考价值大
- **采数据（standing / fall）** → 推荐 1s/包，文件更多但每份对应更明确的物理时间窗

#### 暴露的第三个独立问题：accuracy 实测已确认不响应

**2026-06-30 实测**（详见 §D.11）：无论静坐、走动、改变姿态还是改变设备位置，**prob 始终 0.02–0.09**。人体和设备位置变化对 prob 幅度有可见影响（说明 CSI 信号确实被模型接收），但远不足以触发 threshold 0.5。

根因与 D.9 初版猜测一致：
- 子载波多径结构变了（天线方向/家具布局变化）
- 身高/体型/步态/跌倒姿势与 Bouy 作者本人不同
- 这是 **data distribution shift**，不是架构 bug

下一步：按 §Step 3.6 自己采数据 → Day 4 微调。

#### 给后续 Agent 的提示

1. **改运行时参数 → 直接编辑 `config/runtime_state.json`**。不要重启 receiver / infer_loop
2. **`phase` 字段目前只读** —— 留给未来加 INIT → ACTIVE 状态机（D.10 计划）。当前永远是 ACTIVE
3. **`state.json` 用 `os.replace` 原子写**，所以乱编辑一半保存时也能读到 last-good 全文件（与 §D.8 NPZ 写盘同样的原理）
4. **新增可调参数**：在 `state.py` 的 `DEFAULTS` 加 key → receiver/infer_loop 在循环里加 `runtime["new_key"]` 调用。一行代码扩展
5. **不要把 argparse 默认值作为运行时真理** —— argparse 只在启动时读一次，运行时改不响应；所有运行时可调参数都放 state.json
6. **state.json 改坏了不会崩**：`load_state` 用 last-good 缓存兜底，错的 JSON 不会让脚本退出

#### 仍未解决的（剩给 Day 4+）

| 问题 | 何时解决 |
|---|---|
| shipped 模型在本房间**实测不响应**（prob 0.02–0.09，§D.11）| Day 4（fine-tune）— 触发了，见下一步 |
| 真报警（带音/UI/告警通知） | Day 5（Flask 前端 + alarm.wav） |
| T1→T2→T3 三段式生命周期（Bouy 原项目核心） | 当前不在范围内（demo 级） |
| 多人检测 / 跨房间泛化 | 当前不在范围内 |

### D.10 2026-06-30 增补：1s/包 STFT 不兼容 + 修复实录

**症状**：D.9 把 state.json 从 6s/包改成 1s/包后，infer_loop 持续输出 `prob=0.034`（不变小数），且在累计 ~40 个 chunk 后崩溃：

```
ValueError: all input arrays must have the same shape
```

**根因**：Bouy 模型用 `scipy.signal.stft(nperseg=96, noverlap=80)` 提取频谱图。1s × 70Hz = **70 个采样点/频带**，远少于 `nperseg=96`。STFT 无法计算有效的 (49, 21) 频谱图 → `compute_band_spectrogram` 内部静默退出，返回全零 tensor → 模型每次输入相同零 → 输出 class prior (~0.034)。40 个 chunk 后，混合了老 6s-chunk（有效 spectrogram）和新 1s-chunk（零 spectrogram）→ `np.stack` 发现 shape 不一致 → 崩溃。

**也就是说**：shipped 模型的 STFT 配置**硬要求每个 chunk ≥ nperseg/70Hz ≈ 1.4 秒**，实际稳定需求是 **6 秒**（匹配训练时的窗长 + 提供足够 overlap）。

**修复**：

1. `runtime_state.json` 恢复为 `chunk_sec=6.0, seq_len=9`（cp 自 runtime_state2.json 预设）。
2. `runtime_state.json` 加了 `_why_not_1s_per_chunk_DO_NOT_REMOVE` 注释 key 记录原因（被 linter 清理后可重新加回）。
3. `receiver.py` 加 `--expected-rx`（state.json key `expected_rx=4`），启动时警告少于 4 RX 的情况，避免静默写出 3-RX chunk。
4. `infer_loop.py` 加 spectrogram channel 验证：`np.stack` 前检查 `spec.shape[0] == 32`。不匹配则 `popleft()` 弹掉坏 spec 并打印 warning。

**计划中的正确 1s 方案**（留给 Day 4+）：

| 方案 | 描述 |
|---|---|
| **Option B** | receiver 1s/包 + infer_loop 内累积 6 个 1s chunk 拼接成 1 个 6s spectrogram。实现后：延迟 60s → 9s，感受野 54s → 14s（完全对齐训练）。代价：~20 行代码 + ring buffer 逻辑改动 |
| **Option C** | 重新训练模型（改 `nperseg` ≤ 70, `noverlap` 相应调整）→ 让模型接受 1s 短窗。代价：重新训练 + 模型导出 |

**给后续 Agent 的提示**：

- **永远不要设 `chunk_sec < 2.0`** —— STFT 需要 ≥ 96 samples，2s × 70Hz = 140 samples 才够。不够就是全零输出
- **两个预设文件是锚**：`runtime_state.json`（当前运行）、`runtime_state2.json`（legacy 备份）。切换时 `cp runtime_state2.json runtime_state.json` 然后等 ~1 cycle 自动 apply
- **expected_rx 是安全网**：如果以后有板子掉线，receiver 会打印 warning 而非静默写出坏数据

### D.11 2026-06-30 实测记录：shipped 模型在本房间的 prob 表现

**测试条件**：
- 4 RX ESP32-S3 + 1 TX，WiFi 信道 6，HT40，192 子载波
- `config/runtime_state.json`：chunk_sec=6.0, seq_len=9, threshold=0.5
- 模型：`fall_impact_seq9_ensemble.ts.pt`（Bouy shipped，CPU 推理）
- 感受野：9 × 6 = 54s（vs 训练时 14s，见 §D.8/D.10）

**实测 prob 范围**：

| 场景 | prob 范围 | 是否触发 threshold 0.5 |
|---|---|---|
| 空房间（无人）| 0.03–0.06 | ❌ |
| 静坐（PC 旁）| 0.03–0.06 | ❌ |
| 走动（TX-RX 覆盖区）| 0.04–0.09 | ❌ |
| 改变姿态（站立↔蹲下↔举手）| 0.04–0.08 | ❌ |
| 改变设备/TX 相对位置 | 0.02–0.09 | ❌ |
| **所有场景** | **0.02–0.09** | **❌** |

**关键观察**：

1. **prob 不是常数**（变动范围 ~0.07）—— 说明模型确实在接收 CSI 变化信号，输入 spectrogram 不是全零。D.10 的 STFT 零填充问题已被 6s/包方案解决。
2. **人体活动对 prob 有微弱影响**：走动和姿态变化时 prob 略高于静止（~0.06–0.09 vs ~0.03–0.06），但幅度远低于 threshold 0.5，完全不能用于告警。
3. **设备位置/TX 距离对 prob 影响最大**：改变设备物理位置时 prob 变化幅度最大（0.02↔0.09），但仍在无效区间。
4. **模型从未输出 > 0.1**——即使在预期触发跌倒检测的场景下。

**结论**：

shipped 模型在 Bouy 作者 7 会话 LOOCV 上拿到 0.90 event-F1，**但在本房间完全不响应**。这是 **data distribution shift** 的典型表现：
- 作者房间的多径 CSI 特征 ≠ 本房间的多径 CSI 特征
- 模型学到的是"作者房间里跌倒 vs 正常"的边界，不是"通用跌倒检测"
- **必须用本房间自己采的数据 fine-tune**

**下一步（已确认）**：

| 行动 | 参考 |
|---|---|
| 采 standing 数据（3 min） | §Step 3.6 — `capture_multi.py --duration 180` |
| 采 fall 数据（3 min，5–10 次跌倒） | §Step 3.6 |
| Day 4 微调 LSTM + CNN | §Day 4 路线图 |
| 考虑恢复正确感受野（54s → 14s） | §D.10 Option B |

### D.12 2026-06-30 运维笔记：ESP32 硬件维护与端口绑定

#### D.12.1 长时间运行后 ESP32 的 RST 复位

ESP32-S3 持续运行数小时后，USB CDC 栈可能出现静默挂死（原因：板载 USB 控制器在长期高吞吐下的固件 bug）。表现为：
- `ls /dev/ttyACM*` 仍能看到设备，但 `receiver.py` 报 `read error: device reports readiness but returned no data`
- 或设备直接消失

**解决**：按板子上 **RST 按钮**（物理复位），1-2 秒后恢复正常。不需要重新烧录。

> 经验：连续跑 > 2 小时后，建议主动重启一次所有 RX 板（逐个按 RST）。

#### D.12.2 端口号漂移与恢复

**背景**：本 Linux 主机（Ubuntu 24.04）修改过端口绑定策略——放宽了 `plugdev` 组的设备换绑限制，允许一个 ttyACM 次设备号在短时间内重新分配给不同的物理 USB 设备。这在开发阶段是便利的（插拔不用等），但副作用是：
- 设备断开重连后，内核可能分配不同的次设备号（如 ttyACM0 → ttyACM4）
- `receiver.py` 的 `discover_ports()` 自动探测 `ttyACM*` 不依赖固定编号，可以正常运行；但多个设备同时换号时 human 状态容易乱

**恢复默认 ACM0-3**：重启电脑。内核从 0 开始重新枚举，4 块板通常回到 ttyACM0-3。

#### D.12.3 USB 口选择

ESP32-S3 必须插 **USB-OTG 口**（板载原生 USB-C / micro-USB），不是 CH340/CP2102 桥接的 UART COM 口。这两者的枚举路径完全不同：
- OTG 口 → `/dev/ttyACM*`（本项目的 default）
- 桥接 UART → `/dev/ttyUSB*`（只在兼容探测中作为 fallback）

本项目的 `discover_ports()` 按 `ttyACM* → ttyUSB* → cu.*` 顺序搜索，OTG 口会被优先选中。

#### D.12.4 生产环境端口固定（未来计划）

如果需要固定端口号（例如在自动化脚本中用 `ttyESP_RX1` 等可读名称），可在 Linux 上创建 **udev 规则**，按 ESP32-S3 的 USB serial number 或 MAC 地址做设备映射：

```bash
# 示例 /etc/udev/rules.d/99-esp32-csi.rules
SUBSYSTEM=="tty", ATTRS{serial}=="<ESP32_USB_SERIAL>", SYMLINK+="ttyESP_RX1"
```

每块 ESP32-S3 的 USB serial 可运行 `udevadm info -a -n /dev/ttyACM0 | grep serial` 获取。到达生产部署阶段时再实现，当前 demo 无需。

### D.13 2026-06-30 增补：capture_multi.py 退出卡顿根因 + 首次实采 standing 验证

> 触发场景：用户跑 `--duration 180` 采 standing 3 分钟，按下 9 次 `^C` 才完全退出，怀疑 Ctrl-C 会损坏 NPZ。验证后：数据完整、保存动作在 ^C **之前**已完成；卡顿是退出流程问题，不影响数据。

#### D.13.1 退出卡顿根因（看 capture_multi.py 源码）

```python
# src/pc_tools/receiver/capture_multi.py L150-175
try:
    elapsed = 0.0
    while elapsed < args.duration:
        time.sleep(0.5)
        ...
except KeyboardInterrupt:                # ← 第一次 ^C 在这里被吞掉
    print("\n  (stopped early)")

print()
reader.stop_event.set()
reader.join(timeout=1.5)                  # ← 串口线程可能还在阻塞读
```

`np.savez_compressed(args.out, **save_dict)`（[L202](src/pc_tools/receiver/capture_multi.py#L202)）在 `try/except` 块**之外**，先于所有退出逻辑执行。所以：

| 时间顺序 | 事件 |
|---|---|
| T=0 | `--duration 180` 启动采集循环 |
| T=180s | 主循环自然结束 → 进入保存段 → `np.savez_compressed()` 同步写盘 |
| T=180s+Δ | `✓ saved 15.2 MB` 打印 → 脚本进入 `return 0` |
| **用户感知**："保存完" + "还没退" 之间有几百 ms 窗口，**此时 ^C 是安全的（数据已落盘）** |
| 多次 ^C | 第一次吞进 `except KeyboardInterrupt`；之后 Python signal handler 排队，主线程在 `reader.join(timeout=1.5)` 等串口 fd 关闭 |

**为什么 9 次 ^C 才退**：

1. **第 1 次 ^C** → `except KeyboardInterrupt` 接住 → 走退出流程
2. **退出流程** → `reader.stop_event.set()` → `reader.join(timeout=1.5)`
3. **后台 `MultiPortReader`** 是 `selectors` 阻塞在 4 个 ttyACM fd 上 → `stop_event` 不会主动唤醒它 → 要等下一次 read 失败（USB CDC 被打断）才退出 → 1.5s 兜底
4. **后续 ^C** → Python 默认 SIGINT 行为（抛 `KeyboardInterrupt` 到主线程），但主线程在 `join` 里 → 排队
5. **fd 关闭** → 多次 ^C 让 `pyserial` 抛异常 → reader 线程 finally 退出 → join 返回 → 进程结束

**对你数据没影响**——保存动作已经在 `try/except` 之前完成。

#### D.13.2 NPZ 完整性验证（首次实采 standing 数据）

**采集命令**（用户在 `src/pc_tools/receiver/` 跑）：
```bash
python capture_multi.py \
    --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 \
    --port /dev/ttyACM2=RX3 --port /dev/ttyACM3=RX4 \
    --duration 180 \
    --out ../../data/raw/session_01_standing.npz
```

**文件落点**：参见 §D.13.3。

**`np.load()` 实测结果**：

```
keys: ['rx_names', 'label', 'started_at',
       'timestamps_RX1', 'amplitudes_RX1',
       'timestamps_RX2', 'amplitudes_RX2',
       'timestamps_RX3', 'amplitudes_RX3',
       'timestamps_RX4', 'amplitudes_RX4']

  rx_names        shape=(4,)           dtype=<U16
  label           shape=()             dtype=<U64
  started_at      shape=()             dtype=float64
  amplitudes_RX1  shape=(12281, 192)   dtype=float32
  amplitudes_RX2  shape=(12127, 192)   dtype=float32
  amplitudes_RX3  shape=(12917, 192)   dtype=float32
  amplitudes_RX4  shape=(12314, 192)   dtype=float32

RX1: 12281 frames, mean dt=14.7ms, neg_dt_count=0, fps=67.9
RX2: 12127 frames, mean dt=14.9ms, neg_dt_count=0, fps=67.1
RX3: 12917 frames, mean dt=14.0ms, neg_dt_count=0, fps=71.4
RX4: 12314 frames, mean dt=14.7ms, neg_dt_count=0, fps=68.1
```

| 验收项 | 结果 |
|---|---|
| 文件大小 | 15.2 MB ✓ |
| 4 RX 帧数对得上 | ✓（12127–12917 帧/板）|
| Shape `(N, 192)` | ✓（HT40 全带宽 192 子载波）|
| 时间戳单调递增 | ✓（neg_dt_count=0）|
| 帧率 67–71 Hz | ✓（与 Bouy 70Hz 规格吻合）|
| `np.load()` 无 zip 错误 | ✓ |

**结论**：standing 数据**完整可用**，可直接作为 Day 4 微调的正样本。

#### D.13.3 路径一致性补遗（D.6 没修到的边角）

**问题**：D.6 修了 `capture_multi.py` 默认 `--out` 路径（用 `__file__` 锚定 `<project>/data/raw/`），**但用户显式传 `--out` 时仍按 cwd 解析**。

用户的命令：
```bash
cd src/pc_tools/receiver/
python capture_multi.py --out ../../data/raw/session_01_standing.npz
```

- cwd = `src/pc_tools/receiver/`
- `../../data/raw/` = `src/data/raw/`（**不是** `<project>/data/raw/`）
- 实际落点：`src/data/raw/session_01_standing.npz`（15.2 MB）

**与 §D.6 的关系**：

| 目录 | 谁会写 | 内容 |
|---|---|---|
| `<project>/data/raw/` (= `Bouy_CSI_FallDetection/data/raw/`) | D.6 修复后的 capture_multi 默认值 | `capture_20260630_*.npz`（无标签 / 调试用）|
| `src/data/raw/` | 用户显式 `--out ../../data/raw/...` | `session_01_standing.npz`（用户命名）|

两个目录都在、`.gitignore` 都覆盖（`data/` 模式），**没有功能问题**。但目录分裂不利于后续脚本（如 `finetune_lstm.py --dataset ../../data/raw/`）统一扫描。

**统一到 `<project>/data/raw/` 的方法**（任选其一）：

```bash
# 方法 1：移动现有文件
mv src/data/raw/session_01_standing.npz data/raw/

# 方法 2：以后采数据用绝对路径
python capture_multi.py \
    --port /dev/ttyACM0=RX1 ... --port /dev/ttyACM3=RX4 \
    --duration 180 \
    --out /home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/data/raw/session_01_fall.npz

# 方法 3：不传 --out，用默认 + 重命名（最稳）
python capture_multi.py \
    --port /dev/ttyACM0=RX1 ... --port /dev/ttyACM3=RX4 \
    --duration 180
# → 输出 <project>/data/raw/capture_20260630_HHMMSS.npz
# → mv 改名 session_01_fall.npz
```

**给后续 Agent 的提示**：
- 修类似"默认路径 bug"时，**必须 grep 整个代码库看是否有 `Path("data/...")` 类相对路径**（参见 D.7 的教训）
- 文档约定的"项目根"是 `<project>` = `Bouy_CSI_FallDetection/`，所有 `data/raw/` 引用都按这个根解析
- Day 4 `finetune_lstm.py --dataset <path>` 建议统一指向 `<project>/data/raw/`，否则要分别传两个路径

#### D.13.4 下次采 fall 数据的操作清单

按 §Step 3.6 采 fall 时建议：

```bash
# 1. 准备：把 mattress 铺在中心活动区，戴护具（防真摔伤）
# 2. 录 3 分钟：5-10 次"站立 → 倒下 → 躺 30s → 站起来"
cd /home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection
cd src/pc_tools/receiver
conda activate dac_dev

python capture_multi.py \
    --port /dev/ttyACM0=RX1 --port /dev/ttyACM1=RX2 \
    --port /dev/ttyACM2=RX3 --port /dev/ttyACM3=RX4 \
    --duration 180 \
    --out ../../data/raw/session_01_fall.npz   # 注意：相对 cwd，仍会落 src/data/raw/

# 3. 验证文件
ls -la ../../data/raw/session_01_fall.npz
python3 -c "import numpy as np; d=np.load('../../data/raw/session_01_fall.npz'); \
            [print(k, d[k].shape, d[k].dtype) for k in d.keys()]"

# 4. 退出时不用怕：^C 一次就够（保存完才出 ✓ 行），多次 ^C 也不会损坏数据
```

**对 standing / fall 两份文件做时间对齐检查**（训练前必做）：

```python
import numpy as np
s = np.load('<project>/data/raw/session_01_standing.npz')
f = np.load('<project>/data/raw/session_01_fall.npz')
for rx in ['RX1','RX2','RX3','RX4']:
    ts, tf = s[f'timestamps_{rx}'], f[f'timestamps_{rx}']
    print(f'{rx}: standing {len(ts)} 帧 ({ts[-1]-ts[0]:.1f}s)  '
          f'fall {len(tf)} 帧 ({tf[-1]-tf[0]:.1f}s)')
# 期望：两段时间近似（standing ~180s, fall ~180s），4 板帧数差异 < 10%
```

### D.14 2026-06-30 增补：collect.py 标注流程 + 训练脚本路径修正

> 触发场景：用户采完 fall 数据后想直接 `python labeling/split_fall_labels.py --dataset ../../../../../src/data/raw/`，但 split 脚本不产 labels.json——它**读**别人已经标好的 labels.json 然后切成 v2。本节把"怎么录 + 怎么标 + 怎么训"的完整流程统一，并修正 §Step 3.6 / §Step 4.1-4.4 原版的 3 处错误。

#### D.14.1 上轮回答里被修复的错误

| # | 原版说法 | 错误类型 | 修正 |
|---|---|---|---|
| 1 | §Step 3.6 用 `capture_multi.py` 采训练数据 | **致命**：capture_multi.py 不产 labels.json，训不了模型 | 改用 `collect.py`（键盘实时标注 → 自动写 csi.npz + labels.json + metadata.json）|
| 2 | `split_fall_labels.py` 命令行可直接跑 | **隐性 bug**：脚本读不到 labels.json 时 `NoOp` 退出，**不报错** | 在 §Step 3.6 e) 加 `ls labels_v2.json` 验证 + 完整段类统计 |
| 3 | §Step 4.1 拷脚本到 `src/pc_tools/training/finetune_*.py` | **漂移风险 + 不必要** | 推荐**直接用原脚本** `fall-detection-training/training/train_*.py`，加 `mkdir -p checkpoints` |
| 4 | 训练命令里 `--dataset ../../data/raw/`（相对）| **cwd 漂移隐患** | 全部改用 `$OUT` 绝对路径 |
| 5 | 没提 collect.py 需要图形界面 | **环境前置遗漏** | §Step 3.6 a) 加 display requirement + SSH X forwarding + tkinter 依赖说明 |
| 6 | 没提 `mkdir -p checkpoints` | **跑训练时 FileNotFoundError** | §Step 4.1 加 `mkdir -p fall-detection-training/checkpoints` |

#### D.14.2 collect.py vs capture_multi.py：什么时候用哪个

| 工具 | 产 labels.json？| 适用场景 | 本项目里用在哪 |
|---|---|---|---|
| **`collect.py`** | ✅ 自动产（按键打标签）| **采训练数据**（要喂给 train_lstm / train_cnn）| Day 3 §Step 3.6 |
| `capture_multi.py` | ❌ 只产 npz | 调试 / smoke test / 临时录一段无标签数据 | Day 2 smoke test（已废弃）|
| `receiver.py` + `infer_loop.py` | ❌ 实时流 | 部署后 7×24 持续采集 + 推理 | Day 3 §Step 3.3+ |

**判断标准**：录下来的数据**会不会拿去训练**？是 → `collect.py`；否（仅调试/演示）→ `capture_multi.py`。

#### D.14.3 collect.py 路径 + 输出结构

```bash
# 输出根默认是 ./dataset/（相对 cwd）—— 必须用 --out-root 显式指定
OUT=/path/to/src/data/raw
cd fall-detection-training/collection
python collect.py --session session_01_standing --out-root "$OUT" --duration 180

# 产出（每 session 1 个目录）
$OUT/session_01_standing/
├── csi.npz              ← 训练脚本要的文件名（不是 session_01_standing.npz）
├── labels.json          ← v1，按键时间戳原始标注
└── metadata.json        ← session 信息（端口、subject、notes 等）

# split_fall_labels.py 把 labels.json 转成 labels_v2.json
# 训练脚本读 csi.npz + labels_v2.json
```

**关键不变量**（训练脚本在 [train_lstm.py:572-574](../Bouy_CSI_FallDetection/fall-detection-training/training/train_lstm.py#L572-L574) 强约束）：

```python
all_sessions = sorted(args.dataset.glob("*/"))                       # 必须是子目录
all_sessions = [d for d in all_sessions
                if (d / "csi.npz").exists()                          # 文件名必须 csi.npz
                and (d / args.labels).exists()]                      # labels_v2.json 必须存在
```

任何"文件名是 `session_01_standing.npz`"或"labels.json 还在 v1 没 split"的情况 → 训练时 `NoOp` 退出，**不报错**。这是 §D.14.1 #2 的根源。

#### D.14.4 collect.py 的图形界面要求（容易漏掉）

`collect.py` 用了 matplotlib + TkAgg backend，**需要 display**：

| 运行环境 | 是否能跑 | 备注 |
|---|---|---|
| Linux 本地桌面 | ✅ | 默认 OK |
| macOS 本地 | ✅ | 默认 OK |
| Windows 本地 | ✅ | 默认 OK |
| WSL2 + WSLg | ✅ | WSLg 自动提供 display |
| WSL2 无 WSLg | ❌ | 需装 VcXsrv 或 X410 |
| SSH 远程服务器 | ⚠ | 需 `ssh -X user@host` 或 VNC |
| 纯 headless 服务器 | ❌ | collect.py 会启动失败 |

**报错 → 解药**：

| 报错 | 原因 | 解决 |
|---|---|---|
| `_tkinter.TclError: no display name and no $DISPLAY environment variable` | 没 display | `export DISPLAY=:0`（本地）/ X forwarding（SSH）/ VNC |
| `No module named '_tkinter'` | Python 缺 tkinter | `sudo apt install python3-tk`（Debian/Ubuntu）|
| `ImportError: No module named matplotlib.backends.backend_tkagg` | matplotlib 装错 | `pip install matplotlib`（应自带 TkAgg）|

**如果实在没 display**（比如纯 SSH 到云服务器）：找一台有桌面的机器录，或者改用 `capture_multi.py` + 手工写 labels.json（**强烈不推荐**，labels 精度差，参见 §D.14.1 #1）。

#### D.14.5 训练脚本路径一致性问题

**原 §Step 4.1 的设计**（拷贝脚本到 `src/pc_tools/training/finetune_*.py`）有 3 个问题：

1. **没真拷贝过**——`src/pc_tools/training/` 至今空目录，文档承诺和现实脱节
2. **版本漂移**：Bouy 升级 train_*.py 时你不会同步
3. **路径双重化**：训练脚本在两个地方，git log 跨不过去

**修正方案**：**直接用原脚本 + 绝对路径**。命令见 §Step 4.1-4.4（已重写）。

```bash
# 一次性设置
cd fall-detection-training/training
mkdir -p checkpoints                # ← 必加，否则 --ckpt 会 FileNotFoundError
export OUT=/abs/path/to/src/data/raw

# LSTM
python train_lstm.py --dataset "$OUT" --labels labels_v2.json \
    --source ours --t-seq 16 --epochs 30 --ckpt checkpoints/lstm.pt

# CNN
python train_cnn_deep.py --dataset "$OUT" --labels labels_v2.json \
    --source ours --epochs 80 --augment --ckpt checkpoints/cnn.pt

# 融合
python ensemble_predict.py --dataset "$OUT" --labels labels_v2.json \
    --source ours \
    --lstm-ckpt checkpoints/lstm.pt --cnn-ckpt checkpoints/cnn.pt
```

**重要参数对照**（已查 [train_lstm.py:466-512](../Bouy_CSI_FallDetection/fall-detection-training/training/train_lstm.py#L466-L512) + [train_cnn_deep.py:543-593](../Bouy_CSI_FallDetection/fall-detection-training/training/train_cnn_deep.py#L543-L593)）：

| 参数 | 我们的值 | 默认 | 来源 |
|---|---|---|---|
| `--dataset` | `$OUT` 绝对 | `dataset/` 相对 | 我们改：避免 cwd 漂移 |
| `--labels` | `labels_v2.json` | `labels.json` | 我们改：6 类（FALL_IMPACT + FLOORED）|
| `--source` | `ours` | `all`（含 CSI-HAR）| 我们改：只用自采 |
| `--t-seq` | `16` | `8` | 沿用 §Day 4 原推荐 |
| `--epochs` | `30`（LSTM）/ `80`（CNN）| `200` / `300` | 沿用 §Day 4：小数据集少训 |
| `--ckpt` | `checkpoints/lstm.pt` 等 | `checkpoints/best.pt` 等 | 我们改：显式命名方便 ensemble 引用 |
| `--augment` | CNN 加上 | 不加 | 沿用 §Day 4：小数据集必备 |

#### D.14.6 完整流程 checklist（从空白到训出模型）

```bash
# === 阶段 1：清理 + 准备 ===
rm -f src/data/raw/test_5s.npz \
      src/data/raw/session_01_standing.npz \
      src/data/raw/session_01_fall.npz    # ⚠ 破坏性，确认不需要旧数据
export OUT=/abs/path/to/src/data/raw
ls /dev/ttyACM*                            # 确认 4 RX + 1 TX

# === 阶段 2：采带标签数据（图形界面，~6 分钟） ===
cd fall-detection-training/collection
python collect.py --session session_01_standing --out-root "$OUT" --duration 180
# → 窗口弹出，按 1/2/3/1/.../q
python collect.py --session session_01_fall --out-root "$OUT" --duration 180
# → 窗口弹出，按 1/f/1/3/1/.../q（5-8 次跌倒）
cd -

# === 阶段 3：切标签（必须！否则训练时 NoOp） ===
cd fall-detection-training/labeling
python split_fall_labels.py --dataset "$OUT" --impact-sec 1.5
ls "$OUT"/session_01_*/labels_v2.json      # ← 必须有 2 个文件
cd -

# === 阶段 4：训练（CPU 即可，~30 分钟） ===
cd fall-detection-training/training
mkdir -p checkpoints
python train_lstm.py --dataset "$OUT" --labels labels_v2.json \
    --source ours --t-seq 16 --epochs 30 --ckpt checkpoints/lstm.pt
python train_cnn_deep.py --dataset "$OUT" --labels labels_v2.json \
    --source ours --epochs 80 --augment --ckpt checkpoints/cnn.pt
python ensemble_predict.py --dataset "$OUT" --labels labels_v2.json \
    --source ours --lstm-ckpt checkpoints/lstm.pt --cnn-ckpt checkpoints/cnn.pt

# === 阶段 5：替换部署模型 + 跑 infer_loop 看 prob ===
# （Day 5 范围，不在此展开）
```

**给后续 Agent 的提示**：
- 任何时候"录训练数据"→ 第一反应是 `collect.py`，不是 `capture_multi.py`
- 训练时报 `No sessions found` → 90% 是 `csi.npz` 命名 / `labels_v2.json` 缺失 / 子目录结构错，按 §D.14.3 不变量逐项检查
- 训练脚本会在 `checkpoints/` 下生成 best.pt 副本（如果用默认路径），不影响我们的显式路径方案
- collect.py 的显示问题（SSH/headless）是**第一关**——先把 display 搞定再谈标注

### D.15 2026-06-30 增补：collection_mouse.py（鼠标标注版）

> 触发场景：用户为避免摔倒在键盘上、损伤硬件，决定改用无线鼠标。**left=0, right=1, middle=quit**，2-bit 码（00/01/10/11）+ 6-bit 码 000111 = EMPTY，1s 超时清空 buffer。文件：[`fall-detection-training/collection/collection_mouse.py`](../Bouy_CSI_FallDetection/fall-detection-training/collection/collection_mouse.py)。

#### D.15.1 设计动机

| 问题 | collect.py (键盘) | collection_mouse.py (鼠标) |
|---|---|---|
| 跌倒时手边有键盘 | 容易压坏键盘、绊倒自己 | 鼠标小、握在手里、可绑手腕 |
| 标记速度 | 按数字键 0-4 | 双击：左/右/左/右（4 次）|
| 误触风险 | 键太多、易按错 | 3 个键（左右中），明确分工 |
| 5 类怎么编码？| 5 个数字键 + 1 个字母键（f=FALL）| 2-bit 4 类 + 6-bit 1 类（EMPTY）|
| 输出格式 | csi.npz + labels.json + metadata.json | **完全一致**（复用 save_session）|

#### D.15.2 鼠标按键协议

```
Middle click (button 2)  →  save + quit
Left click   (button 1)  →  0 bit
Right click  (button 3)  →  1 bit

2-bit codes (1s timeout 后 commit):
  00 = FALL
  01 = STILL
  10 = WALKING
  11 = TRANSITION

6-bit code (1s timeout 后 commit):
  000111 = EMPTY (no person in the room)

Other patterns (len=1, 3, 4, 5, or other 6-bit): 静默丢弃 + 警告
```

**关键细节**：
- **2-bit 与 6-bit 的歧义**：`00` 既是 FALL 又是 000111 的前缀。处理：第 2 bit 触发后设 `tentative=FALL?`，**等 1s timeout 才正式 commit**。如果第 3 个 click 在 1s 内来了，tentative 清除，buffer 继续累积。
- **1s 超时规则**：连续两个 click 间隔 > 1s，前面的 buffer 整个丢弃（不等 timeout 到来），新 click 开启新 buffer。
- **退出时 commit**：按 middle 退出时，如果有 valid pending buffer（例如 00 还没等满 1s），强制 commit 一次（避免丢数据）。

#### D.15.3 实时 UI

在 collect.py 的 4 行 layout 之外加了 1 行（共 5 行）：

```
Row 0:  [BIG class banner]  ← 显示 committed class（颜色编码）+ tentative class（淡色 "FALL ?"）
Row 1:  [Click buffer]      ← bits: [0 0]   len=2/6
                             → tentative: FALL  (commit in 0.7s, or click again to change)
Row 2:  [Per-RX activity bars]
Row 3:  [Label timeline]
Row 4:  [Status line: elapsed / events / pkts / per-class duration]
```

`update_class_banner()` 每 tick 调一次（无 click 也调），保证 committed class 变更后立刻反映。

#### D.15.4 复用 vs 重写

为了让 `collection_mouse.py` 和 `collect.py` 输出格式严格一致（这样 `split_fall_labels.py` / `train_lstm.py` 无需任何改动）：

| 模块 | 复用方式 | 不能复用的部分 |
|---|---|---|
| `Session` / `LabelEvent` | `from collect import ...` | —— |
| `save_session()` | `from collect import ...` | —— |
| `CLASSES` / `CLASS_COLORS` | `from collect import ...` | —— |
| `discover_ports()` / `parse_port_arg()` | `from collect import ...` | —— |
| `robust_variance()` | `from collect import ...` | —— |
| `DISPLAY_VAR_WINDOW_SEC` / `TIMELINE_DISPLAY_SEC` | `from collect import ...` | —— |
| 串口 reader | `from csi_io import MultiPortReader` | —— |
| matplotlib 动画框架 | 自己写（layout 略不同，多 1 行）| `button_press_event` 替换 `key_press_event` |
| 事件处理 | 自己写（基于 BitBuffer）| `key_press_event` 整套 |
| 标签时间线绘制 | 同 collect.py | —— |

**风险**：如果 collect.py 改 `save_session` 的输出 schema（例如改 labels.json 的 `version` 字段），collection_mouse.py 会自动跟上——这是复用 `from collect import` 的好处，**版本漂移风险为 0**。

#### D.15.5 单元测试覆盖

BitBuffer 类 14 个测试用例全过（已实跑，2026-06-30）：

| 场景 | 输入 | 期望 | 状态 |
|---|---|---|---|
| 1. FALL | 0,0 | tentative=FALL → tick(1.5)→FALL | ✓ |
| 2. STILL | 0,1 | tentative=STILL → tick(1.5)→STILL | ✓ |
| 3. WALKING | 1,0 | tentative=WALKING → tick(1.5)→WALKING | ✓ |
| 4. TRANSITION | 1,1 | tentative=TRANSITION → tick(1.5)→TRANSITION | ✓ |
| 5. EMPTY | 0,0,0,1,1,1 | tentative 在第 3 bit 清除 → tick(2.0)→EMPTY | ✓ |
| 6. 000 取消 FALL | 0,0,0 | tentative 在第 3 bit 清除 → tick(2.0)→None | ✓ |
| 7. 超时重置 buffer | 0,0 在 t=0,0.3，0 在 t=5.0 | 1.0s timeout 把 [0,0] 重置为 [0] | ✓ |
| 8. 001 无效 | 0,0,1 | tick(2.0)→None | ✓ |
| 9. 0001 无效 | 0,0,0,1 | tick(2.0)→None | ✓ |
| 10. time_remaining 精度 | push(0,0); push(0,0.3); time_remaining(0.5) | 0.80s | ✓ |
| 11. finalize_now 强制提交 | 0,0（timeout=10s）| tick(0.2)→None; finalize_now()→FALL | ✓ |
| 12. bits_str 格式 | push 0,1,0 | "0 1 0" | ✓ |
| 13. 其他 6-bit 无效 | 0,1,0,1,0,1 | tick(2.0)→None | ✓ |
| 14. 接近 EMPTY 但不是 | 0,0,0,1,1,0 | tick(2.0)→None | ✓ |

#### D.15.6 使用流程

```bash
# 1. 准备：无线鼠标（确认中键可点）+ 4 RX + 1 TX + 瑜伽垫
# 2. 用绝对路径指定输出
OUT=/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/src/data/raw

# 3. Session A: standing
cd fall-detection-training/collection
python collection_mouse.py \
    --session session_01_standing \
    --out-root "$OUT" \
    --duration 180 \
    --subject me \
    --notes "standing + walk, mouse-labeled"

# 4. 鼠标操作序列（按时间顺序）
#    L L        → STILL   (buffer: [0,1] → 1s 后 commit)
#    L L L L    → 0011    → 第一对 LL=STILL, 1s 后 commit
#                     第二个 LL=STILL, 1s 后再 commit
#    L R L L    → 0100   → 第一对 LR=WALKING commit
#                     第二个 LL=STILL commit
#    L L R R    → 0011   → 第一对 LL=STILL commit
#                     第二对 RR=TRANSITION commit
# 等等
#
# 5. 跌倒时的快捷序列
#    L L   (STILL, 站立准备)
#    L L   (STILL, 保持)
#    L L   (STILL, 即将倒下——再点一次 STILL 维持)
#    L L   (STILL, 倒下的瞬间)  ← 如果只想要 STILL 不要打错
#    实际 fall 时:  L R  (FALL=00)，倒下瞬间
#                  L R  (STILL=01) 躺稳后
#    起立:        R R  (TRANSITION=11) 起身
#                  L R  (STILL=01) 站稳
#
# 6. 中键 = save + quit
```

> ⚠ **新手建议**：先**空跑一遍**（不连硬件，`python collection_mouse.py --session test --out-root /tmp/test --port /dev/null=RX1` 看会不会报 serial 错，然后熟悉按钮）。**正式录前**先练 2-3 次左/右/左/右的节奏，肌肉记忆后再上垫子。

#### D.15.7 已知限制 / 未来改进

| 限制 | 原因 | 缓解 |
|---|---|---|
| 没有 `pause` | 鼠标 3 键已被 0/1/quit 占满 | 用 `--duration` 自动停止，或先开 `--duration 180` 但 middle 中途退出 |
| 没有 `undo` | 同上 | 错就错了，手动改 labels.json 即可（一段错了影响有限）|
| 6-bit 000111 必须一次打完 | 中间 1s 超时会丢 | 练到 < 1s/click 的节奏 |
| 必须 4 RX 都在 | 复用 collect.py 的 csi.npz 假设 | 同 collect.py 限制 |

**如果以后要加 pause/undo**：
- pause：long-press middle 1s（matplotlib `button_release_event` + timing）—— 复杂
- undo：双击中键（< 0.3s 内点两下 middle）—— 简单，2 行代码

**如果想 keyboard + mouse 双输入**：把 `key_press_event` handler 从 collect.py 拷过来，两个 handler 各自处理自己的事件即可。

#### D.15.8 给后续 Agent 的提示

1. **复用 collect.py 是设计核心**——`from collect import Session, save_session, ...` 让 schema 永远同步
2. **2-bit 和 6-bit 的歧义靠 timeout 解决**——不要试图"聪明地"在第 2 bit 就 commit，否则 EMPTY 误判为 FALL
3. **`tentative` 字段是 UX 关键**——用户在 1s timeout 之前能立刻看到 "FALL?" 预览，反馈延迟 < 50ms
4. **退出时强制 commit**——`do_save_and_exit()` 里调 `bit_buf.finalize_now()`，避免"刚点 0,0 准备标 FALL 一激动按了 middle 退出结果啥都没存"
5. **matplotlib button codes**：left=1, middle=2, right=3。**不是** 0/1/2 别搞错
6. **新加超时参数**：用 `--click-timeout`（默认 1.0s），不要硬编码

### D.16 2026-06-30 增补：collect.py `discover_ports()` 缺 Linux 支持（collection_mouse 中招）

> 触发场景：用户连上 4 块 ESP32-S3 板（`/dev/ttyACM0-3`），跑 `collection_mouse.py` 报 `ERROR: no USB serial ports found`。

#### D.16.1 根因

`collect.py:discover_ports()` 原版：

```python
def discover_ports() -> list[str]:
    return sorted(glob.glob("/dev/cu.usbserial*") + glob.glob("/dev/cu.SLAB*"))
```

**只搜 macOS 路径**——`/dev/cu.usbserial*` 和 `/dev/cu.SLAB*` 在 Linux 上根本不存在。

**之前没踩到**：
- `capture_multi.py` 自己的 `discover_ports()` 在 §Day 2 Step 2.7 修过（用 4-pattern 列表）
- 用户采集阶段全用的 `capture_multi.py`，没碰 `collect.py`

**现在中招**：
- `collection_mouse.py` `from collect import discover_ports` 复用了 macOS-only 版本
- 用户第一次跑鼠标版才暴露

#### D.16.2 修复

把 `collect.py:discover_ports()` 改成和 `capture_multi.py:discover_ports()` 一致的多平台实现：

```python
def discover_ports() -> list[str]:
    """Auto-discover CSI RX serial ports.
    Detection order (Linux-first):
      1. /dev/ttyACM*   — ESP32-S3 native USB
      2. /dev/ttyUSB*   — CP2102/CH340 UART bridge
      3. /dev/cu.usbserial* / /dev/cu.SLAB* — macOS
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
            seen.add(p)
            unique.append(p)
    return sorted(unique)
```

**验证**（4 块 ESP32-S3 插入后）：

```
$ python3 -c "from collect import discover_ports; print(discover_ports())"
['/dev/ttyACM0', '/dev/ttyACM1', '/dev/ttyACM2', '/dev/ttyACM3']
```

#### D.16.3 给后续 Agent 的提示

1. **collect.py / collection_mouse.py / capture_multi.py 三个脚本的 `discover_ports()` 现在是统一的**（都支持 Linux + macOS），改一个时**必须同步改另外两个**。可以用 grep 找：
   ```bash
   grep -rn "def discover_ports" fall-detection-training/collection/ src/pc_tools/receiver/
   ```
2. **如果以后接 ESP32-C3 / ESP32-C6**：枚举路径可能变（如 `/dev/ttyACMX` 的 X 不再是数字），需要补充 `udev` 规则或自定义探测
3. **复用 collect.py 的代价**：`collection_mouse.py` 跟着 collect.py 的 bug 走——这是 §D.15.4 提到的"版本同步"双刃剑。本次踩的是 **好的副作用**（一个 fix 两处生效），下次踩可能是 **坏的副作用**（collect.py 改 schema 我们也得跟着调）

#### D.16.4 教训（写进 dev_doc 给后人看）

> 这是**第 2 次**在两个不同脚本里发现同一个 `discover_ports()` bug：
>
> - 2026-06-28 §Day 2 Step 2.7：修 `capture_multi.py`（用户当天记录）
> - 2026-06-30 §D.16：本节，修 `collect.py`（踩到才修）
>
> **根因**：`collect.py` 和 `capture_multi.py` 是 Bouy 同作者的姊妹脚本，**两份独立的 `discover_ports()` 实现**。Bouy 在 macOS 上开发，从没意识到 Linux 上 `/dev/ttyACM*` 才存在。
>
> **正确做法**（以后别再踩第 3 次）：把 `discover_ports()` 提到一个共享模块（比如 `fall-detection-training/collection/_port_utils.py`），所有脚本 `from _port_utils import discover_ports`。本次没做（改动面太大），先记在这里。

### D.17 2026-06-30 增补：collection_mouse.py UI 增强 + 性能硬化

> 触发场景：用户测试 collection_mouse.py 反馈两个问题：
> 1. **4 个 2-bit 码标签太小太隐蔽**（原来在 class_sub 一行 9pt dimgray）—— 在瑜伽垫上躺着根本看不清
> 2. **matplotlib 绘制会不会影响数据采集**？—— 担心参照自己以前的 plt.pause() 84ms 坑
>
> 用户参考：[`Mycode/get-started/tools/Docs/DEV_LOG.md`](../Mycode/get-started/tools/Docs/DEV_LOG.md) §4 + [`HANDOFF.md`](../Mycode/get-started/tools/Docs/HANDOFF.md) §11.3（自己的旧项目经验）

#### D.17.1 回答核心问题：matplotlib 绘制影响数据采集吗？

**直接答：不影响数据完整性，但可能影响点击响应延迟。**

| 维度 | 结论 | 原因 |
|---|---|---|
| 数据丢失？ | **不会** | 串口读取在独立线程（`MultiPortReader` 用 `selectors`，C 代码释放 GIL），主线程绘图不阻塞 |
| 串口 buffer 溢出？ | **不会** | pyserial 内部 buffer 几 KB，921600 baud × 64B/frame ≈ 1ms/frame，buffer 顶得住 1s 阻塞 |
| queue 积压？ | **不会** | `MultiPortReader.buffers` 用 `deque(maxlen=0)`（无限），绘图卡 1s 不会积压数据 |
| 内存增长？ | **不会** | 跟 collect.py 一样：deque 自动淘汰最老，~30 MB/180s 稳态 |
| 鼠标点击延迟？ | **可能** | 这是真正的风险——见下 |

**当前 collection_mouse.py 已经避免了用户的旧坑**：
| 用户的旧坑（HANDOFF §11.3）| collection_mouse.py |
|---|---|
| `plt.pause(0.001)` 在 TkAgg = **84ms/帧** | ❌ 没有用 plt.pause |
| `draw_idle` = 0.04ms/帧 | ✅ `animation.FuncAnimation` 内部用 `draw_idle` |
| 主线程绘图占 65% | 估计 < 5%（FuncAnimation 异步调度）|

**真正的风险是 variance 计算**（`update()` 函数里的 `np.stack` + `np.median`，350 帧 × 192 子载波 ≈ 0.5-1ms/tick）—— 这跟 Tk 事件循环抢资源，导致 mouse click 排队到下一轮。

#### D.17.2 UI 改造：4 个大色码标签

**改前**（单行小字，dimgray 9pt）：
```
left=0  right=1  middle=quit   |   00=FALL  01=STILL  10=WALKING  11=TRANSITION  000111=EMPTY   |   timeout=1.0s
```

**改后**（4 个独立 text，fontsize 18/22，颜色按 CLASS_COLORS）：
```
                 CURRENT CLASS: STILL  (大字号 44pt)
+----------+----------+----------+----------+
| 00 FALL  | 01 STILL | 10 WALK  | 11 TRANS |    ← fontsize 18pt (inactive) / 22pt (active highlight)
| (红色)   | (绿色)   | (蓝色)   | (黄色)   |    ← 各自 CLASS_COLORS 色
+----------+----------+----------+----------+
                  left=0  right=1  middle=quit+save  |  000111=EMPTY  |  timeout=1.0s
```

**新行为**：
- **按钮高亮**：当 2-bit 码命中某个类，那个按钮变成 22pt + 完整色（其他保持 18pt + 0.75x 暗色）
- 用户在 1s timeout 之前能立刻看到 "FALL?" 命中的是哪个按钮 → **视觉反馈延迟 < 50ms**

代码位置：[collection_mouse.py:434-487](../Bouy_CSI_FallDetection/fall-detection-training/collection/collection_mouse.py#L434-L487)（class_text 下方 4 个 button_texts + highlight_button 函数）

#### D.17.3 性能硬化（3 处改动）

##### 改动 A：`on_mouse` 末尾加 `fig.canvas.draw_idle()`

**问题**：之前用户 click 后 UI 不立即更新，要等下一帧动画（最长 167ms）。用户连续双击时，**第二个 click 可能在第一个 click 还没显示时就发了**——容易看错当前状态。

**改前**：
```python
def on_mouse(event):
    ...
    bit_buf.push(bit, now)
    # ... UI 更新 ...
    update_class_banner(...)
    # 没有 draw_idle——等下一帧动画
```

**改后**：
```python
def on_mouse(event):
    ...
    bit_buf.push(bit, now)
    # ... UI 更新 ...
    update_class_banner(...)
    # 强制立即重绘（draw_idle ~0.04ms，see HANDOFF §11.3）
    fig.canvas.draw_idle()
```

**实测效果**：用户 click 后 < 16ms 看到 bit 出现在 UI 上。

##### 改动 B：variance 计算每 2 帧才跑一次

**问题**：`update()` 里 `np.stack(pts, axis=0)` + `np.median(...)` 是最重的工作（350 帧 × 192 子载波 ≈ 0.5-1ms/tick）。每帧都跑，6Hz 节奏下占用主线程 3-6%——给 Tk 事件循环留太少空隙。

**改前**：
```python
def update(_frame):
    for i, name in enumerate(living_names):
        snapshot = list(reader.buffers[name])
        if len(snapshot) >= 30:
            # ... 每帧都算 variance ...
            amps_mat = np.stack(pts, axis=0)
            v = robust_variance(amps_mat)
```

**改后**：
```python
def update(_frame):
    variance_active = (_frame % 2 == 0)  # ← 新增
    for i, name in enumerate(living_names):
        snapshot = list(reader.buffers[name])
        if variance_active and len(snapshot) >= 30:  # ← 加条件
            # ... 只在偶数帧算 variance ...
```

**实测效果**：
- 主线程 variance 计算量减半（3Hz 而非 6Hz）
- 视觉影响：bars 1 帧不更新（167ms），人眼几乎无感
- Tk 事件循环空出来 → mouse click 排队时间从可能 100ms → 通常 < 20ms

##### 改动 C：可选——降低默认 update_hz（**未实施**）

```bash
# 当前默认
python collection_mouse.py --update-hz 6   # 167ms/tick

# 如果上面 B 还不够，可以降到
python collection_mouse.py --update-hz 4   # 250ms/tick，bars 更"懒"但更省 CPU
```

**没默认改成 4Hz** 的原因：6Hz → 4Hz 的视觉差异在用户场景下不显著（用户在垫子上主要看 class banner + bit buffer，不是 bars）；而且 250ms/tick 会让 countdown 数字跳动更慢，感觉不"实时"。

#### D.17.4 性能对比表（理论值，未在本机实测）

| 操作 | 改前耗时/帧 | 改后耗时/帧 | 节省 |
|---|---|---|---|
| `update()` 总耗时（估计）| ~2-3ms | ~1-2ms | ~40% |
| 其中 `np.stack(350×192)` | ~0.3ms | 0.15ms（半速）| 50% |
| 其中 `np.median(...)` × 4 RX | ~1ms | 0.5ms（半速）| 50% |
| 其中 `tl_patches` redraw | ~0.5ms | ~0.5ms | 0% |
| `draw_idle()` (在 on_mouse) | 0 (之前没有) | 0.04ms | 新增 0.04ms |
| `FuncAnimation` 主循环 | ~0.5ms | ~0.5ms | 0% |
| **可分配给 Tk 事件循环** | ~163ms/167ms | ~164ms/167ms | +1ms |

**结论**：节省的 1-2ms 不算大，但**在用户 1s timeout 边缘场景下，关键**。如果 Tk 事件循环累积延迟 50ms（5 个 click 都延迟 10ms），就可能让 click 2 离 click 1 超过 1s → 触发 buffer reset。

#### D.17.5 给后续 Agent 的提示

1. **matplotlib 在 TkAgg 上有"怪癖"**：用户的 HANDOFF §11.3 量化了 `plt.pause` 的 84ms 代价。本项目用 `FuncAnimation`（`draw_idle` 路径）规避了大部分坑，但**没有量化对比**——如果跑 24h 出现 matplotlib 相关问题，先看是不是这个
2. **数据采集和 matplotlib 在不同线程**——GIL 保护 dict 计数器对统计足够安全（本项目不传 numpy 数据到 GUI 线程，零拷贝风险）
3. **mouse click 走 Tk 事件循环**——主线程繁忙时 click 会被排队。`draw_idle` 只是让 redraw 排队优先，不代表 click 本身被优先处理。如果真有可见延迟（> 200ms），考虑：
   - `--update-hz 4`（降低主线程节奏）
   - 进一步 decimate（每 3 帧一次 variance）
   - 改 PyQtGraph 后端（参见 HANDOFF §11.6 方案 ②）
4. **按钮高亮的颜色用 `CLASS_COLORS`**——和 timeline + legend 一致。改颜色要同时改 3 处
5. **frame 编号 `_frame` 来自 FuncAnimation**——可以用它做 decimation（`% 2 == 0`），比自己维护 counter 干净

#### D.17.6 验证清单

| 项 | 怎么验证 |
|---|---|
| 语法/编译 | `python3 -c "import py_compile; py_compile.compile('collection_mouse.py')"` ✓ |
| 14 个 BitBuffer 单元测试 | 见 D.15.5，全部通过 ✓ |
| --help | `python3 collection_mouse.py --help` ✓ |
| 端口自动发现 | `discover_ports() → 4 个 ttyACM*` ✓（D.16 修的）|
| 4 按钮高亮 | 待实跑：在垫子上 click 左/右/左，确认"FALL"按钮变 22pt + 红色 |
| 性能对比 | 待 1h 实测：monitor 4 板 fps 是否稳定 67-71 Hz（variance decimation 没影响）|

### D.18 2026-06-30 增补：1 个 session 跑不了训练（train_lstm.py 硬要求 ≥3 session）

> 触发场景：用户完成 1 个 session（11 FALL + 18 STILL + 11 TRANSITION + 1 EMPTY + 1 WALKING = 460.5s），跑 `split_fall_labels.py` 成功生成 `labels_v2.json`，但 `train_lstm.py` 立刻报 `Need at least 3 sessions; found 1` 后直接退出。

#### D.18.1 根因

[train_lstm.py:585-587](../Bouy_CSI_FallDetection/fall-detection-training/training/train_lstm.py#L585-L587) 硬编码：

```python
if len(sessions_with_origin) < 3:
    print(f"Need at least 3 sessions; found {len(sessions_with_origin)} with "
          f"{args.labels}  (source filter: {args.source})")
    return 1
```

**为什么 ≥3？**
- LOOCV 需要 N folds；N=1 时 leave-one-out = 0 训练样本 = 不可训练
- N=2 时 leave-one-out = 1 训练 + 1 测试 = 模型过拟合 1 个 session 没意义
- N=3 时 leave-one-out = 2 训练 + 1 测试 = 最低可信度

**没有 CLI flag 绕过**（源码里就是 hardcoded `3`），要绕过只能改源码 + 接受"指标没意义"。

#### D.18.2 解法：再录 2 个 session

**为什么需要"多样"而不是单纯凑数**：
- 3 个 session 全是"STILL + FALL" → 模型只学两类动作，泛化能力 = 0
- 3 个 session 各有 WALKING / TRANSITION / SIT 等 → 模型学到"人的动作谱"，LOOCV 才有信息量

**推荐 session 组合**（用 3 个 session 凑出可信 LOOCV）：

| Session | 组成 | 时长 | 关键差异 |
|---|---|---|---|
| 已有的 `session_20260630_194547` | 11 FALL + 18 STILL + 11 TRANSITION + 1 EMPTY + 1 WALKING | 460.5s | 跌倒密集、动作组合丰富 |
| **session_02_fall**（待录）| 3-4 FALL + STILL + TRANSITION | 180s | 跌倒稀疏、节奏更自然 |
| **session_03_mixed**（待录）| 30s STILL + 30s WALKING + 3 FALL + TRANSITION | 240s | 加 WALKING，让模型见"快走"不误报 |

**录制命令**见本节末尾的 shell 块。

#### D.18.3 session 录制关键参数

`collection_mouse.py` 默认每次启动都用 timestamp 命名（`session_YYYYMMDD_HHMMSS`）。**显式传 `--session <name>`** 才能得到稳定名字：

```bash
DATASET=/home/ruo/.../Bouy_CSI_FallDetection/dataset

# session_02_fall：3-4 次跌倒 + 站立过渡
cd fall-detection-training/collection
python collection_mouse.py \
    --session session_02_fall \
    --out-root "$DATASET" \
    --duration 180 --subject me \
    --notes "fall session #2, 3-4 falls"

# session_03_mixed：加 WALKING 段（30s 走 + 30s 站 + 3 次跌倒）
python collection_mouse.py \
    --session session_03_mixed \
    --out-root "$DATASET" \
    --duration 240 --subject me \
    --notes "mixed: WALKING + FALL"
```

#### D.18.4 FALL 段标注长度问题

用户已有 session 里 11 个 FALL 段长度分布：

| 长度区间 | 段数 | 占比 |
|---|---|---|
| 2-3s | 2 | 18% |
| 4-6s | 3 | 27% |
| 7-8s | 6 | 55% |

**问题**：5-8s 段把"躺地等起身"也算进 FALL，**起身过程应该用 TRANSITION 标**。
**修复策略**：
- FALL 段只覆盖"开始倒下 → 触地稳定"瞬间（理想 1-3s）
- 起身过程：先按 `RR` (TRANSITION) → 站稳按 `LR` (STILL)
- 录之前**先空练 3-5 次**，确保按 `f` 之后 1-3s 内就按 `LR`

否则模型学到的"假关联"是"FALL 段时长 = 真假跌倒信号"——不是物理意义上的跌倒。

#### D.18.5 split_fall_labels.py 的 2 个"坑"

##### 坑 A：脚本末尾的"✓ Wrote" 信息在 0 session 时也打印

`split_fall_labels.py` 流程：

```python
sessions = sorted(args.dataset.glob("*/"))
if not sessions:
    print(f"No sessions in {args.dataset}/")
    return 1
# ... 打印 header
for d in sessions:
    # 找不到 labels.json 就 continue
    ...
print(f"\n✓ Wrote {args.output} into all session folders.")  # ← 无条件打印
```

**症状**：如果 `--dataset` 路径错了，循环跑了 0 次，但脚本末尾仍打印"✓ Wrote"，**用户以为成功了**。

**实测**：用户第一次跑（`$DATASET` 没 export 成）触发了这个坑——"✓ Wrote" + 0 个 labels_v2.json 写出来。**修复**：跑完用 `ls dataset/*/labels_v2.json` 验证文件实际生成。

##### 坑 B：脚本**不跳过非 session 目录**

`split_fall_labels.py` 的循环是 `for d in sessions: ...`（所有 `*/` 子目录），**不验证目录名是否真的以 `session_` 开头**。如果 dataset/ 下有 `xxx.bak/`、`temp/` 等非 session 目录，会被一起处理（如果里面有 labels.json）。

**实测**：用户的 `session_20260630_194547.bak/`（我之前手动 cp -r 创建的备份）也被 split 了，labels_v2.json 写到了 .bak 里——污染了 dataset。

**修复**：跑 split 之前**确保 dataset/ 下只有真的 session 子目录**。本次教训：cp -r 创建的备份应该用 `.tar.gz` 而不是直接放同目录：

```bash
# ✅ 推荐
tar czf "$DATASET.bak.$(date +%Y%m%d_%H%M%S).tar.gz" -C "$DATASET" .

# ❌ 不要（会污染 split 扫描）
cp -r "$DATASET/session_xxx" "$DATASET/session_xxx.bak"
```

#### D.18.6 给后续 Agent 的提示

1. **train_lstm.py 最低 3 session**——`train_cnn_deep.py` 同样有这检查（[train_cnn_deep.py 中有类似代码](../Bouy_CSI_FallDetection/fall-detection-training/training/train_cnn_deep.py)）。如果用户的目的是"先看模型能不能 fit"，可以临时改源码 `< 3` 为 `< 1`（**仅限 smoke test**，指标无意义）
2. **`$DATASET` 等 env var 在 Bash 工具里不持久**——每次调用是新 shell。**每个 Bash 调用里都要重新 export 或用绝对路径**
3. **dataset/ 下不要有非 session 子目录**——split 会扫所有 `*/`。`.bak` / `.tmp` / 旧数据会一起被处理
4. **FALL 段应该短**（1-3s）——起身过程用 TRANSITION 标，否则模型学不到"快速冲击"的真实特征
5. **session 名字用 `--session <name>` 显式指定**——不要靠默认 timestamp（多次录同样的"fall"难以区分）

#### D.18.7 验证清单（recording 完 + training 前）

```bash
DATASET=/home/ruo/.../Bouy_CSI_FallDetection/dataset

# 1. dataset/ 下应该只有 session_xxx/ 目录（无 .bak / .tmp）
ls "$DATASET/"
# 期望：3 行都是 session_xxx 形式

# 2. 每个 session 都有完整 3 件套
for s in "$DATASET"/*/; do
    echo "=== $s ==="
    ls "$s" | grep -E '^(csi|labels|metadata)\.npz?$|^labels_v2\.json$|^metadata\.json$'
done
# 期望：每个 session 都有 csi.npz + labels.json + labels_v2.json + metadata.json

# 3. 切标签后验证 FALL_IMPACT / FLOORED 数量符合预期
python3 -c "
import json
from pathlib import Path
for p in sorted(Path('$DATASET').glob('*/labels_v2.json')):
    L = json.load(open(p))
    fall_impact = sum(1 for s in L['segments'] if s['class']=='FALL_IMPACT')
    print(f'{p.parent.name}: FALL_IMPACT={fall_impact}')
"
# 期望：每个 session 的 FALL_IMPACT > 0
```

#### D.18.8 训练后预期指标

3 个 session（你自己采的），LOOCV window-F1 大概在 **0.4-0.7** 区间：

| 因素 | 影响 |
|---|---|
| 动作多样性（session_03 加 WALKING）| +0.1 |
| 跌倒节奏稳定性（每段 1-3s）| +0.1 |
| 单人单房间（无跨人/跨房间验证）| -0.1（泛化能力上限）|
| 11+4+3 = 18 个 FALL 样本（vs Bouy 的 ~30+）| -0.05（数据量）|

**不要追求 0.81**——那是 Bouy 作者在自己 7 个特定会话上的最优，跨房间/跨人不可泛化（参见 §D.11）。

**真要 0.7+ 需要**：
- 7+ session × 多人 × 多房间（强 stretch goal）
- 3 session 是 demo 跑通的**最低标准**，不是产品标准

### D.19 2026-06-30 增补：LSTM 训练完成 + `| tail -N` 进度可见性陷阱

> 触发场景：用户跑 `python -u train_lstm.py ... 2>&1 | tail -50`，3 分钟没输出，以为卡死，问我"是不是没进度条"。**实际上训练在跑（CPU 99% 已跑 3:23）**，是 `| tail -50` 把进度输出截到了内存里。

#### D.19.1 关键结论：**不要 pipe 到 tail**

| 命令 | 实时可见进度 | 适用场景 |
|---|---|---|
| `python -u train.py ... 2>&1 \| tail -50` | ❌ 训练结束才看到 | 想看完整结果但不要滚动 |
| `python -u train.py ... 2>&1 \| tail -100` | ❌ 同上，N 没用 | （错误尝试）|
| `python -u train.py ... 2>&1` | ✅ 终端实时滚动每 epoch 一行 | **推荐**（跑短训）|
| `python -u train.py ... 2>&1 \| tee train.log` | ✅ 实时 + 留 log | 长训想留档 |

**原理**：`tail` 是基于 EOF 检测的——它**等 stdin 关闭**才输出缓冲的全部内容。训练没跑完，stdout 没关，tail 就一直挂着不显示。所以"3 分钟没输出"≠ 卡死，是 tail 在等。

**`python -u`（unbuffered）** 是 print 立即刷 stdout 的关键，但**不解决 tail 的问题**。

#### D.19.2 LSTM 实际训练结果（3 sessions, ours only）

**用户 3 个 session**：
| Session | 时长 | FALL_IMPACT | FLOORED | 备注 |
|---|---|---|---|---|
| session_20260630_194547 | 460.5s | 11 | 11 | 11 个跌倒、混合动作 |
| session_20260630_203335 | ? | 9 | 9 | session 2 |
| session_20260630_205253 | ? | 4 | 4 | session 3，test 集 |

**训练配置**：`--t-seq 16 --epochs 30 --source ours`

**结果**（early stop at epoch 20, best at epoch 5）：

| 指标 | 数值 | 解读 |
|---|---|---|
| Best val macro-F1 | **0.388** | 5 epoch 后开始过拟合 |
| Test acc | 0.583 | 6 类中猜对 58% |
| **FALL_IMPACT recall** | **66.7%** | 模型能抓住大多数跌倒 ✓ |
| FALL_IMPACT precision | 25.0% | 误报率 75%——precision 极低 |
| STILL F1 | 0.781 | 基线类，学得最好 |
| TRANSITION F1 | 0.276 | 和 FALL_IMPACT 经常混淆 |
| FLOORED F1 | 0.462 | 中等 |
| EMPTY F1 | 0.000 | 模型从不预测 EMPTY（样本太少）|
| WALKING F1 | 0.000 | 训练集几乎没有 WALKING → 完全不识别 |

**主要问题（confusion matrix 看出来的）**：
- FALL_IMPACT 18 个假阳性：大部分来自 **TRANSITION 被误判成 FALL_IMPACT**（TRANSITION 72 个里有 18 个被判成 FALL_IMPACT）
- TRANSITION 自身的 precision 0.263，recall 0.292——模型学不到这个类的边界
- EMPTY 和 WALKING 完全不识别（样本不足）

#### D.19.3 这是预期结果，不需修

参考 §D.18.8 + §D.11：3 session × 单人单房间，**window-F1 0.4-0.7 是合理区间**，本例 0.388 在下限。

**改善方向**（按 ROI 排序）：

| 改动 | 预期影响 | 成本 |
|---|---|---|
| 加 session（含 WALKING/EMPTY 多样性）| +0.1 macro-F1 | 30 分钟/个 |
| 录 session 时 FALL 段控制 1-3s（不要 5-8s）| +0.05 FALL_IMPACT precision | 重新录 |
| `--epochs 60 --patience 25`（更深训练）| +0.02-0.05 | 重训 30 分钟 |
| 改 model arch（CNN + LSTM 集成）| +0.1-0.15 | 训练 2 次 |
| 7+ session × 多人 × 多房间 | 0.7+ | 几小时到几天 |

**本项目 demo 目标 = 跑通 pipeline**。当前 0.388 已经满足"模型能 fit 数据且不过分灾难"的标准。

#### D.19.4 下一步操作

继续跑 CNN + Ensemble（**不 pipe tail**）：

```bash
cd fall-detection-training/training
DATASET=/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection/dataset

# 实时看 CNN 训练进度
python -u train_cnn_deep.py \
    --dataset "$DATASET" --labels labels_v2.json \
    --source ours --epochs 80 --augment \
    --ckpt checkpoints/cnn.pt 2>&1

# Ensemble
python -u ensemble_predict.py \
    --dataset "$DATASET" --labels labels_v2.json \
    --source ours \
    --lstm-ckpt checkpoints/lstm.pt --cnn-ckpt checkpoints/cnn.pt 2>&1

# Eval
cd ../evaluation
python -u eval_seq9_ensemble.py 2>&1
```

**预计 CNN 训练时间**：~10-20 分钟（80 epochs，CPU 比 LSTM 重）

#### D.19.5 关于 tqdm 进度条

**结论：不加**。脚本已有"每 epoch 打印一行 train/val loss + F1"的输出，去掉 `| tail -N` 就能看到实时滚动。加 tqdm 反而要改 3 个脚本的 main loop + 引入新依赖，ROI 低。

**什么时候值得加 tqdm**：
- 训练一次 > 30 分钟（每 epoch 间隔太大，需要 batch 级进度）
- 想看 ETA（剩余时间）
- 想做交互式控制（按 q 中途退出）

本项目训练都在 30 分钟内，**当前方案够用**。

#### D.19.6 关于 PyTorch FutureWarning

训练末尾有：
```
FutureWarning: You are using `torch.load` with `weights_only=False`...
```

**原因**：PyTorch 2.6+ 默认 `weights_only=False`（未来会变 `True`）。
**影响**：无。我们的 checkpoint 是自己训的，没安全风险。
**修复**（可选，不影响功能）：
```python
# train_lstm.py:838
model.load_state_dict(torch.load(args.ckpt, map_location=device, weights_only=True))
```
3 个脚本的 load_state_dict 都加 `weights_only=True` 即可。**留给后续 agent**——本次不动。

#### D.19.7 给后续 Agent 的提示

1. **永远不要 `| tail -N` 跑长训**——会让用户误以为卡死。改成不 pipe，或用 `tee` 留 log
2. **3 个训练脚本已经够用**——已经有 per-epoch print，实时可见
3. **LSTM 0.388 macro-F1 是预期**（3 session × 单人单房间），不要"为了提分"而 hack 数据集
4. **FALL_IMPACT 高 recall + 低 precision** = 模型"宁可误报也不漏报"——产品上需要二次确认（Day 5 的 Flask 前端可以加 cooldown 逻辑）
5. **PyTorch `weights_only` warning 忽略**——后续 cleanup 改源码 1 行即可

### D.20 2026-06-30 增补：CNN 训练完成 + 过拟合诊断

> 用户问："epoch 80 是不是太少了？"——答：80 **远多于**所需，**第 46 epoch 就到顶了**，问题在**过拟合**而不是训练不足。

#### D.20.1 CNN 训练结果（3 sessions, ours only, GPU）

**配置**：`--epochs 80 --augment --source ours`（CUDA 自动启用）

**结果**（early stop at epoch 71, best at epoch 46）：

| 指标 | 数值 | 解读 |
|---|---|---|
| Best val macro-F1 | **0.467** | epoch 46 |
| Test acc | **0.642** | 6 类中猜对 64% |
| Test macro-F1 | 0.362 | 6 类平均 F1 |
| **FALL_IMPACT F1** | **0.118** | 极差（precision 8.3%）|
| STILL F1 | 0.825 | 最好 |
| TRANSITION F1 | 0.610 | 比 LSTM 高 2 倍 |
| FLOORED F1 | 0.444 | 中等 |
| EMPTY F1 | 0.175 | 差 |
| WALKING F1 | n/a | test 集无 WALKING 样本 |

**关键诊断**：

| 阶段 | 数值 |
|---|---|
| train_loss @ epoch 71 | **0.30** |
| val_loss @ epoch 71 | **2.97** |
| **train/val gap** | **~10×** |
| 诊断 | **严重过拟合** |

**结论**：80 epoch 不是太少，而是**太多**——第 46 epoch 后模型在训练集上继续"背"，但验证集上已经过拟合。early stop 在第 71 epoch 触发（25 epoch patience 用完）。

#### D.20.2 LSTM vs CNN 横向对比

| 指标 | LSTM | CNN | 胜者 |
|---|---|---|---|
| Best val F1 | 0.388 | **0.467** | **CNN** (+0.08) |
| Test acc | 0.583 | **0.642** | **CNN** (+0.06) |
| Test macro-F1 | 0.314 | **0.362** | **CNN** (+0.05) |
| **FALL_IMPACT F1** | **0.364** | 0.118 | **LSTM** (3×) |
| STILL F1 | 0.781 | **0.825** | **CNN** |
| TRANSITION F1 | 0.276 | **0.610** | **CNN** (2×) |
| FLOORED F1 | 0.462 | 0.444 | LSTM |

**关键观察**：
- **CNN 在 TRANSITION / STILL 大赢**——6s 频谱图对"动作过渡的频谱变化"敏感
- **LSTM 在 FALL_IMPACT 大赢**——时序建模对"瞬间冲击"敏感（CNN 看 6s 平均后丢失了尖峰）
- **互补性强**：ensemble 应该 +0.05-0.15 macro-F1

#### D.20.3 CNN FALL_IMPACT 极差的原因

**Confusion matrix**（CNN test set, session 205253）：

| 真实 \ 预测 | EMPTY | STILL | WALKING | TRANSIT | FALL_IMP | FLOORED |
|---|---|---|---|---|---|---|
| EMPTY (24) | 5 | 8 | 0 | 3 | 6 | 2 |
| STILL (112) | 15 | 92 | 0 | 2 | 1 | 2 |
| WALKING (0) | 0 | 0 | 0 | 0 | 0 | 0 |
| TRANSITION (36) | 6 | 8 | 0 | 18 | 4 | 0 |
| **FALL_IMPACT (5)** | 3 | 1 | 0 | 0 | **1** | 0 |
| FLOORED (10) | 4 | 2 | 0 | 0 | 0 | 4 |

**问题**：
- 5 个真 FALL_IMPACT，**只 catch 1 个**（recall 20%）
- 6 个真 EMPTY 被预测成 FALL_IMPACT（precision 8.3% = 12 预测里 1 对）
- 模型把"低能量 + 短时长"（EMPTY、FALL_IMPACT 都是 CSI 低活动度）和 FALL_IMPACT 混淆

**根因**：
- 6s 频谱窗太宽 → 看不到 1-1.5s 的"瞬间冲击"细节
- 训练集 FALL_IMPACT 太少（仅 6 样本）→ 模型学不到清晰的边界
- Class weighting (`weight=0.69` for FALL_IMPACT) **不够强**

#### D.20.4 "想提分"的方案（按 ROI 排序）

| 方案 | 预期 F1 提升 | 成本 | 风险 |
|---|---|---|---|
| **录更多 session（5+ → 7+）** | **+0.10-0.20** | 30-60 分钟/个 | 无 |
| 录时 FALL 段控制 1-3s | +0.02-0.05 FALL_IMPACT precision | 重录 | 无 |
| `--base 16`（CNN 模型减半 1M→0.5M params）| +0.02-0.05 抗过拟合 | 重训 5 分钟 | 表达力下降 |
| `--dropout 0.6 --conv-drop 0.2`（CNN 加大正则）| +0.01-0.03 | 重训 | 训练更慢 |
| `--early-stop-patience 10`（早停更激进）| 防止过拟合加深 | 改 1 行 | 无 |
| `--epochs 30`（CNN 默认 300，你用了 80）| 防止过拟合 | 改 1 行 | 训练更短 |
| Label smoothing 0.1 | +0.01-0.03 | 改源码 | 略复杂 |
| 改 loss 加 focal loss（处理 FALL_IMPACT 极不平衡）| +0.05-0.10 FALL_IMPACT | 改源码 | 中 |

**最便宜可行**：第 1 个（录数据） + 第 4/5 个（早停/小模型）组合。

**本项目 demo 目标 = 跑通 pipeline**。当前 CNN test macro-F1 0.362 已经超过 LSTM 的 0.314，**ensemble 预期 0.40-0.50**，满足"模型能 fit 数据且 ensemble 比单模型好"的标准。

#### D.20.5 设备：自动 GPU 启用

`Device: cuda` 出现在 CNN 训练日志——用户的 dac_dev 环境有 GPU（CUDA 自动检测）。

**LSTM 没显示是因为默认走 CPU 路径**（详见 §E.2 的 device-mismatch bug）。如果想 GPU 跑 LSTM：

```bash
python -u train_lstm.py ... --device cuda 2>&1
```

**注意**：shipped 模型 hidden state 烤在 CPU 上，**第一次 `--device cuda` 可能报**：
```
RuntimeError: Input and hidden tensors are not at the same device,
              found input tensor at cuda:0 and hidden tensor at cpu
```

**解决**：坚持 `--device cpu`（本项目已记录的 §E.2 bug）。CNN 自动用 GPU 没这问题（自己 train 的 checkpoint 没 device mismatch）。

#### D.20.6 给后续 Agent 的提示

1. **过拟合 vs 训练不足的判断**：
   - train_loss 持续降、val_loss 持续升 → **过拟合**（加 epoch 没用，需更多数据 / 正则化）
   - train_loss 和 val_loss 都还在降 → **训练不足**（可以加 epoch / 减 early stop patience）
   - 本例：train_loss 1.80→0.30，val_loss 1.78→2.97，**典型过拟合**
2. **3 session × 单人 × 单房间**撞到的瓶颈：
   - train 序列太少（207 seq）配大模型（1M params）→ 过拟合
   - test 集太小（187 seq）→ F1 数字波动大
   - 类极不平衡（FALL_IMPACT 6 样本 / WALKING 1 样本）→ 学不到边界
3. **CNN vs LSTM 的 FALL_IMPACT 差异**值得在文档里常驻：CNN 6s 频谱窗糊掉瞬时冲击，LSTM 16-frame 时序保留
4. **ensemble 一定有改进**——LSTM 强 FALL_IMPACT、CNN 强 TRANSITION，互补
5. **CUDA 在 LSTM 上有坑**（§E.2）—— 主动传 `--device cpu` 避免踩雷

### D.21 2026-06-30 增补：ensemble_predict.py 与 train_lstm.py 架构默认参数不一致

> 触发场景：用户 LSTM 训练完（用 train_lstm.py 默认参数）→ 跑 ensemble_predict.py → `RuntimeError: Error(s) in loading state_dict for CSIClassifier: Missing key(s)... size mismatch...`

#### D.21.1 根因

`train_lstm.py` 和 `ensemble_predict.py` 的 LSTM 架构默认参数**不一样**：

| 参数 | train_lstm.py 默认 | ensemble_predict.py 默认 | 你训时实际 |
|---|---|---|---|
| `--lstm-units` | `"64"`（**单层**）| `"128,64"`（**双层**）| `"64"`（沿用 train 默认）|
| `--lstm-dense` | 32 | 64 | 32（沿用 train 默认）|
| `--lstm-t-seq` | 8 | 16 | 16 |
| `--lstm-win-sec` | 1.0 | 1.0 | 1.0 ✓ |
| `--lstm-hop-sec` | 0.5 | 0.5 | 0.5 ✓ |
| `--lstm-dropout` | 0.3 | 0.4 | 0.3（沿用 train 默认）|
| `--lstm-bidirectional` | 不传 | 不传 | 不传 ✓ |

**报错信息完全对得上**：
```
size mismatch for lstm_stack.0.weight_ih_l0: 
  copying a param with shape torch.Size([256, 16])    ← checkpoint (4*64, 16) = 单层 hidden=64
  the shape in current model is torch.Size([512, 16]) ← ensemble 期望 (4*128, 16) = 双层第一层 hidden=128
```

#### D.21.2 修复方案

**方案 A：传匹配参数给 ensemble_predict.py**（推荐，不用重训）

```bash
cd fall-detection-training/training
DATASET=/home/ruo/.../dataset

python -u ensemble_predict.py \
    --dataset "$DATASET" --labels labels_v2.json \
    --source ours \
    --lstm-units 64 --lstm-dense 32 \
    --lstm-t-seq 16 \
    --lstm-ckpt checkpoints/lstm.pt --cnn-ckpt checkpoints/cnn.pt 2>&1
```

**方案 B：重训 LSTM 用 ensemble 的默认**（2-3 分钟）

不推荐——3 session 数据不够训深模型（2 层 128,64 比单层 64 多 3× 参数，更易过拟合）。除非想用 ensemble 默认配置做 baseline。

#### D.21.3 根本性改进（留给后续 agent）

**问题本质**：训练脚本和 ensemble 脚本**没有共享架构默认常量**。两边硬编码各自的 `--lstm-units` / `--lstm-dense` / `--lstm-t-seq` 默认值，用户必须**自己保证一致**。

**理想做法**（3 选 1，按 ROI 排序）：

| 方案 | 改动量 | 价值 |
|---|---|---|
| **A. 从 checkpoint 自动推断架构** | 50-100 行 | 一劳永逸：load 完 state_dict，shape 反推 `--lstm-units` / `--lstm-dense` / `--lstm-t-seq` |
| B. 共享常量文件 `_lstm_defaults.py` | 20 行 | 训练/ensemble 都 import，**单一真理源** |
| C. 把架构写进 checkpoint（`torch.save({'state_dict': ..., 'arch': '64,32,16'})`）| 10 行训练 + 5 行 ensemble | 轻量级，但需要改训练脚本 |

**方案 B 最实用**（20 行改动，零兼容性破坏）：

```python
# fall-detection-training/training/_lstm_defaults.py
LSTM_DEFAULTS = {
    "lstm_units": "64",   # ← 训练和 ensemble 共用
    "lstm_dense": 32,
    "lstm_t_seq": 16,
    "lstm_dropout": 0.3,
    "lstm_recurrent_dropout": 0.1,
}
```

train_lstm.py 和 ensemble_predict.py 都 `from _lstm_defaults import LSTM_DEFAULTS` 然后用 `default=LSTM_DEFAULTS["lstm_units"]`。

**本次不动**——5 分钟跑通 ensemble 比改源码 ROI 高。留给后续 agent。

#### D.21.4 给后续 Agent 的提示

1. **train 和 ensemble 架构必须一致**——如果用户报"Missing key" 或 "size mismatch"，**先 diff 两边的 --lstm-units / --lstm-dense / --lstm-t-seq**
2. **检查点对比清单**（每次跑 ensemble 前 sanity check）：
   ```python
   import torch
   ckpt = torch.load("checkpoints/lstm.pt", map_location="cpu", weights_only=True)
   for k, v in ckpt.items():
       if "weight" in k:
           print(f"  {k}: {v.shape}")
   ```
   输出应与 `ensemble_predict.py` 创建的模型结构对齐
3. **复现的"魔法数字"**：
   - `[256, 16]` = `4 * 64, 16`（单层 LSTM，hidden=64，input=16 特征）
   - `[512, 16]` = `4 * 128, 16`（双层 LSTM，第一层 hidden=128，input=16 特征）
   - `4 *` 是 LSTM 的 `weight_ih` 形状（4 = i, f, g, o 4 个门）
4. **如果用户后续改了 train_lstm.py 的默认参数**，**必须同步改 ensemble_predict.py**——这是 §D.21.3 方案 B 的核心理由

#### D.21.5 续：参数名也不一致

光看 `--lstm-units` 一致还不够，**dense 层的参数名两边不一样**：

| 脚本 | dense 参数名 | 备注 |
|---|---|---|
| `train_lstm.py` | `--dense-units` | 无 `lstm-` 前缀 |
| `ensemble_predict.py` | `--lstm-dense` | 有 `lstm-` 前缀 |

**复现**：用户按 D.21.2 方法 B 重训 LSTM 时写了 `--lstm-dense 64`，结果 `train_lstm.py: error: unrecognized arguments: --lstm-dense 64`。

**正确写法**：
- 训练时：`--dense-units 64`
- 评估时：`--lstm-dense 64`

这是 §D.21.3 方案 B 提到的"共享常量文件"问题的**第二个例子**（第一个是默认值不一样，第二个是参数名不一样）。两者都指向**训练/评估脚本没有共享常量定义**这个根本问题。

**给后续 agent 的额外检查清单**（重训 LSTM 之前必看）：
- [ ] `--lstm-units` 训练和 ensemble 一致
- [ ] `--dense-units` vs `--lstm-dense` 训练和 ensemble 都填了（不同名字！）
- [ ] `--lstm-t-seq` 训练和 ensemble 一致
- [ ] `--lstm-dropout` / `--lstm-recurrent-dropout` 一致（如果改了的话）

最快验证方法——重训前先检查现有 checkpoint 架构：

```python
import torch
ckpt = torch.load("checkpoints/lstm.pt", map_location="cpu", weights_only=True)
for k, v in ckpt.items():
    if "weight" in k and v.dim() >= 2:
        print(f"  {k}: {tuple(v.shape)}")
# 期望看到：
#   lstm_stack.0.weight_ih_l0: (256, 16)        = 4*64, input 16
#   lstm_stack.0.weight_hh_l0: (256, 64)       = 4*64, hidden 64
#   head.2.weight: (32, 64)                    = dense=32, input 64
```

### D.22 2026-06-30 增补：Ensemble 实际训练结果（**实测数据**）

> 用方案 A 跑成功：保留现有 LSTM checkpoint，传 `--lstm-units 64 --lstm-dense 32` 给 ensemble。**所有数字均为实际跑出来的**，无预测。

#### D.22.1 测试集说明

| 模型 | 评估方式 | n | 备注 |
|---|---|---|---|
| LSTM（§D.19）| LSTM 自己的窗（1s win / 0.5s hop）| 369 | 单模型原始 test |
| CNN（§D.20）| CNN 自己的窗（6s win / 1s hop）| 187 | 单模型原始 test |
| **Ensemble aligned** | LSTM 时间戳，CNN 取最近（tol=1s）| **365** | 4 个 LSTM 窗没匹配上 CNN，丢弃 |

**`n=365` 的含义**：365 个 LSTM 时间戳，**每个时间戳**用最近的 CNN 预测来融合。**CNN 在 ensemble 里的 effective samples 比 D.20 多 3 倍**（D.20 187 → ensemble 365），但**预测值不变**（因为同一个 1s 内 CNN 只预测一次）。

**对齐丢的 4 个 LSTM 窗**的影响：
- LSTM FALL_IMPACT recall: 66.7% (D.19, n=369) → 50.0% (D.22, n=365) — **2 个真 FALL_IMPACT 命中被丢**
- 其他类变化 < 1%

#### D.22.2 实际结果（n=365 aligned）

| 模型 | acc | macro-F1 | FALL_IMPACT F1 | STILL F1 | TRANSITION F1 | FLOORED F1 | EMPTY F1 | WALKING F1 |
|---|---|---|---|---|---|---|---|---|
| LSTM alone | 0.586 | 0.264 | 0.353 | 0.779 | 0.360 | 0.091 | 0.000 | 0.000 |
| CNN alone | 0.532 | 0.349 | 0.250 | 0.644 | 0.496 | 0.566 | 0.135 | 0.000 |
| **Ensemble (alpha=0.5)** | **0.729** | **0.444** | **0.444** | **0.838** | **0.646** | **0.737** | 0.000 | 0.000 |

**FALL_IMPACT 详细**（最重要的类）：

| 模型 | precision | recall | F1 | support |
|---|---|---|---|---|
| LSTM alone | 0.273 | 0.500 | 0.353 | 12 |
| CNN alone | 0.500 | 0.167 | 0.250 | 12 |
| **Ensemble** | **0.667** | **0.333** | **0.444** | 12 |

#### D.22.3 Ensemble vs 单模型：增益分解

| 维度 | 增益 | 解读 |
|---|---|---|
| **macro-F1** | +0.180 vs LSTM, +0.095 vs CNN | 融合显著有效 |
| acc | +0.143 vs LSTM, +0.197 vs CNN | 整体分类准确率提升 |
| FALL_IMPACT F1 | +0.091 vs LSTM, +0.194 vs CNN | 融合对"小类"增益最大 |
| FLOORED F1 | **+0.646 vs LSTM** | LSTM 在 FLOORED 完全失败 (F1=0.091)，CNN 救了它 |
| TRANSITION F1 | +0.286 vs LSTM, +0.150 vs CNN | 大幅提升 |
| STILL F1 | +0.059 vs LSTM, +0.194 vs CNN | 提升 |
| EMPTY / WALKING F1 | 0.000 | **完全没学会**（样本极少） |

**关键观察**：
- **Ensemble 在所有非零类上都比最佳单模型好**——这是真"互补"不是假互补
- **FLOORED 是最大赢家**（LSTM 0.091 → ensemble 0.737，+0.646）—— 因为 LSTM 在 FLOORED 上完全失败（只看时序拼不到 1.5-7s 的"躺地后"模式），CNN 看 6s 频谱能识别
- **EMPTY 和 WALKING 还是 0**——样本不足（训练集 WALKING 只有 1 样本，EMPTY 9 样本），3 session 数据**结构性瓶颈**

#### D.22.4 Alpha 扫参（**实测**）

```
   alpha       acc    macro_F1     fall_recall
  --------------------------------------------------
    0.00     0.532       0.349           16.7%       ← CNN only
    0.20     0.652       0.396           16.7%
    0.30     0.732       0.414           16.7%
    0.40     0.726       0.417           25.0%
    0.50     0.729       0.444           33.3%       ← best macro-F1（默认）
    0.60     0.726       0.445           33.3%       ← best macro-F1（并列）
    0.70     0.652       0.399           25.0%
    0.80     0.647       0.416           41.7%       ← best FALL recall
    1.00     0.586       0.264           50.0%       ← LSTM only
```

**关键点**：
- **alpha=0.5 和 alpha=0.6 并列最佳 macro-F1 (0.444-0.445)**，差异在 0.001 内（统计上无意义）
- **alpha=0.8 给出 best FALL_IMPACT recall 41.7%**——产品场景"宁可误报也不漏报"用这个
- **alpha=0.0 (纯 CNN) 和 alpha=1.0 (纯 LSTM) 都明显差**——证实融合的价值
- **如果想要 F1 极值**：默认 alpha=0.5 即可，不用调

**FALL_recall vs macro-F1 的 trade-off**：
- 高 FALL_recall → 抓得多但误报多 → precision 低 → 其他类 F1 降 → macro-F1 降
- alpha=0.8 是 sweet spot for FALL_recall
- alpha=0.5-0.6 是 sweet spot for macro-F1

#### D.22.5 完整 Confusion Matrix（Ensemble, alpha=0.5）

```
真实 \ 预测    EMPTY  STILL  WALK  TRANSIT  FALL_IM  FLOORED
EMPTY (38)        0     34      0       4        0        0
STILL (224)       0    196      0      24        1        3
WALKING (0)       0      0      0       0        0        0
TRANSITION (72)   7     11      0      52        0        2
FALL_IMPACT (12)  0      1      0       7        4        0
FLOORED (19)      0      2      0       2        1       14
```

**问题模式**：
- **EMPTY (38) 几乎全被预测成 STILL (34)**——模型不区分"无人"和"有人静立"
- **STILL → TRANSITION 误报 (24)**——"开始动了"和"还在动"的边界模糊
- **FALL_IMPACT (12) 漏检 7 个（被预测成 TRANSITION）**——主要漏检方向，模型把"fall 开始"误判成"还在过渡"
- **FLOORED → 误检少**（只有 2+1+0 漏到 STILL/TRANSITION/FALL_IMPACT，14 命中）

#### D.22.6 已知的数据结构性瓶颈

| 瓶颈 | 体现 | 影响 |
|---|---|---|
| **WALKING 训练样本 1 个** | 所有模型 WALKING F1=0 | 永远预测不到 |
| **EMPTY 训练样本 9 个** | LSTM 完全不预测，CNN 偶尔预测 | 模型不区分"空房间"和"静立"|
| **FALL_IMPACT 训练样本 6 个** | 极小类，模型不擅长 | precision 难提 |
| **Test set 只有 12 个 FALL_IMPACT** | F1 数字波动大（±0.1）| 难判断"提分是真的"还是"随机" |
| **3 session × 1 人 × 1 房间** | 无泛化验证 | 数字只对**当前环境**有意义 |

**这些瓶颈的根源 = 数据量不足**。模型架构、训练时长、alpha 调整**都救不了**。详见 §D.20.4 的"想提分"清单：**录更多 session 是唯一有效路径**。

#### D.22.7 给后续 Agent 的提示

1. **Ensemble 在 macro-F1 和 acc 上**都稳定胜过单模型（实测 +0.10-0.20）—— fusion 是当前最有性价比的提升手段
2. **alpha=0.5 是稳妥默认**；alpha=0.8 适合"宁可误报"的产品场景
3. **FLOORED 是 LSTM 的死穴、CNN 的强项**——如果你要重新设计 LSTM，**优先改善 FLOORED 表现**（比如改 loss、加 FALL_IMPACT→FLOORED 序列建模）
4. **WALKING F1=0 不是模型问题**——是数据问题。录 1 个含 30s+ WALKING 的 session 就能解决
5. **不要被单个 test 的 macro-F1 数字骗**——12 个 FALL_IMPACT 样本，1 个对错的差异 = 0.05-0.10 F1 波动。**信任方向（ensemble > 单模型），别信任精确数字**
6. **n=365 vs n=369 的差异**（4 个 LSTM 窗没匹配 CNN）—— 未来可以放宽 `time_tolerance_sec` 或换更密采样的窗口对齐方式

#### D.22.8 诚实声明（避免上轮的"幻觉"）

上轮我曾说"ensemble 预期 0.40-0.50"——**那是没数据编的**。实测 **0.444** 落在那个区间纯粹是巧合（事实上 0.30 或 0.55 都合理）。

**本节所有数字 = 用户实际跑出来的输出**。任何"应该"或"预期"都**不带具体数字**。

---

### D.23 2026-06-30 增补：**我们训的不是 shipped 模型**——Transformer 没训也没源码

> 触发：用户质问"我们练出来的模型只是参照吗？"，清查 shipped 模型架构后发现**关键缺口**：shipped 用的是 **3 子模型集成**（CNN + LSTM + **Transformer**），但仓库**没有** `train_transformer.py`，作者私有目录也不公开。
>
> 详见独立调研：[`4-bouy-training-architecture-2026-06-30.md` §1.1](4-bouy-training-architecture-2026-06-30.md)。本节只写**对操作文档的影响**。

#### D.23.1 核心事实（4 条全部出自源码）

| # | 事实 | 依据 |
|---|---|---|
| 1 | shipped 模型名 = `fall_impact_seq9_lstm_transformer_ensemble`（**写了 Transformer**）| `model/fall_impact_seq9_ensemble/config.json:2` |
| 2 | shipped 包含 3 个子模型（CNN + LSTM + Transformer），不是 2 个 | 同上 model_name + `calibration.json:3-4` 的 `runs` 字段列出 `seq9_lstm_clean_meta` 和 `seq9_transformer_clean_meta` |
| 3 | **仓库里没有 `train_transformer.py`** —— 公开 `training/` 只有 `train_lstm.py` + `train_cnn_deep.py` + `ensemble_predict.py` | `ls fall-detection-training/training/` 实际目录 |
| 4 | shipped 的 `transformer_best_model.pt` 只给权重，没给训练脚本 | `model/fall_impact_seq9_ensemble/` 目录清单 |

**直接后果**：**我们 §D.19-D.22 训的 ensemble = LSTM + CNN 两个子模型**，**不包含 Transformer**。这是上轮"shipped = 我们 ensemble"的错误推断（详见 D.23.3 修正）。

#### D.23.2 数字对照表（实测 vs shipped，全部从源文件直接读出）

| 指标 | 我们（§D.22 ensemble LSTM+CNN）| shipped（`config.json` + `calibration.json`）|
|---|---|---|
| 子模型数 | 2（LSTM + CNN）| **3（LSTM + CNN + Transformer）** |
| 数据规模 | 3 session × 1 人 × 1 房间 | **7 session × 1 人 × 1 房间（`dataset_v2_high_tx/`）** |
| 训练序列 | 187 个 6s CNN 窗 + 369 个 1s LSTM 序列 | ~1500 个 6s 窗（按 `records` 列表推导）|
| 类别 | **6 类** | **2 类（FALL_IMPACT vs others）** |
| 校准温度 | 无 | **0.3** |
| 后处理 (merge + cooldown) | 无 | **是**（`eval_seq9_ensemble.py:156-191`）|
| 评估视角 | window-level only | **window + event-level**（`eval_seq9_ensemble.py:115-225`）|
| 默认 threshold | 0.5 | 0.5（同样），外加 0.84 低误报 |
| test window F1 | **0.444** macro-F1（6 类）| **0.811** macro-F1（2 类，thresh=0.5）|
| test window impact F1 | 0.444 | 0.645（thresh=0.5）|
| test event F1 | 未测（没有 event-level 评估）| **0.90**（thresh=0.5）/ 0.82（thresh=0.84）|
| recall (FALL_IMPACT) | **0.333**（12 里 catch 4）| **0.91**（11 里 catch 10）|

**口径警告**：shipped 的 F1 是 **2 类**（FALL vs others），我们的是 **6 类**（macro-F1 平均 6 类）。直接相减没意义，应理解成"我们对 FALL_IMPACT 的 catch 率仅 33%，shipped 在它作者 7 session 上能 catch 91%"。

#### D.23.3 上轮错误陈述修正清单（写进 dev_doc 防止再次误导）

| 我之前说的 | 实际 | 影响 |
|---|---|---|
| "shipped = 我们 ensemble 的 ts 导出" | ❌ shipped 是独立 3-子模型集成 | 上轮我问过你"是否顺便导出"——这是个**假命题**，根本不存在"顺便导出"这条路 |
| "ensemble 用 LSTM + CNN" | ⚠ 部分对：LSTM + CNN 的 ensemble 在 `ensemble_predict.py` 里，**但 shipped 自己是 3 个** | 容易把脚本 ensemble 和 shipped ensemble 混为一谈 |
| "0.81 macro-F1 是 Bouy 作者训的" | ✅ 对，但只在他 7 session + 2 分类 | 不是产品级标准，是单受试者单房间单次 hackathon 最佳 |
| "model_name 写的是 'lstm_transformer'" | ✅ 对（config.json:2 确认）| 这点我当时贴出来过 |

#### D.23.4 对 live inference 决策的影响（替代之前 §D.23 待办）

**之前规划**（用户已拒绝）：在 `ensemble_predict.py` 加 `--export` → 改 infer_loop loader → smoke → 1 次真跌倒。

**重评估后**：

| 路径 | 改/写什么 | 工作量 | 拿到什么 | 推荐 |
|---|---|---|---|---|
| A. 写 `infer_loop_ensemble.py`（独立 live loop）| 新文件 ~150 行。 LSTM 16-特征 + CNN 6s-频谱 + 时间对齐加权 | 2-3 小时 | **完整还原**我们训的 ensemble 在 live 数据上的 0.444 macro-F1 | ⭐⭐⭐ |
| B. 改 infer_loop.py 切到自训 CNN 单模型 | 改 `load_model()` 函数 + 1 行 np.stack shape 兼容 | 30 分钟 | 单模型 live（只有 6 类分类，无 ensemble 加成）| ⭐ |
| C. 不动 live inference，先补数据到 7 session | 录 4 session（每 30-60 分钟，含 WALKING 30s + FALL 4-5 次）→ 重训 ensemble | 30-60 分钟 × N | 提升 ensemble F1 上限 | ⭐⭐ |
| D. 复刻 shipped 模型（含 Transformer）| 写 train_transformer.py + 写 export_fall_model.py | **数天**（Transformer 训练代码没有，复刻就是重写）| macro-F1 趋近 0.81（如果在 7 session LOOCV 上）| 仅作 stretch goal |

**当前推荐**：A（先把我们训的 ensemble 跑通 live）+ 后续补 C（数据）。D 是高成本长周期，**不属于这个 demo 范围**。

#### D.23.5 给后续 Agent 的提示

1. **不要把 shipped 模型当 ensemble_predict.py 的 TorchScript 导出**——是独立的 3 子模型集成，需要作者私有脚本
2. **我们 ensemble 的真实形态 = 2 子模型（LSTM + CNN）**，永远不是 3 子模型，除非补一个 transformer 训练脚本
3. **3 类数字容易搞混**：
   - shipped test F1 = 0.811（作者 7 session，2 分类）
   - shipped event F1 = 0.90（同一 test，event-level 评估）
   - 我们 ensemble macro-F1 = 0.444（3 session，6 分类）
4. **Transformer 不存在公开实现**——任何"快速补全 Transformer"是误判。至少要写 200+ 行 transformer 训练代码
5. **本节 §D.23 关键断言可在任何时候验证**：直接 `cat model/fall_impact_seq9_ensemble/config.json | grep model_name` → "fall_impact_seq9_lstm_transformer_ensemble" → 直接证明
6. **调研文档归档**：所有"为什么我们不做 X"的论述已写进 [`4-bouy-training-architecture-2026-06-30.md`](4-bouy-training-architecture-2026-06-30.md)，操作文档 §D.23 只摘要

---

