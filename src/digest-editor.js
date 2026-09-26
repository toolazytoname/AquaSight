import { createBudget, resolvePricing } from "./budget.js";
import { enrichItems, summarizeDigest, createFetchStats } from "./enrich.js";
import { validateDigestSummary, validateDigestStyle } from "./digest-check.js";
import { publicItem } from "./compat.js";

export function isHttpUrl(u) {
  if (!u || typeof u !== "string") return false;
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const parsed = new URL(u);
    return parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * Offline, verifiable quality gate for a digest entry. Checks shape only:
 * a usable http(s) link somewhere in the entry, a parseable time field, a
 * real title, and — when the model claims a finished edit — at least one
 * fact or evidence line to ground it. No fetching here: HEAD 404 (e.g.
 * wallstreetcn livenews) and 403/paywalls are NOT proof of a dead link, so
 * liveness is deliberately not judged offline. Shape checks are not fact
 * verification: passing this gate says nothing about whether a claim is
 * true, only that its inputs are well-formed.
 */
export function digestItemQuality(it) {
  const reasons = [];
  const title = String(it?.titleZh || it?.title || "").trim();
  if (title.length < 6) reasons.push("title");
  const urls = [it?.url, ...(Array.isArray(it?.sources) ? it.sources.map((s) => s?.url) : [])];
  if (!urls.some((u) => isHttpUrl(u))) reasons.push("link");
  const timeOk = [it?.publishedAt, it?.firstSeenAt, it?.seenAt].some((t) =>
    Number.isFinite(Date.parse(t || ""))
  );
  if (!timeOk) reasons.push("time");
  if (it?.aiState === "ready") {
    const facts = Array.isArray(it.facts) ? it.facts.length : 0;
    const evidence = Array.isArray(it.evidence) ? it.evidence.length : 0;
    if (facts + evidence < 1) reasons.push("no-grounding");
  }
  return { ok: reasons.length === 0, reasons };
}

// One prepared edition is persisted, rendered on the web, and sent to Bark.
export async function prepareDigest(digest, opts = {}) {
  const now = opts.now || new Date();
  // Budget accounting follows the REAL clock; `now` may be pinned to a past
  // date for a historical refresh, and rolling yesterday's usage into
  // yesterday would corrupt today's day counters.
  const budgetNow = opts.budgetNow || now;
  const store = opts.store;
  const budget = opts.budget || createBudget(store ? await store.getBudget() : {}, budgetNow, {
    pricing: resolvePricing(opts),
    persist: store ? (snap) => store.setBudget(snap) : undefined,
  });
  const originals = new Map((store ? await store.listEvents() : []).map((it) => [it.id, it]));
  const cache = {};
  const items = [];
  const rejected = [];
  const fetchStats = createFetchStats();
  for (const selected of digest.items || []) {
    const item = originals.get(selected.id) || selected;
    if (store) {
      const hit = await store.getCache("event-enrich:" + item.id);
      if (hit && !hit.degraded) cache[hit.cacheKey] = hit;
    }
    const [edited] = await enrichItems([item], {
      ...opts,
      cache,
      budget,
      now,
      budgetNow,
      fetchStats,
    });
    if (store && edited.enrich && !edited.enrich.degraded) {
      await store.putCache("event-enrich:" + edited.id, edited.enrich);
      await store.putEvent(edited);
    }
    const zh = /[\u4e00-\u9fff]/.test(edited.titleZh || edited.title || "");
    const quality = digestItemQuality(edited);
    if (edited.category !== "hidden" && zh && quality.ok) {
      items.push(publicItem(edited));
    } else {
      rejected.push({ id: edited.id, reasons: quality.reasons.length ? quality.reasons : (zh ? [] : ["no-zh-title"]) });
    }
  }
  const ready = items.filter((it) => it.aiState === "ready").length;
  const result = {
    ...digest, items,
    tech: items.filter((it) => it.category === "tech"),
    business: items.filter((it) => it.category === "business"),
    public: items.filter((it) => it.category === "public"),
    aiSummary: undefined,
    aiEditing: {
      selected: (digest.items || []).length,
      included: items.length,
      ready,
      rejected,
      fetch: fetchStats,
    },
  };
  const summary = await summarizeDigest(items, { ...opts, budget, now, budgetNow, fetchStats });
  let outcome = {
    attempted: Boolean(summary.attempted),
    accepted: false,
    reason: summary.reason || "rejected",
  };
  if (summary.text) {
    if (!validateDigestStyle(summary.text)) outcome = { attempted: true, accepted: false, reason: "style" };
    else {
      const grounding = validateDigestSummary(summary.text, items);
      outcome = grounding.ok
        ? { attempted: true, accepted: true, reason: null, model: summary.model || null }
        : { attempted: true, accepted: false, reason: grounding.reason, checked: grounding.checked, model: summary.model || null };
    }
  } else if (summary.attempted && summary.model) {
    outcome.model = summary.model;
  }
  result.aiSummaryOutcome = outcome;
  if (outcome.accepted) result.aiSummary = { text: summary.text, at: now.toISOString(), model: summary.model || null };
  return result;
}
