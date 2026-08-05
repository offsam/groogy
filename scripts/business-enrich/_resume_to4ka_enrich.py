from __future__ import annotations
import json, os, sys, time, traceback
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('.').resolve()
sys.path.insert(0, str(ROOT / 'scripts' / 'import-review'))
sys.path.insert(0, str(ROOT / 'scripts' / 'business-enrich'))
from common import SupabaseRest, load_env
from publish_recommendation_catalog import fetch_all
from enrich_published_businesses import fetch_targets, enrich_one, apply_report

load_env()
client = SupabaseRest(os.environ['NEXT_PUBLIC_SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

OUT = ROOT / 'scripts' / 'business-enrich' / 'data' / 'to4ka_enrich'
OUT.mkdir(parents=True, exist_ok=True)
STATE = OUT / 'checkpoint.json'
LOG = OUT / 'run.log'

def log(msg: str) -> None:
    line = f"{datetime.now(timezone.utc).isoformat()} {msg}"
    print(line, flush=True)
    with LOG.open('a', encoding='utf-8') as f:
        f.write(line + '\n')

def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding='utf-8'))
    return {'done_ids': [], 'errors': [], 'started_at': datetime.now(timezone.utc).isoformat()}

def save_state(st: dict) -> None:
    st['updated_at'] = datetime.now(timezone.utc).isoformat()
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding='utf-8')

recs = fetch_all(
    client,
    '/import_comment_recommendations',
    'published_entity_id,display_name',
    extra={
        'directory_source': 'eq.to4ka',
        'kind': 'eq.profi',
        'status': 'eq.approved',
        'published_entity_type': 'eq.business',
    },
)
ids = [r['published_entity_id'] for r in recs if r.get('published_entity_id')]
# stable order
ids = list(dict.fromkeys(ids))

st = load_state()
st['finished_at'] = None
done = set(st.get('done_ids') or [])
todo = [i for i in ids if i not in done]
prev = st.get('stats') or {}
base_applied = int(prev.get('applied') or 0)
base_skipped = int(prev.get('skipped') or 0)
base_failed = int(prev.get('failed') or 0)
log(
    f'START to4ka enrich total={len(ids)} done={len(done)} todo={len(todo)} '
    f'(resume applied={base_applied})'
)
if todo:
    log(f'NEXT first id={todo[0]}')

applied = 0
skipped = 0
failed = 0
t0 = time.time()

for i, bid in enumerate(todo, 1):
    log(f'card {i}/{len(todo)} id={bid} global={len(done)+1}/{len(ids)}')
    try:
        targets = fetch_targets(client, limit=None, slug=None, id_=bid)
        if not targets:
            st.setdefault('errors', []).append({'id': bid, 'error': 'not found'})
            done.add(bid)
            failed += 1
        else:
            biz = targets[0]
            name = (biz.get('name') or '')[:60]
            rep = enrich_one(biz, client=client)
            if rep.get('skipped'):
                skipped += 1
            else:
                apply_report(client, rep)
                applied += 1
            done.add(bid)
            st['done_ids'] = list(done)
            st['stats'] = {
                'applied': base_applied + applied,
                'skipped': base_skipped + skipped,
                'failed': base_failed + failed,
                'todo_index': len(done),
                'todo_total': len(ids),
                'elapsed_s': int(time.time() - t0),
            }
            # Persist every card so the admin UI never looks frozen mid-batch.
            save_state(st)
            if i % 5 == 0 or i == len(todo) or i == 1:
                log(
                    f'progress {len(done)}/{len(ids)} applied={base_applied + applied} '
                    f'skipped={base_skipped + skipped} failed={base_failed + failed} '
                    f'elapsed={int(time.time()-t0)}s last={name}'
                )
        time.sleep(0.15)
    except Exception as exc:
        failed += 1
        err = f'{type(exc).__name__}: {exc}'[:300]
        st.setdefault('errors', []).append({'id': bid, 'error': err})
        done.add(bid)  # don't infinite-retry hard failures
        log(f'fail {bid}: {err}')
        if failed <= 5:
            log(traceback.format_exc()[-500:])
        st['done_ids'] = list(done)
        st['stats'] = {
            'applied': base_applied + applied,
            'skipped': base_skipped + skipped,
            'failed': base_failed + failed,
            'todo_index': len(done),
            'todo_total': len(ids),
            'elapsed_s': int(time.time() - t0),
        }
        save_state(st)

st['done_ids'] = list(done)
st['finished_at'] = datetime.now(timezone.utc).isoformat()
st['stats'] = {
    'applied': base_applied + applied,
    'skipped': base_skipped + skipped,
    'failed': base_failed + failed,
    'todo_index': len(done),
    'todo_total': len(ids),
    'elapsed_s': int(time.time() - t0),
}
save_state(st)
log(
    f'DONE applied={base_applied + applied} skipped={base_skipped + skipped} '
    f'failed={base_failed + failed} elapsed={int(time.time()-t0)}s'
)
print(json.dumps(st['stats'], ensure_ascii=False, indent=2), flush=True)