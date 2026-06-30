# Firmware patches

These two files are the modified versions of Espressif's `esp-csi` example
firmware that this project actually flashes onto the boards. They live here
so the patches survive even though the full `esp-csi/` SDK clone is excluded
from git (it's huge and a third-party repo).

## Files

### `csi_send_app_main.c` — TX board firmware

**bouy v1 patch** (originally shipped with this repo, kept as `.bouy_v1.bak`):
- `WIFI_BW_HT40` → `WIFI_BW40` (IDF v6 renamed the enum)
- Fixed sender MAC: `1a:00:00:00:00:00` (lets RX firmware filter to one TX)
- `CONFIG_LESS_INTERFERENCE_CHANNEL`: 11 → 6 (bouy training sessions)
- `CONFIG_SEND_FREQUENCY`: 50 → 100 Hz (bouy training sessions)

**v2 patch added 2026-06-28** (S3 support, backport from `../Mycode`):
- `#ifndef WIFI_BW_HT20 / WIFI_BW_HT40` compatibility shim — lets this source
  compile under IDF v5 too (if we ever fall back from the v6.0 Docker image)

### `csi_recv_app_main.c` — RX board firmware

**bouy v1 patch** (originally shipped with this repo, kept as `.bouy_v1.bak`):
- `WIFI_BW_HT20` → `WIFI_BW20` for the same IDF v6 rename
- `CONFIG_LESS_INTERFERENCE_CHANNEL`: 11 → 6 (bouy training sessions)
- Reuses the upstream `memcmp(info->mac, CONFIG_CSI_SEND_MAC, 6)` sender-MAC
  filter that already exists in stock `esp-csi` — patch doesn't add this, it
  just relies on the TX end actually fixing its MAC so the filter does
  anything. (Old README wording was misleading on this point.)

**v2 patch added 2026-06-28** (S3 support, backport from `../Mycode`):
- `#ifndef WIFI_BW_HT20 / WIFI_BW_HT40` compatibility shim (same as TX)
- ESP32-S3 `first_word_invalid` byte-skip in `wifi_csi_rx_cb` — on S3 the first
  4 bytes of `info->buf` can be stale LTF metadata instead of CSI subcarriers;
  this skip keeps the Python parser aligned. Logic mirrors Mycode
  `csi_recv/app_main.c` lines 212-226.

## How to apply

1. Clone the upstream Espressif SDK alongside this repo:
   ```bash
   git clone --depth 1 https://github.com/espressif/esp-csi.git
   ```
2. Overwrite the two example main files with the copies in this folder:
   ```bash
   cp firmware_patches/csi_send_app_main.c \
      esp-csi/examples/get-started/csi_send/main/app_main.c
   cp firmware_patches/csi_recv_app_main.c \
      esp-csi/examples/get-started/csi_recv/main/app_main.c
   ```
3. Build inside the official IDF Docker image:
   ```bash
   docker run --rm -v "$PWD":/project -w /project -it \
     espressif/idf:release-v6.0 bash
   # inside the container:
   cd esp-csi/examples/get-started/csi_send
   idf.py fullclean && idf.py set-target esp32s3 && idf.py build  # ← S3
   # repeat for csi_recv
   ```
4. Flash from the host using the helper scripts at the repo root:
   `./flash_tx.sh` and `./flash_rx.sh`.

## Why pin to IDF v6.0 specifically

`espressif/idf:latest` and `release-v6.1` are missing the precompiled
`libesp_csi_gain_ctrl.a` binary the example links against. v6.0 ships it,
so the build works out of the box. The `#ifndef` shim added in v2 lets the
same source also build under v5.x if we ever need to.

## Rollback to bouy v1 (drop S3 changes)

If the S3-specific changes cause issues and you want the original bouy-only
patch back:
```bash
cd firmware_patches
cp .csi_send_app_main.c.bouy_v1.bak csi_send_app_main.c
cp .csi_recv_app_main.c.bouy_v1.bak csi_recv_app_main.c
# then re-apply per "How to apply" step 2
```
