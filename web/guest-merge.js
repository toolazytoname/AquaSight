/** Build POST /api/v1/sync/merge body. Deleted ids win and must not resurrect. */

export function buildMergeBody({ reads = {}, prefs = {}, items = [], deletedIds = [] } = {}) {
  const favorites = [];
  const seen = new Set();
  for (const id of deletedIds) {
    const key = String(id || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    favorites.push({ id: key, deleted: true });
  }
  for (const it of items) {
    const id = it && (it.id || it.eventId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    favorites.push({ id, snapshot: it });
  }
  return { reads, prefs, favorites };
}
