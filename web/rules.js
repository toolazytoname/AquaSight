/** Browser-safe fallback. Live sorting is done by /api/v1. */

export const HOT_SOURCES = new Set(["weibo", "baidu", "toutiao", "hot"]);
export const TECH_SOURCES = new Set([
  "hn",
  "hackernews",
  "github",
  "github-trending",
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
  ["tech", "AI/科技"],
  ["business", "商业"],
  ["public", "世界"],
];
export const SOURCE_FILTERS = [
  ["", "全部"],
  ["hn", "Hacker News"],
  ["github", "开源发现"],
  ["github-trending", "GitHub 热门"],
  ["huggingface", "Hugging Face"],
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

// Feeds that belong to the same outlet: the same 36kr link arriving via the
// article feed and the flash feed is one media with two articles.
export const MEDIA_ALIASES = {
  "36kr-flash": "36kr",
  hackernews: "hn",
};

export function mediaKey(source) {
  const s = String(source || "").toLowerCase();
  return MEDIA_ALIASES[s] || s;
}

function hostOf(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// The lead slot is an editorial promise, not the array's first seat: it must
// be Chinese-readable, substantive and fresh, or it is not shown at all.
export function leadQualifies(it, now = Date.now()) {
  const titleZh = String(it?.titleZh || "").trim();
  const title = String(it?.title || "").trim();
  if (!titleZh || titleZh === title) return false;
  const overview = String(it?.overviewZh || it?.summaryZh || "").trim();
  const facts = Array.isArray(it?.facts) ? it.facts.filter(Boolean).length : 0;
  if (overview.length < 60 && facts < 2) return false;
  const t = Date.parse(it?.publishedAt || it?.firstSeenAt || it?.seenAt || "");
  if (!Number.isFinite(t)) return false;
  if (now - t > 48 * 3600 * 1000) return false;
  return true;
}

// Among the first few qualifying stories, prefer the widest coverage.
export function pickLead(items, now = Date.now()) {
  const qualifying = (items || []).filter((it) => leadQualifies(it, now)).slice(0, 3);
  if (!qualifying.length) return null;
  return qualifying.sort(
    (a, b) => countCoverage(b.sources || []).media - countCoverage(a.sources || []).media
  )[0];
}

/**
 * Three distinct counts for a story's coverage: raw articles, outlets behind
 * them (36kr + 36kr-flash = one outlet), and independent origins by URL host.
 */
export function countCoverage(sources) {
  const list = (sources || []).filter(Boolean);
  return {
    articles: list.length,
    media: new Set(list.map((s) => mediaKey(s.source))).size,
    origins: new Set(list.map((s) => hostOf(s.url || s.discussionUrl)).filter(Boolean)).size,
  };
}

// The digest date is a Beijing calendar day; its weekday must be derived in
// the same timezone or a reader in LA sees Sunday on a Beijing Monday.
export function digestDateLine(dateYmd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateYmd || ""))) return { showDate: "", weekday: "" };
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).formatToParts(new Date(dateYmd + "T12:00:00+08:00"));
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  const weekday = get("weekday").replace("周", "").replace("星期", "");
  return {
    showDate: get("month") + "月" + get("day") + "日",
    weekday: weekday ? "星期" + weekday : "",
  };
}

export function cardBody(item) {
  const zh = String((item && (item.overviewZh || item.summaryZh)) || "").trim();
  if (zh) return { kind: "overview", text: zh };
  const raw = String((item && item.summary) || "").trim();
  if (raw) return { kind: "excerpt", text: raw };
  return { kind: "empty", text: "" };
}

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

export function readingMarks(item) {
  const title = String((item && item.title) || "");
  const titleZh = String((item && item.titleZh) || "").trim();
  const overview = String((item && (item.overviewZh || item.summaryZh)) || "").trim();
  const facts = Array.isArray(item && item.facts) ? item.facts.filter(Boolean) : [];
  const impact = String((item && item.impact) || "").trim();
  // aiState is the real processing state from the collector; the field-presence
  // inference below is only a fallback for pre-aiState snapshots.
  const state = item && item.aiState;
  const prepared = state
    ? state === "ready"
    : Boolean(overview || facts.length || impact);
  const translated = Boolean(titleZh && title && titleZh !== title);
  const pending = state
    ? state === "queued"
    : !prepared && !translated && isMostlyLatin(title);
  return { prepared, translated, pending, state: state || "", facts, overview };
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
