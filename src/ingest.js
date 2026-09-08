export function normalizeIngestItems(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.events)) return body.events;
  if (body.events && typeof body.events === "object" && Array.isArray(body.events.items)) {
    return body.events.items;
  }
  return [];
}

export async function ingestPayload(store, body) {
  const items = normalizeIngestItems(body).filter((it) => it && it.id);
  const sourceHealth =
    body.sourceHealth ||
    (body.events && body.events.sourceHealth) ||
    [];
  const sourceErrors =
    body.sourceErrors ||
    (body.events && body.events.sourceErrors) ||
    [];
  for (const it of items) {
    await store.putEvent(it);
    const members = it.articleIds || it.memberIds || [];
    if (members.length) await store.setMembers(it.id, members);
    for (const aid of members) {
      if (aid) await store.mapArticleToEvent(aid, it.id);
    }
  }
  for (const h of sourceHealth) {
    if (h && h.source) await store.putSourceHealth(h);
  }
  const snapshot = {
    apiVersion: "v1",
    items,
    featured: body.featured || [],
    sourceErrors,
    sourceHealth,
    updatedAt: body.updatedAt || new Date().toISOString(),
    snapshotAt: body.snapshotAt || body.updatedAt || new Date().toISOString(),
  };
  await store.putSnapshot("events", snapshot);
  if (items.length) await store.putSnapshot("last-good-events", snapshot);
  return { count: items.length, snapshotAt: snapshot.snapshotAt };
}
