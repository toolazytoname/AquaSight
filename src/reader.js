import { SOURCE_CATALOG } from "./catalog.js";

// 个人订阅（阅读器）来源模型。
// - 基础集：GitHub 项目 + 技术产品官方更新，个人开发者定位的核心内容。
// - 扩展集：目录内其他实际来源；x/import（手工导入类）与热搜线索别名
//   （weibo/baidu/toutiao/hot）不开放订阅。
export const READER_BASIC_SOURCES = [
  "github",
  "github-trending",
  "github-trending-weekly",
  "github-maintained",
  "openai",
  "huggingface",
];

const READER_EXCLUDED = new Set(["x", "import", "weibo", "baidu", "toutiao", "hot"]);

function labelOf(id) {
  const meta = SOURCE_CATALOG[id] || {};
  if (meta.label) return meta.label;
  const map = {
    hn: "Hacker News",
    "36kr": "36氪",
    "36kr-flash": "36氪快讯",
    ithome: "IT之家",
    qbitai: "量子位",
    v2ex: "V2EX",
    techcrunch: "TechCrunch",
    verge: "The Verge",
    bbc: "BBC",
    wallstreetcn: "华尔街见闻",
    openai: "OpenAI",
    huggingface: "Hugging Face",
  };
  return map[id] || id;
}

const GROUP_LABELS = {
  basicOpensource: "开源项目",
  basicResearch: "技术与研究",
  extended: "更多来源",
};

// 基础来源拆两个展示组：GitHub 开源项目 / 技术产品与研究更新。
const BASIC_GROUP = {
  github: "basicOpensource",
  "github-trending": "basicOpensource",
  "github-trending-weekly": "basicOpensource",
  "github-maintained": "basicOpensource",
  openai: "basicResearch",
  huggingface: "basicResearch",
};

export function readerCatalog() {
  const basic = new Set(READER_BASIC_SOURCES);
  const sources = [];
  for (const id of READER_BASIC_SOURCES) {
    sources.push({
      id,
      label: labelOf(id),
      description: (SOURCE_CATALOG[id] || {}).purpose || "",
      group: GROUP_LABELS[BASIC_GROUP[id]],
      extended: false,
    });
  }
  for (const id of Object.keys(SOURCE_CATALOG)) {
    if (basic.has(id) || READER_EXCLUDED.has(id)) continue;
    sources.push({
      id,
      label: labelOf(id),
      description: (SOURCE_CATALOG[id] || {}).purpose || "",
      group: GROUP_LABELS.extended,
      extended: true,
    });
  }
  return sources;
}

export const READER_SOURCE_IDS = new Set(readerCatalog().map((s) => s.id));
export const READER_BASIC_SET = new Set(READER_BASIC_SOURCES);
export const READER_EXTENDED_SET = new Set(
  [...READER_SOURCE_IDS].filter((id) => !READER_BASIC_SET.has(id))
);

/// 严格归一化：任何未知/非法输入都退回保守默认，不抛错（读路径用）。
/// 只接受真正的字符串来源 ID；任意对象经 String() 变形后不得混入。
export function normalizeReader(raw) {
  const out = { selectedSources: [], moreSourcesEnabled: false, configured: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  if (Array.isArray(raw.selectedSources)) {
    out.selectedSources = [
      ...new Set(
        raw.selectedSources.filter((s) => typeof s === "string").filter((s) => READER_SOURCE_IDS.has(s))
      ),
    ];
  }
  out.moreSourcesEnabled = raw.moreSourcesEnabled === true;
  out.configured = raw.configured === true;
  return out;
}

/// 有效来源集合：关闭“更多来源”时保留已选扩展 ID（存储不丢），但过滤掉。
export function effectiveSources(reader) {
  const normalized = normalizeReader(reader);
  const allow = normalized.moreSourcesEnabled
    ? READER_SOURCE_IDS
    : READER_BASIC_SET;
  return new Set(normalized.selectedSources.filter((id) => allow.has(id)));
}

export function isHttpUrl(u) {
  try {
    const parsed = new URL(String(u));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    if (!parsed.host) return false;
    // 带嵌入凭据的链接一律视为不安全，不进入订阅流。
    if (parsed.username || parsed.password) return false;
    return true;
  } catch {
    return false;
  }
}

/// 订阅流过滤只看 primary source 与原文链接；聚类里的 secondary source
/// 不参与判定，未选来源不能借道混入。hidden 类内容与订阅流无关。
export function readerAllowed(item, effectiveSet) {
  if (!item) return false;
  if (!effectiveSet || effectiveSet.size === 0) return false;
  if (!READER_SOURCE_IDS.has(String(item.source))) return false;
  if (!effectiveSet.has(String(item.source))) return false;
  if (item.category === "hidden") return false;
  return isHttpUrl(item.url);
}

function timeOf(item) {
  // 资讯取发布时间，repo 观测项取最近观测时间，再退回采集时间：
  // 老文章不会因为被重复采集而排到最前。
  const precedence = item.githubRepo
    ? [item.githubRepo.observedAt, item.observedAt, item.firstSeenAt, item.seenAt, item.publishedAt]
    : [item.publishedAt, item.occurredAt, item.observedAt, item.firstSeenAt, item.seenAt];
  for (const candidate of precedence) {
    const timestamp = Date.parse(candidate || "");
    if (Number.isFinite(timestamp) && timestamp > 0) return timestamp;
  }
  return 0;
}

export function sortReaderItems(items) {
  return [...items]
    .map((it) => ({ it, t: timeOf(it) }))
    .sort((a, b) => (a.t !== b.t ? b.t - a.t : String(a.it.id).localeCompare(String(b.it.id))))
    .map((x) => x.it);
}

/// 游客仅可用 query 里的基础集来源；缺省为空集（空结果，不回退全站）。
export function guestEffectiveSources(rawQuery) {
  const requested = String(rawQuery || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(requested.filter((s) => READER_BASIC_SET.has(s)));
}
