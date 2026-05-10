# Firmware patches

These two files are the modified versions of Espressif's `esp-csi` example
firmware that this project actually flashes onto the boards. They live here
so the patches survive even though the full `esp-csi/` SDK clone is excluded
from git (it's huge and a third-party repo).

## Files

- `csi_send_app_main.c` — TX board firmware. Patched relative to upstream:
  - `WIFI_BW_HT40` → `WIFI_BW40` (IDF v6 renamed the enum)
  - Fixed sender MAC: `1a:00:00:00:00:00` (lets RX firmware filter to one TX)
- `csi_recv_app_main.c` — RX board firmware. Patched relative to upstream:
  - `WIFI_BW_HT20` → `WIFI_BW20` for the same IDF v6 rename
  - Filters incoming CSI by sender MAC so the RX only logs frames from our TX

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
3. Build inside the official IDF Docker image (host Mac can't build IDF
   directly because Docker can't pass through USB, but it can build the
   binaries — flashing is then done from the host with `esptool`):
   ```bash
   docker run --rm -v "$PWD":/project -w /project -it \
     espressif/idf:release-v6.0 bash
   # inside the container:
   cd esp-csi/examples/get-started/csi_send
   idf.py fullclean && idf.py set-target esp32 && idf.py build
   # repeat for csi_recv
   ```
4. Flash from the Mac (outside Docker) using the helper scripts at the repo
   root: `./flash_tx.sh` and `./flash_rx.sh`.

## Why pin to IDF v6.0 specifically

`espressif/idf:latest` and `release-v6.1` are missing the precompiled
`libesp_csi_gain_ctrl.a` binary the example links against. v6.0 ships it,
so the build works out of the box.
