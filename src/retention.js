import { toMs } from "./time.js";

export const RAW_KEEP_MS = 7 * 24 * 3600 * 1000;
export const EVENT_KEEP_MS = 30 * 24 * 3600 * 1000;
export const MAP_KEEP_MS = 90 * 24 * 3600 * 1000;

export function purgeData(exported, now = new Date()) {
  const t = toMs(now) || Date.now();
  const events = (exported.events || []).filter(([, ev]) => {
    const at = toMs(ev.updatedAt || ev.firstSeenAt || ev.publishedAt);
    if (!Number.isFinite(at)) return true;
    return t - at <= EVENT_KEEP_MS;
  });
  const keepEvent = new Set(events.map(([id]) => id));
  const favorites = exported.favorites || [];
  const favIds = new Set(favorites.map(([id]) => id));
  const articles = (exported.articles || []).filter(([, a]) => {
    const at = toMs(a.firstSeenAt || a.publishedAt);
    if (favIds.has(exported.articleEvent?.find?.(([aid]) => aid === a.id)?.[1])) return true;
    if (!Number.isFinite(at)) return true;
    return t - at <= RAW_KEEP_MS;
  });
  const articleEvent = (exported.articleEvent || []).filter((row) => {
    const eventId = typeof row[1] === "string" ? row[1] : row[1] && row[1].eventId;
    const createdAt = typeof row[1] === "object" ? row[1] && row[1].createdAt : "";
    if (keepEvent.has(eventId) || favIds.has(eventId)) return true;
    const at = toMs(createdAt);
    if (!Number.isFinite(at)) return false;
    return t - at <= MAP_KEEP_MS;
  });
  return {
    ...exported,
    events,
    articles,
    articleEvent,
    favorites,
  };
}

export function purgeExpiredIds(exported, now = new Date()) {
  const kept = purgeData(exported, now);
  const keepEvents = new Set((kept.events || []).map(([id]) => id));
  const keepArticles = new Set((kept.articles || []).map(([id]) => id));
  const keepMaps = new Set((kept.articleEvent || []).map((row) => row[0]));
  return {
    events: (exported.events || []).filter(([id]) => !keepEvents.has(id)).map(([id]) => id),
    articles: (exported.articles || []).filter(([id]) => !keepArticles.has(id)).map(([id]) => id),
    maps: (exported.articleEvent || []).filter((row) => !keepMaps.has(row[0])).map((row) => row[0]),
  };
}
