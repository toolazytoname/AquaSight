/**
 * Cross-day digest dedup. The 24h selection window happily re-picks the
 * previous morning's stories (2026-09-26: 7 of 10 items repeated 09-25), so
 * today's candidate set is matched against the published digests of the
 * previous days. Matching is strict — event id, member article id overlap,
 * or canonical source URL overlap — and every match is excluded. A re-crawl,
 * syndicated copy, or a slightly newer timestamp is NOT evidence of a
 * substantive update, so there is no automatic re-inclusion path: without
 * reliable, verified evidence of a new fact, the story stays out. Empty
 * slots are NOT refilled with repeats.
 */

import { canonicalizeUrl } from "./hash.js";

export const DEDUP_HISTORY_DAYS = 3;

export function prevDigestDates(date, days = DEDUP_HISTORY_DAYS) {
  const t = Date.parse(String(date || "") + "T00:00:00Z");
  if (!Number.isFinite(t)) return [];
  const out = [];
  for (let i = 1; i <= days; i++) {
    out.push(new Date(t - i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

function urlsOf(it) {
  const urls = new Set();
  const add = (u) => {
    const c = canonicalizeUrl(String(u || ""));
    if (c) urls.add(c);
  };
  add(it?.url);
  add(it?.discussionUrl);
  for (const s of Array.isArray(it?.sources) ? it.sources : []) add(s?.url);
  return urls;
}

function idsOf(it) {
  return new Set(
    [
      it?.id,
      ...(Array.isArray(it?.memberIds) ? it.memberIds : []),
      ...(Array.isArray(it?.articleIds) ? it.articleIds : []),
    ]
      .filter(Boolean)
      .map(String)
  );
}

/**
 * Build a lookup from previously published digests. Each digest is
 * `{ date, items: [...] }` (snapshot json or API shape). If the same date
 * appears twice, the first copy wins so a same-day refresh can't weaken
 * the record of what was already published.
 */
export function buildDigestHistory(digests) {
  const byDate = new Map();
  for (const d of digests || []) {
    if (!d || !d.date || !Array.isArray(d.items)) continue;
    if (byDate.has(d.date)) continue;
    const entries = new Map(); // eventId -> { date, item, ids, urls }
    for (const it of d.items) {
      if (!it?.id) continue;
      if (entries.has(String(it.id))) continue;
      entries.set(String(it.id), {
        date: d.date,
        item: it,
        ids: idsOf(it),
        urls: urlsOf(it),
      });
    }
    byDate.set(d.date, entries);
  }
  return { byDate };
}

/**
 * Match a candidate against the history: same event id, overlapping member
 * article id, or overlapping canonical source url.
 */
export function matchHistory(item, history) {
  if (!item || !history) return null;
  const ids = idsOf(item);
  const urls = urlsOf(item);
  let best = null;
  for (const entries of history.byDate.values()) {
    for (const entry of entries.values()) {
      let hit = ids.has(entry.item.id) || entry.ids.has(String(item.id));
      if (!hit) {
        for (const id of ids) if (entry.ids.has(id)) { hit = true; break; }
      }
      if (!hit && urls.size) {
        for (const u of urls) if (entry.urls.has(u)) { hit = true; break; }
      }
      if (hit && (!best || entry.date > best.date)) best = entry;
    }
  }
  return best;
}

/**
 * Decide which candidate ids must be excluded from today's digest.
 * Returns { exclude: Set<string>, stats } — never fills quota with repeats.
 */
export function planDedup(items, history) {
  const exclude = new Set();
  const stats = { candidates: 0, duplicates: 0, excludedIds: [] };
  for (const it of items || []) {
    if (!it?.id) continue;
    stats.candidates += 1;
    const entry = matchHistory(it, history);
    if (!entry) continue;
    exclude.add(String(it.id));
    stats.duplicates += 1;
    stats.excludedIds.push(String(it.id));
  }
  return { exclude, stats };
}

/**
 * Load recent published digests from the store snapshots, falling back to
 * the Worker API when the local cache is missing (GitHub Actions cache can
 * be evicted). `skipDate` is today: a same-day refresh must not dedup
 * against itself.
 *
 * A remote FETCH failure is never silently treated as "no history": it
 * throws so the caller can fail the run instead of risking a duplicate
 * notification. Only an explicit matching missing digest is a legitimate empty day.
 */
export async function loadDigestHistory(store, date, opts = {}) {
  const days = opts.days ?? DEDUP_HISTORY_DAYS;
  const remote = opts.fetchRemoteDigest;
  const digests = [];
  const errors = [];
  for (const d of prevDigestDates(date, days)) {
    let json = null;
    if (store) {
      const snap = await store.getSnapshot("digest:" + d);
      if (snap && snap.json && Array.isArray(snap.json.items) && snap.json.items.length) {
        json = snap.json;
      }
    }
    if (!json && remote) {
      try {
        json = await remote(d);
      } catch (e) {
        errors.push({ date: d, message: e && e.message ? e.message : String(e) });
      }
    }
    if (json && Array.isArray(json.items) && json.items.length) digests.push(json);
  }
  if (errors.length) {
    const err = new Error("digest history fetch failed: " + JSON.stringify(errors));
    err.code = "HISTORY_FETCH";
    throw err;
  }
  return buildDigestHistory(digests);
}
