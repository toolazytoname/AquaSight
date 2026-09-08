/** Source roles. Content category is decided separately. */

export const SOURCE_CATALOG = {
  hn: {
    role: "article",
    purpose: "科技社区：文章链接、讨论、点赞与评论数",
    family: "tech",
    quality: 0.85,
  },
  github: {
    role: "opensource",
    purpose: "开源发现，不是趋势榜",
    family: "tech",
    quality: 0.5,
    label: "开源发现",
  },
  "36kr": {
    role: "article",
    purpose: "36氪文章",
    family: "business",
    quality: 0.7,
  },
  "36kr-flash": {
    role: "flash",
    purpose: "36氪快讯",
    family: "business",
    quality: 0.45,
  },
  weibo: { role: "clue", purpose: "微博热搜线索", family: "clue", quality: 0.2 },
  baidu: { role: "clue", purpose: "百度热搜线索", family: "clue", quality: 0.2 },
  toutiao: { role: "clue", purpose: "头条热搜线索", family: "clue", quality: 0.2 },
  hot: { role: "clue", purpose: "热搜线索", family: "clue", quality: 0.2 },
  ithome: { role: "article", purpose: "IT之家资讯", family: "tech", quality: 0.6 },
  qbitai: { role: "article", purpose: "量子位", family: "tech", quality: 0.65 },
  v2ex: { role: "discussion", purpose: "V2EX 讨论", family: "tech", quality: 0.55 },
  wallstreetcn: {
    role: "article",
    purpose: "华尔街见闻",
    family: "business",
    quality: 0.65,
  },
  techcrunch: { role: "article", purpose: "TechCrunch", family: "tech", quality: 0.8 },
  bbc: { role: "article", purpose: "BBC 国际新闻", family: "world", quality: 0.7 },
  verge: { role: "article", purpose: "The Verge", family: "tech", quality: 0.75 },
  openai: { role: "official", purpose: "OpenAI 官方", family: "tech", quality: 0.95 },
  x: { role: "social", purpose: "X 引用或手工导入", family: "tech", quality: 0.4 },
  import: { role: "import", purpose: "手工导入", family: "other", quality: 0.4 },
};

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
export const BUSINESS_SOURCES = new Set(["36kr", "36kr-flash", "wallstreetcn"]);

export function sourceMeta(source) {
  const s = String(source || "").toLowerCase();
  return (
    SOURCE_CATALOG[s] || {
      role: "article",
      purpose: "未登记来源",
      family: "other",
      quality: 0.4,
    }
  );
}

const SOURCE_LABELS = {
  hn: "Hacker News",
  hackernews: "Hacker News",
  github: "开源发现",
  ithome: "IT之家",
  qbitai: "量子位",
  v2ex: "V2EX",
  techcrunch: "TechCrunch",
  verge: "The Verge",
  openai: "OpenAI",
  "36kr": "36氪",
  "36kr-flash": "36氪快讯",
  wallstreetcn: "华尔街见闻",
  bbc: "BBC",
  x: "X",
  weibo: "微博",
  baidu: "百度",
  toutiao: "头条",
  import: "导入",
};

export function sourceLabel(source) {
  const s = String(source || "").toLowerCase();
  return SOURCE_LABELS[s] || SOURCE_CATALOG[s]?.label || source || "";
}

export function sourceFamily(source) {
  return sourceMeta(source).family;
}

export function sourceRole(source) {
  return sourceMeta(source).role;
}

export function sourceQuality(source) {
  return sourceMeta(source).quality;
}

export function isClueSource(source) {
  return sourceRole(source) === "clue";
}

export function isOpensourceSource(source) {
  return sourceRole(source) === "opensource";
}
