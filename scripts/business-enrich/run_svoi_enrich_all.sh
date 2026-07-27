#!/usr/bin/env bash
# Detailed svoi enrichment + publish loop until queue is empty.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG_DIR="$ROOT/scripts/business-enrich/data/svoi_enrich"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/full_run_$(date -u +%Y%m%dT%H%M%SZ).log"
BATCH="${BATCH_SIZE:-50}"
SLEEP="${SLEEP_S:-0}"

echo "Starting detailed svoi full run batch=$BATCH sleep=$SLEEP log=$LOG" | tee -a "$LOG"

round=0
while true; do
  round=$((round + 1))
  echo "" | tee -a "$LOG"
  echo "===== ROUND $round $(date -u +%Y-%m-%dT%H:%M:%SZ) =====" | tee -a "$LOG"
  set +e
  out=$(python3 scripts/business-enrich/enrich_svoi_directory.py \
    --apply --publish --any-region --include-persons \
    --limit "$BATCH" --sleep "$SLEEP" 2>&1)
  code=$?
  set -e
  printf '%s\n' "$out" | tee -a "$LOG"
  last_targets=$(printf '%s\n' "$out" | grep -E '^targets=' | tail -1 | sed -E 's/.*targets=([0-9]+).*/\1/' || true)
  echo "Last targets=${last_targets:-?} exit=$code" | tee -a "$LOG"
  if [[ "$code" -ne 0 ]]; then
    echo "Batch error — pause 45s" | tee -a "$LOG"
    sleep 45
    continue
  fi
  if [[ "${last_targets:-0}" -eq 0 ]]; then
    echo "Queue empty. Done." | tee -a "$LOG"
    break
  fi
done
