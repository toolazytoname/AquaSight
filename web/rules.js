/** Browser-safe fallback. Live sorting is done by /api/v1. */

export const HOT_SOURCES = new Set(["weibo", "baidu", "toutiao", "hot"]);
export const TECH_SOURCES = new Set([
  "hn",
  "hackernews",
  "github",
  "ithome",
  "qbitai",
  "v2ex",
  "techcrunch",
  "verge",
  "openai",
]);
export const WORLD_SOURCES = new Set(["bbc"]);
export const VETO_RE = /胖东来|你好星期六|跑男|恋综|综艺|晚会/;
export const ENT_DISPLAY_RE =
  /明星|演唱会|票房|剧集|追剧|短剧|综艺|晚会|金鹰奖|提名|掉提|官宣|宠妃/;
export const NORMAL_CAP = 30;
export const QUOTA = { tech: 18, business: 9, public: 3 };
export const SOURCE_CAP = 6;

export function sourceFamily(source) {
  const s = String(source || "").toLowerCase();
  if (HOT_SOURCES.has(s)) return "hot";
  if (TECH_SOURCES.has(s)) return "tech";
  if (WORLD_SOURCES.has(s)) return "world";
  if (s === "36kr" || s === "36kr-flash" || s === "wallstreetcn") return "business";
  return "other";
}

export function isHotEntertainment(item) {
  const title = String((item && item.title) || "");
  return VETO_RE.test(title) || ENT_DISPLAY_RE.test(title);
}

export function sortByScore(items) {
  return (items || [])
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const sa = Number.isFinite(a.it && a.it.score) ? a.it.score : 0;
      const sb = Number.isFinite(b.it && b.it.score) ? b.it.score : 0;
      const d = sb - sa;
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.it);
}

export function breakingListForPage(items) {
  return sortByScore((items || []).filter((i) => i.level === "breaking"));
}

export function normalListForPage(items) {
  return (items || []).filter(
    (i) => i.level !== "breaking" && i.category !== "hidden" && !isHotEntertainment(i)
  );
}
