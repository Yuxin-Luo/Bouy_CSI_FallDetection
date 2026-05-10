#!/usr/bin/env bash
# delete_v2.sh — companion to record_v2.sh. Deletes one v2 session folder.
#
# Usage:
#   ./delete_v2.sh 05                 # deletes subj01_v2_session05
#   ./delete_v2.sh 05 -y              # skip confirmation
#   ./delete_v2.sh 05 -y subj02       # different subject
#
# Saves the contents of the session into a /tmp tarball before nuking,
# so you have ~24h to recover if you delete the wrong one.

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 <session_num> [-y] [subject]"
    echo "  e.g.:  $0 05"
    echo "         $0 05 -y"
    exit 2
fi

cd "$(dirname "$0")"

SESSION_NUM="$1"
SKIP_CONFIRM="no"
SUBJECT="subj01"

# Parse remaining args
shift
for arg in "$@"; do
    case "$arg" in
        -y|--yes) SKIP_CONFIRM="yes" ;;
        *)        SUBJECT="$arg" ;;
    esac
done

SESSION_NUM_PADDED=$(printf "%02d" "$((10#${SESSION_NUM}))")
SESSION_NAME="${SUBJECT}_v2_session${SESSION_NUM_PADDED}"
TARGET="dataset_v2_high_tx/${SESSION_NAME}"

if [[ ! -d "${TARGET}" ]]; then
    echo "  Nothing to delete — ${TARGET} does not exist."
    echo ""
    echo "  Existing v2 sessions:"
    if compgen -G "dataset_v2_high_tx/*/" > /dev/null; then
        ls -1 dataset_v2_high_tx/ | grep -v '\.md$' | sed 's/^/    /'
    else
        echo "    (none)"
    fi
    exit 1
fi

# Show what we're about to delete
echo "About to delete: ${TARGET}"
if [[ -f "${TARGET}/metadata.json" ]]; then
    DURATION=$(python3 -c "import json; print(round(json.load(open('${TARGET}/metadata.json'))['duration_sec'],1))" 2>/dev/null || echo "?")
    NOTES=$(python3 -c "import json; print(json.load(open('${TARGET}/metadata.json')).get('notes','')[:60])" 2>/dev/null || echo "")
    echo "  duration: ${DURATION}s"
    [[ -n "${NOTES}" ]] && echo "  notes:    ${NOTES}"
fi
if [[ -f "${TARGET}/labels.json" ]]; then
    N_FALLS=$(python3 -c "import json; L=json.load(open('${TARGET}/labels.json')); print(sum(1 for s in L['segments'] if s['class']=='FALL'))" 2>/dev/null || echo "?")
    echo "  falls:    ${N_FALLS}"
fi
echo ""

# Confirm unless -y was passed
if [[ "${SKIP_CONFIRM}" != "yes" ]]; then
    read -r -p "Delete this session? [y/N] " ANS
    if [[ "${ANS,,}" != "y" && "${ANS,,}" != "yes" ]]; then
        echo "Aborted — nothing deleted."
        exit 0
    fi
fi

# Stash a backup tarball under /tmp before nuking, just in case
BACKUP_DIR="/tmp/csi_v2_deleted"
mkdir -p "${BACKUP_DIR}"
BACKUP_FILE="${BACKUP_DIR}/${SESSION_NAME}_$(date +%Y%m%d_%H%M%S).tar.gz"
tar -czf "${BACKUP_FILE}" "${TARGET}" 2>/dev/null || true
echo "  backup: ${BACKUP_FILE}"

rm -rf "${TARGET}"
echo "  ✓ deleted ${TARGET}"

# Also kill any stale feature cache files that include the session,
# so the next training run doesn't try to load features for a folder
# that no longer exists.
rm -f .features_cache_*.npz 2>/dev/null || true
echo "  ✓ cleared feature caches (.features_cache_*.npz) — next train will rebuild"
