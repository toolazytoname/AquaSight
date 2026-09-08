import { isHiddenContent } from "./classify.js";
import { isClueSource } from "./catalog.js";
import { scoreParts } from "./score.js";

export const FEATURED_LIMIT = 30;
export const FEATURED_QUOTA = { tech: 18, business: 9, public: 3 };
export const DIGEST_LIMIT = 10;
export const DIGEST_QUOTA = { tech: 6, business: 3, public: 1 };
export const SOURCE_CAP = 6;
export const SUBJECT_CAP = 3;
export const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

export function inDigestWindow(it, now = new Date()) {
  const t = Date.parse(it?.publishedAt || it?.occurredAt || it?.firstSeenAt || it?.seenAt || "");
  if (!Number.isFinite(t)) return false;
  const n = now instanceof Date ? now.getTime() : Date.parse(now);
  return t <= n && n - t <= DIGEST_WINDOW_MS;
}

export const NORMAL_CAP = FEATURED_LIMIT;
export const QUOTA = FEATURED_QUOTA;

function prefsSet(prefs, key) {
  const raw = prefs && prefs[key];
  return new Set(Array.isArray(raw) ? raw.map(String) : []);
}

export function applyPrefs(items, prefs = {}) {
  const hiddenEvents = prefsSet(prefs, "hiddenEventIds");
  const blocked = prefsSet(prefs, "blockedSources");
  const weights = prefs && prefs.topicWeights && typeof prefs.topicWeights === "object"
    ? prefs.topicWeights
    : {};
  const out = [];
  for (const it of items || []) {
    if (!it) continue;
    if (hiddenEvents.has(String(it.id))) continue;
    if (blocked.has(String(it.source))) continue;
    const sources = Array.isArray(it.sources) ? it.sources : [];
    if (sources.length && sources.every((s) => blocked.has(String(s.source)))) continue;
    const hide = it.category === "hidden" || isHiddenContent([it]).hidden;
    if (hide) continue;
    out.push({ ...it, topicWeights: weights });
  }
  return out;
}

function sortByValue(items, now) {
  return (items || [])
    .map((it, i) => {
      const parts = scoreParts([it], now);
      let value = parts.value;
      const subject = String(it.subject || "");
      const weights = it.topicWeights || {};
      if (subject && Number.isFinite(weights[subject])) value *= weights[subject];
      return { it: { ...it, value, scoreParts: parts }, i, value };
    })
    .sort((a, b) => {
      const d = b.value - a.value;
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.it);
}

function sourceOf(it) {
  return String((it && it.source) || "");
}

function subjectOf(it) {
  return String((it && it.subject) || it && it.id || "");
}

function takeNext(pool, index, used, sourceCap, subjectCap, sourceCount, subjectCount) {
  while (index < pool.length) {
    const it = pool[index++];
    if (!it || used.has(it.id)) continue;
    const src = sourceOf(it);
    const sub = subjectOf(it);
    if ((sourceCount.get(src) || 0) >= sourceCap) continue;
    if (sub && (subjectCount.get(sub) || 0) >= subjectCap) continue;
    return { it, index };
  }
  return { it: null, index };
}

export function selectByQuota(items, opts = {}) {
  const now = opts.now || new Date();
  const limit = opts.limit ?? FEATURED_LIMIT;
  const quota = opts.quota || FEATURED_QUOTA;
  const sourceCap = opts.sourceCap ?? SOURCE_CAP;
  const subjectCap = opts.subjectCap ?? SUBJECT_CAP;
  const fillCross = opts.fillCross !== false;
  const padPublic = Boolean(opts.padPublic);
  const prefs = opts.prefs || {};
  const filtered = applyPrefs(items, prefs).filter((it) => {
    if (it.category === "hidden") return false;
    if (opts.dropClueOnly) {
      const srcs = Array.isArray(it.sources) && it.sources.length ? it.sources : [{ source: it.source }];
      if (srcs.every((s) => isClueSource(s.source))) return false;
    }
    return true;
  });
  const ranked = sortByValue(filtered, now);
  const buckets = { tech: [], business: [], public: [] };
  for (const it of ranked) {
    const cat = it.category === "business" || it.category === "public" || it.category === "tech"
      ? it.category
      : "tech";
    buckets[cat].push(it);
  }
  const sourceCount = new Map();
  const subjectCount = new Map();
  const picked = [];
  const used = new Set();
  const taken = { tech: 0, business: 0, public: 0 };
  const cursor = { tech: 0, business: 0, public: 0 };
  const cats = ["tech", "business", "public"];
  let progress = true;
  while (progress) {
    progress = false;
    for (const key of cats) {
      if (taken[key] >= (quota[key] || 0)) continue;
      const next = takeNext(
        buckets[key],
        cursor[key],
        used,
        sourceCap,
        subjectCap,
        sourceCount,
        subjectCount
      );
      cursor[key] = next.index;
      if (!next.it) continue;
      picked.push(next.it);
      used.add(next.it.id);
      taken[key] += 1;
      const src = sourceOf(next.it);
      const sub = subjectOf(next.it);
      sourceCount.set(src, (sourceCount.get(src) || 0) + 1);
      if (sub) subjectCount.set(sub, (subjectCount.get(sub) || 0) + 1);
      progress = true;
    }
  }
  if (fillCross) {
    const leftover = ranked.filter((it) => !used.has(it.id) && it.category !== "public");
    for (const it of leftover) {
      if (picked.length >= limit) break;
      const src = sourceOf(it);
      const sub = subjectOf(it);
      if ((sourceCount.get(src) || 0) >= sourceCap) continue;
      if (sub && (subjectCount.get(sub) || 0) >= subjectCap) continue;
      picked.push(it);
      used.add(it.id);
      sourceCount.set(src, (sourceCount.get(src) || 0) + 1);
      if (sub) subjectCount.set(sub, (subjectCount.get(sub) || 0) + 1);
    }
  }
  if (padPublic) {
    const leftoverPub = ranked.filter((it) => !used.has(it.id) && it.category === "public");
    for (const it of leftoverPub) {
      if (picked.length >= limit) break;
      picked.push(it);
    }
  }
  return sortByValue(picked, now).slice(0, limit);
}

export function selectFeatured(items, opts = {}) {
  return selectByQuota(items, {
    now: opts.now,
    prefs: opts.prefs,
    limit: FEATURED_LIMIT,
    quota: FEATURED_QUOTA,
    sourceCap: SOURCE_CAP,
    subjectCap: SUBJECT_CAP,
    fillCross: true,
    padPublic: false,
    dropClueOnly: true,
  });
}

export function selectLatest(items, opts = {}) {
  const prefs = opts.prefs || {};
  const filtered = applyPrefs(items, prefs).filter((it) => it.category !== "hidden");
  return [...filtered]
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ta = Date.parse(a.it.publishedAt || a.it.seenAt || "") || 0;
      const tb = Date.parse(b.it.publishedAt || b.it.seenAt || "") || 0;
      const d = tb - ta;
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.it);
}

export function selectDigest(items, opts = {}) {
  const now = opts.now || new Date();
  const windowed = (items || []).filter((it) => inDigestWindow(it, now));
  return selectByQuota(windowed, {
    now,
    prefs: opts.prefs,
    limit: DIGEST_LIMIT,
    quota: DIGEST_QUOTA,
    sourceCap: SOURCE_CAP,
    subjectCap: SUBJECT_CAP,
    fillCross: true,
    padPublic: false,
    dropClueOnly: true,
  });
}

export function breakingListForPage(items) {
  return (items || []).filter((i) => i.level === "breaking" && i.category !== "hidden");
}

export function normalListForPage(items, opts = {}) {
  return selectFeatured(items, opts);
}

export { isHotEntertainment } from "./classify.js";
