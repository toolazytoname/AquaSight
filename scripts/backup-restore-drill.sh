#!/usr/bin/env bash
# Backup/restore drill against the STAGING worker + staging D1.
# Destructive steps touch only the staging database — never production.
#
# Usage: scripts/backup-restore-drill.sh [staging-base-url]
set -euo pipefail

BASE="${1:-https://aquasight-staging.lazywc.workers.dev}"
BACKUP="$(mktemp -t staging-backup)"
SEED="$(mktemp -t staging-seed)"
trap 'rm -f "$BACKUP" "$SEED"' EXIT

step() { printf '\n== %s ==\n' "$1"; }

step "1/6 seed staging via import-backup"
cat > "$SEED" <<'JSON'
{
  "events": [
    ["drill:e1", {"id": "drill:e1", "title": "Drill event one", "source": "hn", "category": "tech", "publishedAt": "2026-09-23T00:00:00.000Z"}],
    ["drill:e2", {"id": "drill:e2", "title": "Drill event two", "source": "bbc", "category": "public", "publishedAt": "2026-09-23T01:00:00.000Z"}],
    ["drill:e3", {"id": "drill:e3", "title": "Drill event three", "source": "36kr", "category": "business", "publishedAt": "2026-09-23T02:00:00.000Z"}]
  ],
  "articles": [
    ["drill:a1", {"id": "drill:a1", "title": "Member one", "source": "hn", "url": "https://example.com/1"}],
    ["drill:a2", {"id": "drill:a2", "title": "Member two", "source": "verge", "url": "https://example.com/2"}]
  ],
  "members": [["drill:e1", ["drill:a1", "drill:a2"]], ["drill:e2", ["drill:a2"]]],
  "articleEvent": [["drill:a1", "drill:e1"]],
  "prefs": {"blockedSources": ["v2ex"], "instantNotifyEnabled": false},
  "feedback": [],
  "reads": [],
  "favorites": [],
  "cache": [],
  "notifications": [],
  "tasks": [],
  "sourceHealth": [],
  "snapshots": []
}
JSON
SEED_HTTP=$(curl -fsS --max-time 30 -X POST "$BASE/api/v1/import-backup" \
  -H "content-type: application/json" --data-binary @"$SEED")
echo "seed response: $SEED_HTTP" | head -c 200; echo

step "2/6 export the seeded state"
curl -fsS --max-time 30 "$BASE/api/v1/export" > "$BACKUP"
python3 - "$BACKUP" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
dump = d.get("dump", d)
print("exported events:", len(dump.get("events", [])), "articles:", len(dump.get("articles", [])), "members:", len(dump.get("members", [])))
assert len(dump.get("events", [])) == 3, "expected 3 events in export"
PY

step "3/6 wipe staging D1 (destructive, staging only)"
npx wrangler d1 execute aquasight-staging --remote --env staging --config worker/wrangler.toml \
  --command "DELETE FROM events; DELETE FROM event_members; DELETE FROM articles; DELETE FROM article_event_map; DELETE FROM preferences;"

step "4/6 confirm staging is empty"
LEFT=$(curl -fsS --max-time 30 "$BASE/api/v1/events?view=latest&limit=1" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('items', [])))")
echo "items after wipe: $LEFT"
[ "$LEFT" = "0" ] || { echo "FAIL: staging not empty after wipe"; exit 1; }

step "5/6 restore from the exported backup"
RESTORE_HTTP=$(curl -fsS --max-time 30 -X POST "$BASE/api/v1/import-backup" \
  -H "content-type: application/json" --data-binary @"$BACKUP")
echo "restore response: $RESTORE_HTTP" | head -c 200; echo

step "6/6 verify restored state matches"
curl -fsS --max-time 30 "$BASE/api/v1/events?view=latest&limit=10" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ids = sorted(it["id"] for it in d.get("items", []))
print("restored ids:", ids)
assert ids == ["drill:e1", "drill:e2", "drill:e3"], "restore incomplete: " + str(ids)
print("drill PASSED: export -> wipe -> import-backup roundtrip restored all events")
'
curl -fsS --max-time 30 "$BASE/api/v1/events/drill:e1" | python3 -c "import json,sys; d=json.load(sys.stdin); m=[a.get('source') for a in d.get('members',[])]; print('drill:e1 member sources:', m); assert m == ['hn','verge'], m" \
  || { echo "FAIL: members not restored"; exit 1; }
echo "drill PASSED: members restored with the event"
