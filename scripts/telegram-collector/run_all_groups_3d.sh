#!/usr/bin/env bash
# Collect last 3 days from all allowlisted Telegram sources → reviewer_v1 → admin queue.
# Incremental: extract uses --no-replace so existing pending backlog is kept.
# One Telethon session: sequential only.
set -euo pipefail
cd "$(dirname "$0")"
PY="./.venv/bin/python"
ROOT="$(cd ../.. && pwd)"
LOG_DIR="/tmp/tg_collect_3d"
mkdir -p "$LOG_DIR"

# Default: last 3 calendar days ending today (UTC)
DATE_TO="${DATE_TO:-$(date -u +%Y-%m-%d)}"
if [[ "$(uname)" == "Darwin" ]]; then
  DATE_FROM="${DATE_FROM:-$(date -u -v-3d +%Y-%m-%d)}"
else
  DATE_FROM="${DATE_FROM:-$(date -u -d '3 days ago' +%Y-%m-%d)}"
fi
MAX_COST="${MAX_COST:-15}"
PROVIDER="${PROVIDER:-openai}"
MODEL="${MODEL:-gpt-4o-mini}"
WORKERS="${WORKERS:-4}"

# TSV: prefix <TAB> chat_id <TAB> group_label <TAB> chat_title
# Matches lib/import-review/telegram-sources.ts
GROUPS_TSV=$(cat <<'EOF'
sacramento_adaptation	-1001733592780	Sacramento_Adaptation	Sacramento adaptation
sacramento_rusrek	-1001677357732	Sacramento_RusRek	Sacramento RusRek work
sacramento_rent_rusrek	-1001822893749	Sacramento_Rent_RusRek	Sacramento rent RusRek
sf_rusrek	-1001573930932	SF_RusRek	SF RusRek work
sf_general	-1001252383425	SF_General	SF general chat
sd_rusrek	-1001877641731	SD_RusRek	SD RusRek work
sd_general	-1001261966562	SD_General	SD general chat
fun_for_mom	-1001333533747	Fun for Mom	Fun for Mom
la_orange_county	-1001955320601	LA_OrangeCounty	LA Orange County
irvine_friends	-1001880131921	Irvine_Friends	Irvine Friends
la_rent_rusrek	-1001731302416	LA_Rent_RusRek	LA rent RusRek
russians_in_la	-1001432677353	Russians_in_LA	Russians in LA
ny_rusrek_chat	-1001464240281	NY_RusRek_Chat	NY RusRek work/rent
ny_chat	-1002850187194	NY_Chat	NY chat
ny_rusrek_general	-1003825095230	NY_RusRek_General	NY RusRek general
ny_group	-1002064800703	NY_Group	NY group chat
ny_for_everyone	-1001430570565	NY_For_Everyone	NY for everyone
ny_svoi	-1001898722612	NY_Svoi	NY Svoi
seattle_rusrek	-1001868225046	Seattle_RusRek	Seattle RusRek
miami_rusrek	-1001611457559	Miami_RusRek	Miami RusRek
miami_ru	-1001555481989	Miami_Ru	Russians in Miami
houston_rusrek	-1001785045165	Houston_RusRek	Houston RusRek
chicago_rusrek	-1001175902107	Chicago_RusRek	Chicago RusRek
atlanta_chat	-1001889280623	Atlanta_Chat	Atlanta chat
atlanta_rent_work	-1001876028760	Atlanta_Rent_Work	Atlanta rent/work
denver_rusrek	-1001725647772	Denver_RusRek	Denver RusRek
philadelphia_rusrek	-1001600919901	Philadelphia_RusRek	Philadelphia RusRek
phoenix_rusrek	-1001832048676	Phoenix_RusRek	Phoenix RusRek
boston_rusrek	-1001615012228	Boston_RusRek	Boston RusRek
EOF
)

reset_checkpoint() {
  local prefix="$1"
  if [[ "$prefix" == "fun_for_mom" ]]; then
    rm -f "data/full_run_checkpoint.json"
    rm -f "data/full/${prefix}_summary.json"
    rm -f "data/full/${prefix}_accepted.json"
    rm -f "data/full/${prefix}_needs_review.json"
    rm -f "data/full/${prefix}_rejected.json"
    rm -f "data/full/${prefix}_reviewer_v1.json"
    # Old batches would be merged into finalize — wipe so 3d window stays clean
    if [[ -d "data/full/batches" ]]; then
      rm -rf "data/full/batches"
    fi
  else
    rm -f "data/$prefix/full_run_checkpoint.json"
    rm -f "data/$prefix/full/${prefix}_summary.json"
    rm -f "data/$prefix/full/${prefix}_accepted.json"
    rm -f "data/$prefix/full/${prefix}_needs_review.json"
    rm -f "data/$prefix/full/${prefix}_rejected.json"
    rm -f "data/$prefix/full/${prefix}_reviewer_v1.json"
    if [[ -d "data/$prefix/full/batches" ]]; then
      rm -rf "data/$prefix/full/batches"
    fi
  fi
  echo "reset checkpoint/summary/batches for $prefix" | tee -a "$LOG_DIR/master.log"
}

build_reviewer() {
  local prefix="$1"
  PREFIX="$prefix" "$PY" - <<'PY'
import json, os
from pathlib import Path
prefix = os.environ["PREFIX"]
if prefix == "fun_for_mom":
    base = Path("data") / "full"
else:
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

echo "=== ALL groups 3d collect start $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee "$LOG_DIR/master.log"
echo "DATE_FROM=$DATE_FROM DATE_TO=$DATE_TO MAX_COST=$MAX_COST PROVIDER=$PROVIDER MODEL=$MODEL" | tee -a "$LOG_DIR/master.log"

while IFS=$'\t' read -r PREFIX CHAT_ID GROUP_LABEL TITLE; do
  [[ -z "${PREFIX:-}" ]] && continue
  echo "" | tee -a "$LOG_DIR/master.log"
  echo "=== START $PREFIX ($GROUP_LABEL) chat=$CHAT_ID $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG_DIR/master.log"

  reset_checkpoint "$PREFIX"

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

  if [[ "$PREFIX" == "fun_for_mom" ]]; then
    ACCEPTED="data/full/${PREFIX}_accepted.json"
  else
    ACCEPTED="data/$PREFIX/full/${PREFIX}_accepted.json"
  fi
  if [[ ! -f "$ACCEPTED" ]]; then
    echo "MISSING accepted for $PREFIX — abort remaining" | tee -a "$LOG_DIR/master.log"
    exit 1
  fi

  build_reviewer "$PREFIX" | tee -a "$LOG_DIR/master.log"

  (
    cd "$ROOT"
    PYTHONUNBUFFERED=1 python3 scripts/telegram-collector/extract_telegram_recommendations.py \
      --groups "$GROUP_LABEL" --apply --no-replace
  ) 2>&1 | tee "$LOG_DIR/${PREFIX}_extract.log" | tee -a "$LOG_DIR/master.log"

  echo "=== DONE $PREFIX $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG_DIR/master.log"
done <<< "$GROUPS_TSV"

echo "=== ALL groups finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ===" | tee -a "$LOG_DIR/master.log"
