#!/usr/bin/env bash
# Collect remaining CA city Telegram groups → reviewer_v1 → admin queue.
# One Telethon session: sequential only.
set -euo pipefail
cd "$(dirname "$0")"
PY="./.venv/bin/python"
ROOT="$(cd ../.. && pwd)"
LOG_DIR="/tmp/ca_tg_collect"
mkdir -p "$LOG_DIR"
DATE_FROM="${DATE_FROM:-2026-01-27}"
DATE_TO="${DATE_TO:-2026-07-27}"
MAX_COST="${MAX_COST:-15}"
PROVIDER="${PROVIDER:-openai}"
MODEL="${MODEL:-gpt-4o-mini}"
WORKERS="${WORKERS:-4}"

# TSV: prefix <TAB> chat_id <TAB> group_label <TAB> chat_title
GROUPS_TSV=$(cat <<'EOF'
sacramento_rusrek	-1001677357732	Sacramento_RusRek	Sacramento RusRek work
sf_rusrek	-1001573930932	SF_RusRek	SF RusRek work
sf_general	-1001252383425	SF_General	SF general chat
sd_rusrek	-1001877641731	SD_RusRek	SD RusRek work
sd_general	-1001261966562	SD_General	SD general chat
EOF
)

build_reviewer() {
  local prefix="$1"
  PREFIX="$prefix" "$PY" - <<'PY'
import json, os
from pathlib import Path
prefix = os.environ["PREFIX"]
base = Path("data") / prefix / "full"
acc = json.loads((base / f"{prefix}_accepted.json").read_text())
nr = json.loads((base / f"{prefix}_needs_review.json").read_text())
posts = (acc.get("posts") or []) + (nr.get("posts") or [])
out = {
  "meta": {**(nr.get("meta") or {}), "reviewer": "passthrough_from_llm_v1", "posts": len(posts)},
  "posts": posts,
}
path = base / f"{prefix}_reviewer_v1.json"
path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
print(f"wrote {path} posts={len(posts)}", flush=True)
PY
}

echo "=== CA city collect start $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee "$LOG_DIR/master.log"

while IFS=$'\t' read -r PREFIX CHAT_ID GROUP_LABEL TITLE; do
  [[ -z "${PREFIX:-}" ]] && continue
  echo "" | tee -a "$LOG_DIR/master.log"
  echo "=== START $PREFIX ($GROUP_LABEL) chat=$CHAT_ID $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG_DIR/master.log"

  skip_collect=0
  if [[ -f "data/$PREFIX/full/${PREFIX}_summary.json" ]]; then
    status=$("$PY" -c "import json; print(json.load(open('data/$PREFIX/full/${PREFIX}_summary.json')).get('status',''))")
    if [[ "$status" == "completed" ]]; then
      echo "collect already completed for $PREFIX — skip LLM" | tee -a "$LOG_DIR/master.log"
      skip_collect=1
    fi
  fi

  if [[ "$skip_collect" -eq 0 ]]; then
    TELEGRAM_ANALYZER_MODE=llm \
    TELEGRAM_LLM_PROVIDER="$PROVIDER" \
    TELEGRAM_LLM_MODEL="$MODEL" \
    TELEGRAM_LLM_MAX_COST_USD="$MAX_COST" \
    PYTHONUNBUFFERED=1 \
    "$PY" run_full.py \
      --chat-id "$CHAT_ID" \
      --prefix "$PREFIX" \
      --chat-title "$TITLE" \
      --date-from "$DATE_FROM" \
      --date-to "$DATE_TO" \
      --workers "$WORKERS" \
      --max-cost-usd "$MAX_COST" \
      --llm-provider "$PROVIDER" \
      --llm-model "$MODEL" \
      --confirm-run \
      2>&1 | tee "$LOG_DIR/${PREFIX}_collect.log" | tee -a "$LOG_DIR/master.log"
  fi

  if [[ ! -f "data/$PREFIX/full/${PREFIX}_accepted.json" ]]; then
    echo "MISSING accepted for $PREFIX — abort remaining" | tee -a "$LOG_DIR/master.log"
    exit 1
  fi

  build_reviewer "$PREFIX" | tee -a "$LOG_DIR/master.log"

  (
    cd "$ROOT"
    PYTHONUNBUFFERED=1 python3 scripts/telegram-collector/extract_telegram_recommendations.py \
      --groups "$GROUP_LABEL" --apply
  ) 2>&1 | tee "$LOG_DIR/${PREFIX}_extract.log" | tee -a "$LOG_DIR/master.log"

  echo "=== DONE $PREFIX $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG_DIR/master.log"
done <<< "$GROUPS_TSV"

echo "=== ALL CA city groups finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG_DIR/master.log"
