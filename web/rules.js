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
export const TOPIC_FILTERS = [
  ["", "全部"],
  ["tech", "科技"],
  ["business", "商业"],
  ["public", "公共"],
];
export const SOURCE_FILTERS = [
  ["", "全部"],
  ["hn", "Hacker News"],
  ["github", "开源发现"],
  ["ithome", "IT之家"],
  ["qbitai", "量子位"],
  ["v2ex", "V2EX"],
  ["techcrunch", "TechCrunch"],
  ["verge", "The Verge"],
  ["openai", "OpenAI"],
  ["36kr", "36氪"],
  ["36kr-flash", "36氪快讯"],
  ["wallstreetcn", "华尔街见闻"],
  ["bbc", "BBC"],
  ["x", "X"],
];

export function sourceLabel(source) {
  const found = SOURCE_FILTERS.find(([id]) => id && id === source);
  if (found) return found[1];
  if (source === "github") return "开源发现";
  return source || "";
}

export function cardBody(item) {
  const zh = String((item && (item.overviewZh || item.summaryZh)) || "").trim();
  if (zh) return { kind: "overview", text: zh };
  const raw = String((item && item.summary) || "").trim();
  if (raw) return { kind: "excerpt", text: raw };
  return { kind: "empty", text: "" };
}

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

export function isHiddenCard(item) {
  if (!item) return true;
  if (item.category === "hidden") return true;
  const title = String(item.title || "");
  if (/去世|逝世|病逝/.test(title)) return true;
  if (/促销|打折|优惠券|免费领/.test(title)) return true;
  return isHotEntertainment(item);
}

export function visibleCards(items) {
  return (items || []).filter((it) => !isHiddenCard(it));
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
