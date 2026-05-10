#!/bin/bash
# flash_tx.sh — flash csi_send firmware onto the ESP32 TX board.
#
# Usage:
#     ./flash_tx.sh
#
# This script:
#   1. Verifies the csi_send build artifacts exist
#   2. Detects the lone ESP32 plugged in
#   3. Asks you to confirm
#   4. Flashes csi_send (the transmitter firmware)
#
# Prerequisites:
#   - csi_send rebuilt after channel change
#   - esptool installed in the active venv
#   - ONLY the TX board plugged in (script refuses if it sees multiple)

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BUILD_DIR="$SCRIPT_DIR/esp-csi/examples/get-started/csi_send/build"
FLASH_ARGS="$BUILD_DIR/flash_args"

if [[ ! -f "$FLASH_ARGS" ]]; then
    echo "ERROR: csi_send build artifacts not found."
    echo "  Expected: $FLASH_ARGS"
    echo ""
    echo "  Build the firmware first by running this in the project root:"
    echo "    docker run --rm -v \"\$PWD\":/project -w /project -it espressif/idf:release-v6.0 bash"
    echo "    cd esp-csi/examples/get-started/csi_send"
    echo "    idf.py fullclean && idf.py set-target esp32 && idf.py build"
    exit 1
fi

if ! python -m esptool version >/dev/null 2>&1; then
    echo "ERROR: esptool not available. Run: pip install esptool"
    exit 1
fi

echo "════════════════════════════════════════════════════════════════════"
echo "  Flash the TX board with csi_send firmware"
echo "════════════════════════════════════════════════════════════════════"
echo ""
echo "  Plug in ONLY the TX board. Unplug all RX boards."
echo ""
read -p "  Press Enter when ready (Ctrl+C to abort)... " _

# shellcheck disable=SC2012
detected=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART 2>/dev/null | head -n 1 || true)

if [[ -z "$detected" ]]; then
    echo ""
    echo "  ✗ No ESP32 detected on USB. Check the cable + USB port."
    exit 1
fi

count=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART 2>/dev/null | wc -l | tr -d ' ')
if [[ "$count" -gt 1 ]]; then
    echo ""
    echo "  ⚠ Multiple ESP32 boards detected:"
    ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART 2>/dev/null | sed 's/^/      /'
    echo "    Unplug all but the TX board and try again."
    exit 1
fi

echo ""
echo "  ✓ Found board on:  $detected"
echo ""
read -p "  Flash this board with csi_send (TX)? [Y/n] " confirm
if [[ "$confirm" =~ ^[Nn] ]]; then
    echo "  Aborted."
    exit 0
fi

echo ""
echo "  Flashing..."
echo ""

cd "$BUILD_DIR"
if python -m esptool \
    --chip esp32 --port "$detected" -b 460800 \
    --before default-reset --after hard-reset \
    write-flash "@flash_args"; then
    echo ""
    echo "════════════════════════════════════════════════════════════════════"
    echo "  ✓ TX flash successful on $detected"
    echo ""
    echo "  Label this board 'TX' with tape if not already."
    echo "  Then: unplug, plug in your RX boards, and run ./flash_rx.sh"
    echo "════════════════════════════════════════════════════════════════════"
else
    echo ""
    echo "  ✗ Flash failed."
    echo "    Try holding the BOOT button on the board for the first"
    echo "    2 seconds of 'Connecting...' on the next attempt."
    exit 1
fi
