# 4 — Bouy 固件 patch 应用到 esp-csi 源码（2026-06-28）

> **状态**：✅ Patch 已应用 + flash 脚本已修
> **下一步**：在 Docker `espressif/idf:release-v6.0` 容器内 `idf.py build`，然后 `./flash_tx.sh` / `./flash_rx.sh` 烧录
> **关联**：`fall-detection-training/firmware/firmware_patches/README.md`（bouy 自带 patch 说明）

---

## 1.1 目标

把 `fall-detection-training/firmware/firmware_patches/` 里两份**已 patch 的 app_main.c** 应用到本机 `git clone` 出来的 `esp-csi` 仓库的 `examples/get-started/csi_{send,recv}/main/app_main.c`，并修 flash 脚本以支持 Linux（bouy 原脚本只认 macOS 串口）。

---

## 1.2 实际做了什么

| 步骤 | 文件 | 操作 | 大小变化 |
|---|---|---|---|
| 1 | `firmware/esp-csi/examples/get-started/csi_send/main/app_main.c` | 备份到 `.original_esp-csi_backup/csi_send_app_main.c.orig` | 6290 B → 保留 |
| 2 | `firmware/esp-csi/examples/get-started/csi_send/main/app_main.c` | 用 `firmware_patches/csi_send_app_main.c` 覆盖 | → 6268 B |
| 3 | `firmware/esp-csi/examples/get-started/csi_recv/main/app_main.c` | 备份到 `.original_esp-csi_backup/csi_recv_app_main.c.orig` | 11546 B → 保留 |
| 4 | `firmware/esp-csi/examples/get-started/csi_recv/main/app_main.c` | 用 `firmware_patches/csi_recv_app_main.c` 覆盖 | → 11524 B |
| 5 | `fall-detection-training/firmware/flash_tx.sh` | macOS 串口检测补 Linux 路径 | 2 处 `ls` |
| 6 | `fall-detection-training/firmware/flash_rx.sh` | 同上 | 2 处 `ls` |

**备份策略**：`.original_esp-csi_backup/`（带前导点，git 默认忽略）——如需回滚，逆向 `cp` 即可。

---

## 1.3 patch 实际改动（关键点 diff）

> **小注**：bouy 的 `firmware_patches/README.md` 说 "RX: Filters incoming CSI by sender MAC" 是 patch 加的——**不对**。原版 `esp-csi/examples/get-started/csi_recv/main/app_main.c` 第 144 行就有 `memcmp(info->mac, CONFIG_CSI_SEND_MAC, 6)`。patch 真正做的事是**给 TX 端固定这个 MAC 地址**（`1a:00:00:00:00:00`）；不固定的话 RX 端的过滤等于摆设。
>
> 建议同步修正 `firmware_patches/README.md`（未做，留待后续 review）。

### csi_send：HT40 → BW40 + channel 11 → 6 + 固定 sender MAC

```diff
- #define CONFIG_LESS_INTERFERENCE_CHANNEL   11
+ #define CONFIG_LESS_INTERFERENCE_CHANNEL   6
- #define CONFIG_WIFI_2G_BANDWIDTHS           WIFI_BW_HT40
- #define CONFIG_WIFI_5G_BANDWIDTHS           WIFI_BW_HT40
+ #define CONFIG_WIFI_2G_BANDWIDTHS           WIFI_BW40
+ #define CONFIG_WIFI_5G_BANDWIDTHS           WIFI_BW40
- #define CONFIG_WIFI_BANDWIDTH               WIFI_BW_HT40
+ #define CONFIG_WIFI_BANDWIDTH               WIFI_BW40
- // (HT20 checks in wifi_init)
+ // (BW20 checks in wifi_init, same logic, renamed enum)
  static const uint8_t CONFIG_CSI_SEND_MAC[] = {0x1a, 0x00, 0x00, 0x00, 0x00, 0x00};
  esp_wifi_set_mac(WIFI_IF_STA, CONFIG_CSI_SEND_MAC);  // ← 关键：固定 MAC
```

### csi_recv：HT40 → BW40 + channel 11 → 6 + 复用 TX 端固定 MAC

```diff
- #define CONFIG_LESS_INTERFERENCE_CHANNEL   11
+ #define CONFIG_LESS_INTERFERENCE_CHANNEL   6
- #define CONFIG_WIFI_2G_BANDWIDTHS           WIFI_BW_HT40
+ #define CONFIG_WIFI_2G_BANDWIDTHS           WIFI_BW40
- #define CONFIG_WIFI_BANDWIDTH               WIFI_BW_HT40
+ #define CONFIG_WIFI_BANDWIDTH               WIFI_BW40
  // wifi_csi_rx_cb():
  if (memcmp(info->mac, CONFIG_CSI_SEND_MAC, 6)) {  // 原版就有，patch 复用
      return;
  }
  esp_wifi_set_mac(WIFI_IF_STA, CONFIG_CSI_SEND_MAC);  // RX 也设成同 MAC（实际意义仅占位）
```

**为什么 TX 端固定 MAC 是关键**：
- `CONFIG_CSI_SEND_MAC = {0x1a, 00, 00, 00, 00, 00}` 是手工指定的；
- 如果不固定，ESP32 上电后 MAC 随机生成，RX 端的 `memcmp` 永远失败，所有 CSI 帧被丢弃；
- 同时也避免和房间内其他 ESP32 / 路由器的 MAC 撞车。

---

## 1.4 flash 脚本跨平台改动

### 改动前（macOS-only）

```bash
detected=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART 2>/dev/null | head -n 1)
```

Linux 下 `/dev/cu.*` 不存在，脚本会直接报 "No ESP32 detected"，连 esptool 都进不去。

### 改动后（macOS + Linux）

```bash
detected=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -n 1)
```

- `/dev/ttyUSB*` — CH340 / CP2102 / FT232 系列 USB-UART 桥接芯片
- `/dev/ttyACM*` — ESP32-S3 自带 USB-CDC（部分开发板）
- Linux 用户权限提示：若未授权，需 `sudo usermod -aG dialout $USER`（已在 `flash_rx.sh` 错误信息里加）

### 平台对比速查

| 平台 | 串口设备 | udev 组 |
|---|---|---|
| macOS | `/dev/cu.usbserial-*` / `/dev/cu.SLAB_USBtoUART` | 无（首次需允许"安全与隐私"）|
| Linux | `/dev/ttyUSB*` / `/dev/ttyACM*` | `dialout` |

---

## 1.5 还没做的事（下一步清单）

- [ ] **构建固件**（Docker 内）：
      ```bash
      cd fall-detection-training/firmware
      docker run --rm -v "$PWD":/project -w /project -it espressif/idf:release-v6.0 bash
      # 容器内：
      cd esp-csi/examples/get-started/csi_send
      idf.py fullclean && idf.py set-target esp32 && idf.py build
      cd ../../csi_recv
      idf.py set-target esp32 && idf.py build
      exit
      ```
- [ ] **烧录**：插 TX 板跑 `./flash_tx.sh`；拔 TX 插 RX 板跑 `./flash_rx.sh --once`（1T1R 拓扑；bouy 的循环烧 4 块 RX 模式不适用）
- [ ] **首次上电验证**：USB 串口接 PC，开 `minicom -D /dev/ttyUSB0 -b 115200`，应看到 `================ CSI RECV ================` + `CSI_DATA,...` 行
- [ ] **CSV 输出收集**：`grep '^CSI_DATA' /dev/ttyUSB0 > csi_log.csv`（bouy 训练管线是这么干的，A/B 阶段再换成 UDP）
- [ ] **修正 `firmware_patches/README.md`**：把"RX: Filters incoming CSI by sender MAC"的说法改成"复用上游已有的 MAC 过滤；patch 真正做的是给 TX 端固定这个 MAC"
- [ ] **把 `.original_esp-csi_backup/` 加进 `.gitignore`**（避免误提交）

---

## 1.6 与本项目（A/B 阶段方案）的兼容性

| 维度 | bouy patch 应用后 | A 阶段方案要求 | 是否要再改 |
|---|---|---|---|
| 拓扑 | 1 TX + N RX（bouy 用 4；项目用 1）| 1 TX + 1 RX | **不用改代码**（烧录时只烧 1 块 RX 即可）|
| 信道 | 6 | 1 / 11 | ⚠️ 暂不调，先按 patch 走通 |
| 带宽 | BW40 | HT20 | ⚠️ 暂不调，先按 patch 走通 |
| 输出 | 串口 CSV（`ets_printf`）| **JSON + UDP** | ❌ **A 阶段必改**：参考父项目 `4-solution-design-2026-06-26.md` §2.4 Step A1 |
| 发送方式 | STA + ESP-NOW | AP + Null-Data | ❌ **A 阶段可能要改**（取决于 ESP-NOW 在 S3 上的稳定性）|
| 板子 | ESP32 | ESP32-S3 | ⚠️ 烧录时 `idf.py set-target esp32s3`（代码本身已 `#if CONFIG_IDF_TARGET_ESP32S3` 兼容）|

**当前任务边界**：用户原话「转移固件代码并加入 bouy patch 修改 esp-csi 源码然后下载固件」——**只到"应用 patch + 准备烧录"为止**。A 阶段的"JSON + UDP"、"HT20"、"AP 模式"改造是下一阶段任务，**不在本次范围内**。

---

## 1.7 决策可追溯

| 决策 | 依据 |
|---|---|
| 直接覆盖而非 patch -p1 | `firmware_patches/README.md` §How to apply 第 2 步明确写 `cp ... ...`，原项目就是简单 copy 模式 |
| 备份到 `.original_esp-csi_backup/` | 带前导点 → git 默认忽略；`esp-csi/` 整体已 git 忽略（`README.md` §Files 末注："the full `esp-csi/` SDK clone is excluded from git"）|
| 修 flash 脚本而非另写 | bouy 的 shell 脚本是单文件、用户已用；改最少行数保持兼容性 |
| 跨平台检测不改 platform 判断 | `ls` 列出来即可，无 board 是空、不需要 uname 跨平台 |
| 序号从 1 开始 | 子项目 CLAUDE.md §12「下一步」示例 `1-bouy-codebase-walkthrough-2026-06-26.md` 明确从 1 开始 |
| dev_doc 放在 `Bouy_CSI_FallDetection/dev_doc/` | 子项目 CLAUDE.md §8.1 强制（**已修正歧义**：原版只写"存入 `dev_doc/`"，未说明是子项目还是父项目）|

---

## 1.8 待澄清事项

1. **固件构建环境**：本机有 `espressif/idf:release-v6.0` Docker 镜像吗？如没有，需要先 `docker pull`（约 1-2 GB，30+ 秒）
2. **目标板确认**：原话是"ESP32-S3"——bouy 训练用的 `espcam-tools` 系列 ESP32 还是更便宜的那批？`idf.py set-target esp32` 还是 `esp32s3`？
3. **WiFi 信道 + 带宽**：是按 patch 默认（ch6, BW40）跑通，还是 A 阶段一开始就要切到（ch1/ch11, HT20）？建议先按 patch 跑通，再切。
4. **flash 平台**：开发机是 Linux（已修脚本）还是 macOS（不需要改）？——根据当前 `dev_doc` 路径 `Bouy_CSI_FallDetection/` 在 Linux ext4 上，**开发机是 Linux**

---

**完成度**：3/5（patch 应用 ✅ / flash 脚本 ✅ / dev_doc ✅；构建 ⏸ / 烧录 ⏸）
**总耗时**：约 5 分钟（纯文件操作）
**风险等级**：低（无源码语义改动，仅 macro 改名 + MAC 固定 + 平台兼容）
