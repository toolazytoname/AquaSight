import { createBudget, resolvePricing } from "./budget.js";
import { enrichItems, summarizeDigest } from "./enrich.js";
import { validateDigestSummary, validateDigestStyle } from "./digest-check.js";
import { publicItem } from "./compat.js";

// One prepared edition is persisted, rendered on the web, and sent to Bark.
export async function prepareDigest(digest, opts = {}) {
  const now = opts.now || new Date();
  const store = opts.store;
  const budget = opts.budget || createBudget(store ? await store.getBudget() : {}, now, {
    pricing: resolvePricing(opts),
    persist: store ? (snap) => store.setBudget(snap) : undefined,
  });
  const originals = new Map((store ? await store.listEvents() : []).map((it) => [it.id, it]));
  const cache = {};
  const items = [];
  for (const selected of digest.items || []) {
    const item = originals.get(selected.id) || selected;
    if (store) {
      const hit = await store.getCache("event-enrich:" + item.id);
      if (hit && !hit.degraded) cache[hit.cacheKey] = hit;
    }
    const [edited] = await enrichItems([item], { ...opts, cache, budget, now });
    if (store && edited.enrich && !edited.enrich.degraded) {
      await store.putCache("event-enrich:" + edited.id, edited.enrich);
      await store.putEvent(edited);
    }
    if (edited.category !== "hidden" && /[\u4e00-\u9fff]/.test(edited.titleZh || edited.title || "")) {
      items.push(publicItem(edited));
    }
  }
  const result = {
    ...digest, items,
    tech: items.filter((it) => it.category === "tech"),
    business: items.filter((it) => it.category === "business"),
    public: items.filter((it) => it.category === "public"),
    aiSummary: undefined,
    aiEditing: { selected: (digest.items || []).length, included: items.length },
  };
  const summary = await summarizeDigest(items, { ...opts, budget, now });
  if (summary.text && validateDigestStyle(summary.text) && validateDigestSummary(summary.text, items).ok) {
    result.aiSummary = { text: summary.text, at: now.toISOString() };
  }
  return result;
}
