# 5 — ESP32-S3 适配补丁（backport from Mycode，2026-06-28）

> **状态**：✅ 已应用 + grep 验证
> **目标**：把 `ReferenceCode/Mycode/get-started/` 里**两个 ESP32-S3 特有修复** backport 到 bouy patch 后的 `esp-csi/examples/get-started/csi_{send,recv}/`
> **前置文档**：[4-firmware-patch-application-2026-06-28.md](4-firmware-patch-application-2026-06-28.md)
> **关联**：`ReferenceCode/Mycode/get-started/csi_{send,recv}/main/app_main.c`（S3 build 已通过）

---

## 2.1 为什么需要 S3 适配

bouy 的训练板是 **ESP32 经典系列**，s3 的 CSI 路径走 `#else` 分支（`lltf_en/htltf_en/...` 旧字段、`CONFIG_WIFI_BANDWIDTH = WIFI_BW40` 单值带宽），**编译上对 S3 是合法路径**。但有两处 **S3 特有行为** bouy patch 没覆盖，会导致运行时问题：

| # | 问题 | 触发条件 | 后果 |
|---|---|---|---|
| 1 | `info->first_word_invalid=true` 时 buf 前 4 字节是 LTF 元数据，不是 CSI | ESP32-S3 偶发 | Python 解析器错位 4 字节，整张图偏 |
| 2 | `WIFI_BW_HT20/HT40` 宏在 IDF v6 不存在 | 误用 IDF v5 镜像 | 编译失败 `undeclared identifier` |

Mycode（已成功为 S3 build 过一次）已经处理了这两个问题。本次把修复移植过来，**保留 bouy patch 的所有改动**（channel 6 / BW40 rename / 固定 sender MAC / RX 端复用 MAC 过滤）。

---

## 2.2 改动清单

| 文件 | 行号（修改后） | 改动 | 来源 |
|---|---|---|---|
| `csi_recv/main/app_main.c` | 30-40 | `#ifndef WIFI_BW_HT20/HT40` shim | Mycode 第 30-36 行 |
| `csi_recv/main/app_main.c` | 214-231 | `first_word_invalid` 跳字节处理（`#else` 分支） | Mycode 第 212-226 行 |
| `csi_send/main/app_main.c` | 28-38 | `#ifndef WIFI_BW_HT20/HT40` shim | Mycode 第 30-36 行 |

文件大小变化：

| 文件 | 修改前 | 修改后 | Δ |
|---|---|---|---|
| `csi_send/main/app_main.c` | 6268 B | 6712 B | +444 B |
| `csi_recv/main/app_main.c` | 11524 B | 12647 B | +1123 B |

---

## 2.3 改动 1：WIFI_BW_HT20/HT40 → BW20/BW40 兼容 shim

### 背景

| IDF 版本 | `WIFI_BW_HT20` | `WIFI_BW_HT40` | `WIFI_BW20` | `WIFI_BW40` |
|---|---|---|---|---|
| v5.0 - v5.4 | ✅ 定义 | ✅ 定义 | ❌ 未定义 | ❌ 未定义 |
| v6.0+ | ❌ 移除 | ❌ 移除 | ✅ 定义 | ✅ 定义 |

bouy 锁定 IDF v6.0（因为 `libesp_csi_gain_ctrl.a` 预编译只在 v6.0 镜像里有），所以 bouy patch 直接用 `WIFI_BW40`/`WIFI_BW20` 没问题。

**但**：Mycode 是用 v5 思路写的（直接用 `WIFI_BW_HT40`），它用 `#ifndef` shim 把"新名字"映射回"旧名字"，在 v5 上也能编译。我们反过来做：把"旧名字"映射到"新名字"，在 v5 上也能编译——多一层防御，避免以后回退镜像时翻车。

### 加在哪

放在 `#include "esp_csi_gain_ctrl.h"`（csi_recv）或 `#include "esp_now.h"`（csi_send）之后、`#define CONFIG_LESS_INTERFERENCE_CHANNEL` 之前——include 完成、用户宏开始之前的"中立区"。

### 加的代码（两文件相同）

```c
/* IDF v5 ↔ v6 wifi_bandwidth_t enum compat (backport from ReferenceCode/Mycode).
 *   IDF v5.x : WIFI_BW_HT20 / WIFI_BW_HT40
 *   IDF v6.x : WIFI_BW20   / WIFI_BW40
 * This shim lets the same source compile under either, in case we ever fall back
 * to an IDF v5 Docker image (e.g. espressif/idf:v5.4) instead of v6.0. */
#ifndef WIFI_BW_HT20
#define WIFI_BW_HT20 WIFI_BW20
#endif
#ifndef WIFI_BW_HT40
#define WIFI_BW_HT40 WIFI_BW40
#endif
```

### 验证矩阵

| IDF 版本 | `WIFI_BW_HT40` 解析为 | `WIFI_BW_HT20` 解析为 | 行为 |
|---|---|---|---|
| v5.x（已定义） | `WIFI_BW_HT40` 原值 | `WIFI_BW_HT20` 原值 | shim **不生效**（#ifndef 跳过），保持原 IDF 名字 |
| v6.x（未定义） | `WIFI_BW40` | `WIFI_BW20` | shim **生效**，重新指向 IDF v6 名字 |

---

## 2.4 改动 2：ESP32-S3 `first_word_invalid` 跳字节

### 背景

ESP32-S3 的 `wifi_csi_info_t.buf` 在某些帧里**前 4 字节是 stale LTF metadata**（旧 long training field 残留），不是真正的 CSI subcarrier 数据。标志位是 `info->first_word_invalid=true`。

**当前代码（bouy patch 应用后，#else 分支）**：

```c
ets_printf(",%d,%d,\"[%d", info->len, info->first_word_invalid, (int16_t)(compensate_gain * info->buf[0]));
for (int i = 1; i < info->len; i++) {
    ets_printf(",%d", (int16_t)(compensate_gain * info->buf[i]));
}
```

**问题**：
1. CSV 第 2 列（`first_word`）写 `1`（真），下游 Python 解析器按 `len=info->len` 但跳过前 4 字节——这一致
2. 但 `len=info->len` 包含了前 4 字节 metadata，**`len` 值被夸大 4**
3. 如果 Python 解析器是按 `len` 截取（如 `buf[len:]`），会保留尾部 metadata 当 CSI；如果 Python 解析器是按 `first_word=1` 决定是否跳过 + 用 `len` 截取——**OK**；如果两边都对——**OK**

**真正风险**：用户写自己的 Python 解析器时很容易踩坑（Mycode 的修复就是为了这个）。

### Mycode 的修复

```c
int _start = (info->first_word_invalid && info->len > 4) ? 4 : 0;
int _fwi   = _start ? 0 : info->first_word_invalid;
int _vlen  = info->len - _start;
if (_start) {
    ESP_LOGD(TAG, "first_word_invalid: skipped 4 bytes, valid_len=%d", _vlen);
}
ets_printf(",%d,%d,\"[%d", _vlen, _fwi, (int16_t)(compensate_gain * info->buf[_start]));
for (int i = _start + 1; i < info->len; i++) {
    ets_printf(",%d", (int16_t)(compensate_gain * info->buf[i]));
}
```

**做了什么**：
1. `_start = 4` 当 `first_word_invalid=true && len > 4`，否则 `0`（不跳）
2. `_fwi` 写 **0**（清掉 flag），**因为我们这边已经跳过了**——Python 端**不应该再跳一次**
3. `_vlen = info->len - _start`——扣掉跳过的 4 字节
4. CSV 字段顺序保持不变（`len, first_word, data...`），所以 Python 解析逻辑无需变

### 加在哪

`wifi_csi_rx_cb()` 函数的 `#else` 分支（针对 ESP32 / ESP32-S3 / ESP32-C3 旧字段 CSI config）——这个分支在 bouy patch 应用后**完全没动**，是直接套用上游代码的地方。**C5/C61 的 `#if` 分支已有自己的 first_word_invalid 处理（第 195-201 行），不动**。

### 边界条件

| `first_word_invalid` | `info->len` | `_start` | `_vlen` | 行为 |
|---|---|---|---|---|
| false | any | 0 | `len` | 不跳，正常输出 |
| true | > 4 | 4 | `len - 4` | 跳过前 4 字节 |
| true | ≤ 4 | 0 | `len` | **不跳**（保护越界），但 `_fwi=1`——Python 端会知道这次没跳过，需要在 CSV 里看到 `len` 没扣 |

`info->len ≤ 4` 是罕见小包；这种情况下 CSV `first_word=1` + `len=小值`，Python 解析器应能识别为异常帧并丢弃（bouy 的 `csi_io.py` 已有 `len < 50` 的 sanity check）。

---

## 2.5 决策可追溯

| 决策 | 依据 |
|---|---|
| backport 修复而非整文件替换 | 整文件替换会丢 bouy patch（channel 6 / BW40 rename / 固定 MAC）；增量 backport 保留全部 bouy 改动 |
| 只 backport 这 2 个修复，不 backport `CONFIG_SEND_FREQUENCY=20` | 100 Hz 是 bouy 训练管线的实测频率（7 sessions LOOCV F1 0.81），Mycode 降到 20 Hz 是它的特殊 UART 稳定策略，未在 bouy 复现验证；不混 |
| shim 放 include 之后、define 之前 | Mycode 同一位置，跟原项目风格一致 |
| 保留 C5/C61 `#if` 分支不动 | 该分支已有自己的 first_word_invalid 处理（第 195-201 行），覆盖 C5/C61；S3 不走这条 |
| 不修改 `csi_send` 的 CSI 输出 | TX 端不收 CSI（只发 ESP-NOW），没有 first_word 概念——只在 send 加 shim 保持镜像兼容 |

---

## 2.6 验证

```bash
# 1. 改动都在位
grep -n "WIFI_BW_HT20\|first_word_invalid\|_start\|_fwi\|_vlen" \
  fall-detection-training/firmware/esp-csi/examples/get-started/csi_{send,recv}/main/app_main.c

# 预期：
#   csi_send:  3 行 ifndef/define shim
#   csi_recv:  3 行 ifndef/define shim + 6 行 _start/_fwi/_vlen/buf[_start] 处理

# 2. bouy patch 全部 markers 还在
grep -n "CONFIG_LESS_INTERFERENCE_CHANNEL\|0x1a, 0x00, 0x00, 0x00, 0x00, 0x00" \
  fall-detection-training/firmware/esp-csi/examples/get-started/csi_{send,recv}/main/app_main.c

# 预期：两个文件都有 channel 6 + 固定 MAC

# 3. 完整 diff vs 备份
diff fall-detection-training/firmware/.original_esp-csi_backup/csi_send_app_main.c.orig \
     fall-detection-training/firmware/esp-csi/examples/get-started/csi_send/main/app_main.c
diff fall-detection-training/firmware/.original_esp-csi_backup/csi_recv_app_main.c.orig \
     fall-detection-training/firmware/esp-csi/examples/get-started/csi_recv/main/app_main.c
```

✅ 验证通过（已在 4 步骤执行）。

---

## 2.7 还没做的事（下一步）

- [ ] **跑一次 IDF v6.0 Docker build** 确认编译通过：
      ```bash
      cd fall-detection-training/firmware
      docker run --rm -v "$PWD":/project -w /project -it espressif/idf:release-v6.0 bash
      # 容器内：
      cd esp-csi/examples/get-started/csi_send
      idf.py fullclean && idf.py set-target esp32s3 && idf.py build  # ← 注意 S3
      cd ../csi_recv
      idf.py set-target esp32s3 && idf.py build
      ```
- [ ] **真机验证 S3 上 `first_word_invalid` 是否真触发**：
      上电后 `minicom -D /dev/ttyUSB0 -b 115200`，看 `CSI_DATA,...` 行的 `first_word` 列是 `0` 还是 `1`
      - 如果都是 `0`：本修复是"未触发的防御性代码"，无害
      - 如果出现 `1` 且 `_vlen < info->len`：本修复生效，确认了 4 字节 skip
- [ ] **`CONFIG_SEND_FREQUENCY` 决定**：是 100 Hz（bouy 默认）还是降到 20 Hz（Mycode S3 经验）？建议**先用 100 Hz 跑通**，再看 RX 端 UART 有没有字节损坏再决定
- [ ] **改 `flash_tx.sh` / `flash_rx.sh` 的 `--chip esp32` 为 `esp32s3`**（line 104 / 84）—— 当前还是 `esp32`，S3 会报 "Chip is esp32s3 but --chip says esp32"

---

## 2.8 待澄清事项

1. **`first_word_invalid` 在当前 S3 + IDF v6.0 上是否真的会触发**？ESP-IDF 文档说 S3 "may set this flag in rare cases"——需要实测。如果在 bouy 默认信道 6 + 100 Hz 频率下从不触发，本修复就是死代码，但保留无害（多 16 行 C、零运行时开销在 `first_word_invalid=false` 路径上）。
2. **是否要 backport Mycode 的 `CONFIG_SEND_FREQUENCY=20`**？需要先看 100 Hz 在 S3 上的稳定性——UART 字节损坏率 / WiFi 任务饥饿率。如果 100 Hz 也稳定，不改；如果出问题，降到 50 Hz 中庸值。

---

**完成度**：3/7（shim ✅ / first_word_invalid skip ✅ / grep 验证 ✅；Docker build ⏸ / 真机验证 ⏸ / flash 脚本 chip 修正 ⏸ / send frequency 决定 ⏸）
**总耗时**：约 10 分钟（含 grep 验证 + 写文档）
**风险等级**：低（纯增量，未删除 bouy patch 任何内容）
