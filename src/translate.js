import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function isMostlyLatin(title) {
  const s = String(title || "");
  let latin = 0;
  let cjk = 0;
  for (const ch of s) {
    if ((ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z")) latin += 1;
    else if (ch >= "\u4e00" && ch <= "\u9fff") cjk += 1;
  }
  return latin >= 4 && latin > cjk;
}

export function myMemoryUrl(q) {
  return (
    "https://api.mymemory.translated.net/get?q=" +
    encodeURIComponent(q) +
    "&langpair=en|zh-CN"
  );
}

export async function loadTitleZhCache(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export async function saveTitleZhCache(path, cache) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2) + "\n", "utf8");
}

export const TRANSLATE_BUDGET = 15;

export function budgetState(opts = {}) {
  if (opts.budgetState) return opts.budgetState;
  const n = Number.isFinite(opts.budget) ? opts.budget : TRANSLATE_BUDGET;
  return { remaining: n };
}

export async function translateOne(title, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const cache = opts.cache;
  const emptyOnFail = Boolean(opts.emptyOnFail);
  if (cache && Object.prototype.hasOwnProperty.call(cache, title)) {
    return cache[title];
  }
  try {
    const res = await fetchImpl(myMemoryUrl(title));
    if (!res || !res.ok) return emptyOnFail ? "" : title;
    const data = await res.json();
    const zh = data && data.responseData && data.responseData.translatedText;
    if (typeof zh === "string" && zh.trim()) {
      const out = zh.trim();
      if (cache) cache[title] = out;
      return out;
    }
  } catch {
    // keep English or empty
  }
  return emptyOnFail ? "" : title;
}

export async function applyTitleZh(items, opts = {}) {
  const cache = opts.cache || (opts.cachePath ? await loadTitleZhCache(opts.cachePath) : {});
  const budget = budgetState(opts);
  const out = [];
  for (const it of items || []) {
    const next = { ...it };
    const title = it.title;
    if (isMostlyLatin(title)) {
      const hit = cache && Object.prototype.hasOwnProperty.call(cache, title);
      if (hit) {
        next.titleZh = cache[title];
      } else if (budget.remaining > 0) {
        budget.remaining -= 1;
        next.titleZh = await translateOne(title, {
          fetchImpl: opts.fetchImpl,
          cache,
        });
      }
    }
    out.push(next);
  }
  if (opts.cachePath) await saveTitleZhCache(opts.cachePath, cache);
  return out;
}

export async function applySummaryZh(items, opts = {}) {
  const cache = opts.cache || (opts.cachePath ? await loadTitleZhCache(opts.cachePath) : {});
  const budget = budgetState(opts);
  const out = [];
  for (const it of items || []) {
    const next = { ...it };
    const summary = String(it.summary || "");
    if (summary && isMostlyLatin(summary)) {
      const hit = cache && Object.prototype.hasOwnProperty.call(cache, summary);
      if (hit) {
        const zh = cache[summary];
        if (zh && zh !== summary) next.summaryZh = zh;
      } else if (budget.remaining > 0) {
        budget.remaining -= 1;
        const zh = await translateOne(summary, {
          fetchImpl: opts.fetchImpl,
          cache,
          emptyOnFail: true,
        });
        if (zh && zh !== summary) next.summaryZh = zh;
      }
    }
    out.push(next);
  }
  if (opts.cachePath) await saveTitleZhCache(opts.cachePath, cache);
  return out;
}
