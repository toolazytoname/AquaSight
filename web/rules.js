/** Display and family rules. Loaded by the page and by Node. */

export const HOT_SOURCES = new Set(["weibo", "baidu", "toutiao", "hot"]);
export const TECH_SOURCES = new Set([
  "hn",
  "hackernews",
  "github",
  "36kr",
  "kr",
  "ithome",
  "qbitai",
  "v2ex",
  "techcrunch",
  "verge",
  "openai",
]);
export const WORLD_SOURCES = new Set(["wallstreetcn", "bbc"]);

export const VETO_RE =
  /胖东来|你好星期六|跑男|恋综|综艺|晚会/;
export const ENT_DISPLAY_RE =
  /明星|演唱会|票房|剧集|追剧|短剧|综艺|晚会|金鹰奖|提名|掉提|官宣|宠妃/;

export const NORMAL_CAP = 30;
export const QUOTA = { tech: 12, hot: 10, other: 8 };
export const SOURCE_CAP = 4;

export function sourceFamily(source) {
  const s = String(source || "").toLowerCase();
  if (HOT_SOURCES.has(s)) return "hot";
  if (TECH_SOURCES.has(s)) return "tech";
  if (WORLD_SOURCES.has(s)) return "world";
  return "other";
}

export function familyForDisplay(item) {
  const f = sourceFamily(item && item.source);
  if (f === "tech") return "tech";
  if (f === "hot") return "hot";
  return "other";
}

export function isHotEntertainment(item) {
  if (sourceFamily(item && item.source) !== "hot") return false;
  const title = String((item && item.title) || "");
  return VETO_RE.test(title) || ENT_DISPLAY_RE.test(title);
}

export function scoreOf(item) {
  const n = item && item.score;
  return Number.isFinite(n) ? n : 0;
}

export function sortByScore(items) {
  return (items || [])
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const d = scoreOf(b.it) - scoreOf(a.it);
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.it);
}

export function breakingListForPage(items) {
  return sortByScore((items || []).filter((i) => i.level === "breaking"));
}

function takeFamily(list, cap, perSource) {
  const count = new Map();
  const picked = [];
  const delayed = [];
  for (const it of list) {
    const src = String((it && it.source) || "");
    const n = count.get(src) || 0;
    if (picked.length < cap && n < perSource) {
      picked.push(it);
      count.set(src, n + 1);
    } else {
      delayed.push(it);
    }
  }
  for (const it of delayed) {
    if (picked.length >= cap) break;
    picked.push(it);
  }
  const used = new Set(picked);
  const leftover = list.filter((it) => !used.has(it));
  return { picked, leftover };
}

export function normalListForPage(items) {
  const raw = sortByScore(
    (items || []).filter(
      (i) => i.level !== "breaking" && !isHotEntertainment(i)
    )
  );
  const buckets = { tech: [], hot: [], other: [] };
  for (const it of raw) {
    buckets[familyForDisplay(it)].push(it);
  }
  const picked = [];
  const leftover = [];
  for (const key of ["tech", "hot", "other"]) {
    const taken = takeFamily(buckets[key], QUOTA[key], SOURCE_CAP);
    picked.push(...taken.picked);
    leftover.push(...taken.leftover);
  }
  const fill = sortByScore(leftover);
  for (const it of fill) {
    if (picked.length >= NORMAL_CAP) break;
    picked.push(it);
  }
  return sortByScore(picked).slice(0, NORMAL_CAP);
}
