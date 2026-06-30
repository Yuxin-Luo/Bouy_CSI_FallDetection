#!/bin/bash
# flash_rx.sh — flash csi_recv firmware onto an ESP32 RX board.
#
# Usage:
#     ./flash_rx.sh             # flashes one board, prompts for the next
#     ./flash_rx.sh --once      # flashes a single board and exits
#
# Prerequisites:
#   - Project's csi_recv build artifacts must already exist
#     (esp-csi/examples/get-started/csi_recv/build/flash_args)
#   - esptool installed in the active venv: pip install esptool
#   - Only ONE ESP32 plugged into the laptop at a time
#     (the script auto-detects whichever USB-serial port is currently visible)
#
# What it does:
#   1. Detects the lone connected ESP32 (/dev/cu.usbserial-* on macOS)
#   2. Asks you to confirm
#   3. Flashes csi_recv firmware
#   4. Loops to flash the next board, unless --once was passed

set -e

ONCE_MODE=false
if [[ "$1" == "--once" ]]; then
    ONCE_MODE=true
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BUILD_DIR="$SCRIPT_DIR/esp-csi/examples/get-started/csi_recv/build"
FLASH_ARGS="$BUILD_DIR/flash_args"

if [[ ! -f "$FLASH_ARGS" ]]; then
    echo "ERROR: csi_recv build artifacts not found."
    echo "  Expected: $FLASH_ARGS"
    echo ""
    echo "  Build the firmware first by running this in the project root:"
    echo "    docker run --rm -v \"\$PWD\":/project -w /project -it espressif/idf:release-v6.0 bash"
    echo "    cd esp-csi/examples/get-started/csi_recv"
    echo "    idf.py set-target esp32 && idf.py build"
    exit 1
fi

if ! python -m esptool version >/dev/null 2>&1; then
    echo "ERROR: esptool not available in the current Python environment."
    echo "  Run: pip install esptool"
    exit 1
fi

flash_one_board() {
    echo ""
    echo "════════════════════════════════════════════════════════════════════"
    echo "  Flash an RX board"
    echo "════════════════════════════════════════════════════════════════════"
    echo ""
    echo "  Plug in ONE ESP32 board. Unplug all other boards if any are connected."
    echo ""
    read -p "  Press Enter when the board is plugged in (Ctrl+C to abort)... " _

    # Find the lone connected port (macOS + Linux compatible).
    #   macOS : /dev/cu.usbserial-*  /  /dev/cu.SLAB_USBtoUART
    #   Linux : /dev/ttyUSB*  /  /dev/ttyACM*
    local detected
    # shellcheck disable=SC2012
    detected=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | head -n 1 || true)

    if [[ -z "$detected" ]]; then
        echo ""
        echo "  ✗ No ESP32 detected on USB."
        echo "    - Is the cable data-capable (not charge-only)?"
        echo "    - Try a different USB port on your laptop."
        echo "    - Try a different cable from the 3-pack."
        echo "    - On Linux: are you in the 'dialout' group? (sudo usermod -aG dialout \$USER)"
        echo "    - On macOS: check System Report → USB"
        return 1
    fi

    # Verify exactly one is plugged in
    local count
    count=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$count" -gt 1 ]]; then
        echo ""
        echo "  ⚠ Multiple ESP32 boards detected:"
        ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART /dev/ttyUSB* /dev/ttyACM* 2>/dev/null | sed 's/^/      /'
        echo "    Please unplug all but one — the script can only safely flash"
        echo "    one at a time."
        return 1
    fi

    echo ""
    echo "  ✓ Found board on:  $detected"
    echo ""
    read -p "  Flash this board with csi_recv? [Y/n] " confirm
    if [[ "$confirm" =~ ^[Nn] ]]; then
        echo "  Skipped."
        return 0
    fi

    echo ""
    echo "  Flashing... (5-10 seconds)"
    echo ""

    cd "$BUILD_DIR"
    if python -m esptool \
        --chip esp32 --port "$detected" -b 460800 \
        --before default-reset --after hard-reset \
        write-flash "@flash_args"; then
        echo ""
        echo "  ✓ Flash successful on $detected"
        echo ""
        echo "  This board now runs csi_recv. You can:"
        echo "    - Unplug it (firmware is persisted in flash memory)"
        echo "    - Label it with tape (e.g. RX1 / RX2 / etc.)"
        return 0
    else
        echo ""
        echo "  ✗ Flash failed."
        echo "    Common fix: hold the BOOT button on the board for the first"
        echo "    2 seconds of 'Connecting...' on the next attempt."
        return 1
    fi
}

# Track how many we've flashed in this session
flashed=0
failed=0

while true; do
    if flash_one_board; then
        flashed=$((flashed + 1))
    else
        failed=$((failed + 1))
    fi

    if [[ "$ONCE_MODE" == "true" ]]; then
        break
    fi

    echo ""
    echo "  Session totals: $flashed flashed, $failed failed."
    echo ""
    read -p "  Flash another board? [y/N] " another
    if [[ ! "$another" =~ ^[Yy] ]]; then
        break
    fi
done

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "  Done.  Flashed $flashed board(s) this session."
if [[ "$failed" -gt 0 ]]; then
    echo "  ($failed flashing attempts failed — see notes above)"
fi
echo "════════════════════════════════════════════════════════════════════"
