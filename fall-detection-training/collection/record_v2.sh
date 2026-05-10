#!/usr/bin/env bash
# record_v2.sh — thin wrapper for v2 (TX-raised) recording sessions.
#
# Usage:
#   ./record_v2.sh 01                              # subj01_v2_session01
#   ./record_v2.sh 02 "carpet, mat, evening"       # with notes
#   ./record_v2.sh 03 "different room" subj02      # different subject
#
# Saves to:  dataset_v2_high_tx/<subject>_v2_session<NN>/
#
# This is just a convenience wrapper around collect.py. It does NOT
# change any of collect.py's behavior — same UI, same controls,
# same output format (csi.npz + labels.json + metadata.json).

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <session_num> [notes] [subject]"
    echo "  e.g.:  $0 01"
    echo "         $0 02 \"forward falls only, mat\""
    echo "         $0 03 \"different room\" subj02"
    exit 2
fi

SESSION_NUM="$1"
NOTES="${2:-real take, TX raised}"
SUBJECT="${3:-subj01}"

# Pad session number to 2 digits
SESSION_NUM_PADDED=$(printf "%02d" "$((10#${SESSION_NUM}))")
SESSION_NAME="${SUBJECT}_v2_session${SESSION_NUM_PADDED}"
OUT_ROOT="dataset_v2_high_tx"

# Sanity: warn if the v1 dataset and v2 dataset both exist (just info)
if [[ -d "dataset" && -d "${OUT_ROOT}" ]]; then
    n_v2=$(find "${OUT_ROOT}" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
    echo "  (v1 dataset/ still present; v2 has ${n_v2} sessions so far)"
fi

cd "$(dirname "$0")"

echo "═══════════════════════════════════════════════════════════"
echo "  v2 recording session: ${SESSION_NAME}"
echo "  → ${OUT_ROOT}/${SESSION_NAME}/"
echo "  notes: ${NOTES}"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  Reminder: TX should be RAISED (above shoulder height)."
echo "  Press 0..4 / f / space / u / q in the matplotlib window."
echo ""

# Use the project's venv python if it exists, else system python3
if [[ -x ".venv/bin/python" ]]; then
    PYTHON=".venv/bin/python"
else
    PYTHON="python3"
fi

exec "${PYTHON}" collect.py \
    --session "${SESSION_NAME}" \
    --out-root "${OUT_ROOT}" \
    --subject "${SUBJECT}" \
    --notes "${NOTES}"
