/** Cluster articles into events. Strong keys only. No network. */

import { classifyMembers } from "./classify.js";
import { extractEvent, mergeKeysOf, normalizeTitle } from "./extract.js";
import { stripHtml } from "./html.js";
import {
  articleId,
  memberIdsOf,
  rememberEventMembers,
  resolveEventId,
} from "./identity.js";
import { scoreCard, scoreParts } from "./score.js";
import { earlierIso, laterIso, toIso } from "./time.js";

export { heatOf, decayOf } from "./classify.js";

function looksLikeHtml(s) {
  return /<\/?[a-z][\s\S]*>/i.test(String(s || ""));
}

function pickSummary(members) {
  let best = "";
  for (const m of members) {
    const raw = String(m?.summary || "");
    if (!raw) continue;
    if (looksLikeHtml(raw) && stripHtml(raw).length < 12) continue;
    const s = stripHtml(raw)
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length > best.length) best = s;
  }
  return best.length >= 12 ? best : "";
}

export function titleTokens() {
  return new Set();
}

export function jaccard() {
  return 0;
}

export function labEntities(title) {
  return new Set();
}

export function hasImpact() {
  return false;
}

export function companyPrefix(title) {
  const s = String(title || "");
  const i = s.search(/[：:]/);
  if (i <= 0) return "";
  return s.slice(0, i).trim();
}

export function looksEarnings(title) {
  return /净利润|同比增长|营收|半年报/.test(title || "");
}

export function shouldMerge(a, b, now = new Date()) {
  if (!a || !b) return false;
  const ka = new Set(mergeKeysOf(a, now).keys);
  const kb = mergeKeysOf(b, now).keys;
  for (const k of kb) {
    if (ka.has(k)) return true;
  }
  const na = normalizeTitle(a.title);
  const nb = normalizeTitle(b.title);
  if (na && na === nb) {
    const da = mergeKeysOf(a, now).meta.dayKey;
    const db = mergeKeysOf(b, now).meta.dayKey;
    if (!da || !db || da === db) return true;
  }
  return false;
}

/**
 * Company/lab name must never be used as an event id.
 * Persisted map keeps the id stable when a new source joins.
 */
export function stableCardId(members, articleEventMap = new Map()) {
  return resolveEventId(members, articleEventMap);
}

function stampArticle(raw, now) {
  const article = { ...raw };
  article.articleId = articleId(article);
  if (!article.externalId && raw?.id && !String(raw.id).startsWith("art:")) {
    article.externalId = String(raw.id);
  }
  const meta = extractEvent(article, now);
  if (!article.publishedAt && meta.publishedAt) article.publishedAt = meta.publishedAt;
  article.occurredAt = article.occurredAt || meta.occurredAt;
  article.firstSeenAt = article.firstSeenAt || meta.firstSeenAt;
  article.seenAt = article.seenAt || article.firstSeenAt;
  article.retrospective = meta.retrospective;
  article.subject = meta.subject;
  article.action = meta.action;
  article.product = meta.product;
  return article;
}

function toCard(members, now, articleEventMap) {
  const list = members.map((m) => stampArticle(m, now));
  const id = resolveEventId(list, articleEventMap);
  rememberEventMembers(id, list, articleEventMap);
  const classified = classifyMembers(list, now);
  const parts = scoreParts(list, now);
  const score = scoreCard(list, now);
  const primary =
    [...list].sort((a, b) => {
      const ta = Date.parse(a.publishedAt || a.seenAt || "") || 0;
      const tb = Date.parse(b.publishedAt || b.seenAt || "") || 0;
      return tb - ta;
    })[0] || {};
  const summary = pickSummary(list);
  const firstSeenAt = list.reduce(
    (acc, m) => earlierIso(acc, m.firstSeenAt || m.seenAt) || acc,
    ""
  );
  const publishedAt = list.reduce(
    (acc, m) => laterIso(acc, m.publishedAt) || acc,
    ""
  );
  const occurredAt = list.reduce(
    (acc, m) => earlierIso(acc, m.occurredAt) || acc,
    ""
  );
  const articleIds = list.map((m) => m.articleId).filter(Boolean);
  const card = {
    id,
    title: primary.title || "",
    titleZh: primary.titleZh,
    url: primary.url,
    source: primary.source,
    level: classified.level,
    reason: classified.reason,
    category: classified.category || parts.category,
    notifyEligible: Boolean(classified.notifyEligible),
    score,
    value: parts.value,
    scoreParts: parts,
    articleIds,
    memberIds: articleIds,
    subject: primary.subject || "",
    action: primary.action || "",
    product: primary.product || "",
    occurredAt: occurredAt || undefined,
    publishedAt: publishedAt || undefined,
    firstSeenAt: firstSeenAt || undefined,
    seenAt: firstSeenAt || primary.seenAt,
    updatedAt: toIso(now),
    sources: list.map((m) => ({
      source: m?.source,
      url: m?.url,
      title: m?.title,
      role: m?.role,
      points: m?.points,
      comments: m?.comments,
      discussionUrl: m?.discussionUrl,
      publishedAt: m?.publishedAt,
    })),
  };
  if (summary) card.summary = summary;
  if (primary.summaryZh) card.summaryZh = primary.summaryZh;
  if (list.some((m) => m.retrospective)) card.retrospective = true;
  return card;
}

class UnionFind {
  constructor(n) {
    this.p = Array.from({ length: n }, (_, i) => i);
  }
  find(i) {
    while (this.p[i] !== i) {
      this.p[i] = this.p[this.p[i]];
      i = this.p[i];
    }
    return i;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[rb] = ra;
  }
}

export function cluster(events = [], opts = {}) {
  const now = opts.now || new Date();
  const articleEventMap = opts.articleEventMap || new Map();
  const items = (events || []).filter(Boolean).map((e) => stampArticle(e, now));
  const n = items.length;
  const uf = new UnionFind(n);
  const keyIndex = new Map();
  for (let i = 0; i < n; i++) {
    const { keys } = mergeKeysOf(items[i], now);
    for (const key of keys) {
      if (!keyIndex.has(key)) keyIndex.set(key, []);
      keyIndex.get(key).push(i);
    }
  }
  for (const idxs of keyIndex.values()) {
    for (let k = 1; k < idxs.length; k++) uf.union(idxs[0], idxs[k]);
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(items[i]);
  }
  return [...groups.values()].map((g) => toCard(g, now, articleEventMap));
}

export function classifyCard(members, now = new Date()) {
  const { level, reason } = classifyMembers(members, now);
  const score = scoreCard(members, now);
  return { level, reason, score };
}

export { memberIdsOf, articleId };
