import { randomUUID } from "node:crypto";
import { canonicalizeUrl, shortHash } from "./hash.js";

export function articleIdentity(item) {
  const source = String(item?.source || "").toLowerCase().trim();
  const url = canonicalizeUrl(item?.url || "");
  const ext = String(item?.externalId || item?.guid || "").trim();
  const title = String(item?.title || "").trim();
  if (!source && !url && !ext) {
    return "empty|" + title;
  }
  return [source, url, ext].join("\n");
}

export function articleId(item) {
  if (item?.articleId && String(item.articleId).startsWith("art:")) {
    return item.articleId;
  }
  return "art:" + shortHash(articleIdentity(item), 20);
}

export function newEventId() {
  return "evt:" + randomUUID();
}

export function isEventId(id) {
  return String(id || "").startsWith("evt:");
}

export function isArticleId(id) {
  return String(id || "").startsWith("art:");
}

export function memberIdsOf(item) {
  if (Array.isArray(item?.articleIds) && item.articleIds.length) {
    return item.articleIds.filter(Boolean);
  }
  if (Array.isArray(item?.memberIds) && item.memberIds.length) {
    return item.memberIds.filter(Boolean);
  }
  const id = String(item?.id || "");
  if (id.startsWith("evt:") || id.startsWith("art:")) return id ? [id] : [];
  if (id.includes("|")) return id.split("|").filter(Boolean);
  return id ? [id] : [];
}

/**
 * Reuse a persisted event id when any member is already mapped.
 * Never derive the id from a company or lab name.
 */
export function resolveEventId(members, articleEventMap = new Map()) {
  const found = [];
  for (const m of members || []) {
    if (isEventId(m?.eventId)) found.push(m.eventId);
    const aid = m?.articleId || articleId(m);
    const mapped = articleEventMap.get(aid);
    if (isEventId(mapped)) found.push(mapped);
  }
  if (found.length) {
    found.sort();
    return found[0];
  }
  return newEventId();
}

export function rememberEventMembers(eventId, members, articleEventMap) {
  if (!articleEventMap || !eventId) return;
  for (const m of members || []) {
    const aid = m?.articleId || articleId(m);
    if (aid && !articleEventMap.has(aid)) articleEventMap.set(aid, eventId);
  }
}
