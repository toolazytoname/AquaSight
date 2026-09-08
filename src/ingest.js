export function normalizeIngestItems(body) {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.events)) return body.events;
  if (body.events && typeof body.events === "object" && Array.isArray(body.events.items)) {
    return body.events.items;
  }
  return [];
}

export function buildFeed(body) {
  const items = normalizeIngestItems(body).filter((it) => it && it.id);
  const hasArticles = Object.prototype.hasOwnProperty.call(body, "articles");
  const articles = hasArticles
    ? (Array.isArray(body.articles) ? body.articles.filter((a) => a && a.id) : [])
    : null;
  const sourceHealth =
    body.sourceHealth ||
    (body.events && body.events.sourceHealth) ||
    [];
  const sourceErrors =
    body.sourceErrors ||
    (body.events && body.events.sourceErrors) ||
    [];
  const members = items.map((it) => [it.id, it.articleIds || it.memberIds || []]);
  const articleEvent = [];
  for (const it of items) {
    for (const aid of it.articleIds || it.memberIds || []) {
      if (aid) articleEvent.push([aid, it.id]);
    }
  }
  for (const a of articles || []) {
    if (a && a.id && a.eventId) articleEvent.push([a.id, a.eventId]);
  }
  return {
    events: items,
    articles,
    members,
    articleEvent,
    sourceHealth,
    sourceErrors,
    digest: body.digest || null,
    budget: body.budget || null,
    notifications: Array.isArray(body.notifications) ? body.notifications : null,
    featured: body.featured || [],
    updatedAt: body.updatedAt || new Date().toISOString(),
    snapshotAt: body.snapshotAt || body.updatedAt || new Date().toISOString(),
  };
}

export async function ingestPayload(store, body) {
  const feed = buildFeed(body);
  const snapshot = {
    apiVersion: "v1",
    items: feed.events,
    featured: feed.featured,
    articles: feed.articles,
    sourceErrors: feed.sourceErrors,
    sourceHealth: feed.sourceHealth,
    digest: feed.digest,
    budget: feed.budget,
    updatedAt: feed.updatedAt,
    snapshotAt: feed.snapshotAt,
  };
  await store.putSnapshot("events-staging", snapshot);
  if (typeof store.applyFeed !== "function") {
    throw new Error("store missing applyFeed");
  }
  await store.applyFeed(feed);
  await store.putSnapshot("events", snapshot);
  if (feed.events.length) await store.putSnapshot("last-good-events", snapshot);
  if (feed.digest && feed.digest.date) {
    await store.putSnapshot("digest:" + feed.digest.date, feed.digest);
  }
  if (typeof store.purgeExpired === "function") {
    try {
      await store.purgeExpired(new Date());
    } catch {
      // ingest already committed; expired rows may remain until the next pass
    }
  }
  return {
    count: feed.events.length,
    articleCount: Array.isArray(feed.articles) ? feed.articles.length : 0,
    snapshotAt: snapshot.snapshotAt,
  };
}
