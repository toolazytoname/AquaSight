import { eventDayKey, parseTitleTime, toIso } from "./time.js";

export const LAB_RE =
  /DeepSeek|OpenAI|Anthropic|英伟达|NVIDIA|华为|Huawei|Kimi|Moonshot|\bK3\b|Qwen|Claude|GPT|Gemini|Google|Microsoft|Meta|Apple|Tesla|ByteDance|字节跳动|阿里巴巴|阿里云|腾讯|百度|xAI|SpaceX|Intel|AMD|ARM|高通|Qualcomm|台积电|TSMC|微软|谷歌|苹果/i;

const SUBJECT_ALIASES = [
  ["openai", /openai/i],
  ["deepseek", /deepseek/i],
  ["nvidia", /英伟达|nvidia/i],
  ["huawei", /华为|huawei/i],
  ["anthropic", /anthropic/i],
  ["google", /google|谷歌/i],
  ["microsoft", /microsoft|微软/i],
  ["meta", /\bmeta\b|facebook/i],
  ["apple", /apple|苹果/i],
  ["tesla", /tesla|特斯拉/i],
  ["bytedance", /bytedance|字节跳动|字节/i],
  ["alibaba", /alibaba|阿里巴巴|阿里云/i],
  ["tencent", /tencent|腾讯/i],
  ["baidu", /baidu|百度/i],
  ["xai", /\bxai\b/i],
  ["kimi", /\bkimi\b|moonshot/i],
  ["qwen", /\bqwen\b|通义/i],
  ["gemini", /gemini/i],
  ["claude", /claude/i],
];

const ACTION_RULES = [
  { key: "review", re: /回顾|周年|十年前|那年|历史上的今天|on this day|years ago|throwback/i },
  { key: "death", re: /去世|逝世|病逝|\bdies?\b|died|obituar|passed away/i },
  { key: "disaster", re: /地震|空难|海啸|飓风|洪水|山火|遇难|earthquake|tsunami|hurricane|air crash|plane crash/i },
  { key: "earnings", re: /净利润|营收|财报|半年报|年报|季度报|同比增长|earnings|revenue|quarterly results/i },
  { key: "opensource", re: /开源|open[ -]?source/i },
  { key: "release", re: /正式发布|发布|推出|上线|launches?|released?\b|announces?|introduces?|unveils?|generally available|\bGA\b|available now/i },
  { key: "funding", re: /融资|估值|series [a-d]\b|raises?\b/i },
  { key: "acquire", re: /收购|并购|acquires?|acquisition/i },
];

const PRODUCT_RE =
  /(GPT-?\d(?:\.\d)?[A-Za-z-]*|\bo\d(?:-mini)?\b|\bR1\b|\bK3\b|Claude[\s-]?\d(?:\.\d)?|Gemini[\s-]?\d(?:\.\d)?|Qwen[\s.-]?\d(?:\.\d)?|盘古(?:大模型)?[\s.-]?\d(?:\.\d)?|鸿蒙(?:电脑|系统|OS)?|HarmonyOS|HoloLens|\bSora\b|Grok[\s-]?\d(?:\.\d)?)/gi;

const EN_RELEASE_RE =
  /\b(launches?|released?\b|announces?|introduces?|unveils?|generally available|available now|\bGA\b)\b/i;

export const VETO_RE =
  /胖东来|你好星期六|跑男|恋综|综艺|晚会/;
export const ENT_DISPLAY_RE =
  /明星|演唱会|票房|剧集|追剧|短剧|综艺|晚会|金鹰奖|提名|掉提|官宣|宠妃/;
export const CURIOSITY_RE =
  /乞丐|麻袋现金|奇葩|猎奇|惊悚|灵异|八卦|遗产纠纷/;
export const PROMO_RE =
  /促销|打折|优惠券|免费领|满减|补贴倒计时|大甩卖|\bcoupon\b|\bsale\b|限时折扣/;
export const ACCIDENT_GOSSIP_RE =
  /车祸|意外去世|身亡.*子女|家属.*争/;

export function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "")
    .trim();
}

export function companyPrefix(title) {
  const s = String(title || "");
  const i = s.search(/[：:]/);
  if (i <= 0 || i > 24) return "";
  return s.slice(0, i).trim();
}

export function subjectsOf(title) {
  const s = String(title || "");
  const found = new Set();
  for (const [canon, re] of SUBJECT_ALIASES) {
    if (re.test(s)) found.add(canon);
  }
  const prefix = companyPrefix(s);
  if (prefix) found.add(normalizeTitle(prefix) || prefix);
  return [...found];
}

export function primarySubject(title) {
  const all = subjectsOf(title);
  return all[0] || "";
}

export function actionOf(title) {
  const s = String(title || "");
  for (const rule of ACTION_RULES) {
    if (rule.re.test(s)) return rule.key;
  }
  return "other";
}

export function productsOf(title) {
  const s = String(title || "");
  const found = [];
  const re = new RegExp(PRODUCT_RE.source, "gi");
  let m;
  while ((m = re.exec(s))) {
    found.push(String(m[1] || m[0]).toLowerCase().replace(/\s+/g, ""));
  }
  return [...new Set(found)];
}

export function primaryProduct(title) {
  return productsOf(title)[0] || "";
}

export function isEnglishOfficialRelease(title) {
  const s = String(title || "");
  if (!/[A-Za-z]{4,}/.test(s)) return false;
  return EN_RELEASE_RE.test(s) && (LAB_RE.test(s) || /\b(model|api|sdk|open.?source)\b/i.test(s));
}

export function extractEvent(item, now = new Date()) {
  const title = item?.title || "";
  const time = parseTitleTime(title, now);
  const publishedAt = toIso(item?.publishedAt) || "";
  const firstSeenAt =
    toIso(item?.firstSeenAt) || toIso(item?.seenAt) || toIso(now);
  const occurredAt = time.occurredAt || publishedAt || firstSeenAt;
  return {
    subject: primarySubject(title),
    subjects: subjectsOf(title),
    action: actionOf(title),
    product: primaryProduct(title),
    products: productsOf(title),
    occurredAt,
    publishedAt,
    firstSeenAt,
    retrospective: time.retrospective,
    englishRelease: isEnglishOfficialRelease(title),
    dayKey: eventDayKey(
      { occurredAt, publishedAt, firstSeenAt, seenAt: item?.seenAt },
      now
    ),
  };
}

export function mergeKeysOf(item, now = new Date()) {
  const title = item?.title || "";
  const meta = extractEvent(item, now);
  const keys = [];
  const norm = normalizeTitle(title);
  if (norm) keys.push("t:" + norm + "@" + (meta.dayKey || ""));
  if (meta.subject && meta.action === "earnings") {
    keys.push("e:" + meta.subject + "|earnings@" + (meta.dayKey || ""));
  }
  if (meta.subject && meta.product && (meta.action === "release" || meta.action === "opensource")) {
    keys.push(
      "e:" +
        meta.subject +
        "|" +
        meta.product +
        "|" +
        (meta.action === "opensource" ? "release" : meta.action) +
        "@" +
        (meta.dayKey || "")
    );
  }
  if (meta.subject && meta.product && meta.action !== "earnings" && meta.action !== "other") {
    keys.push(
      "e:" + meta.subject + "|" + meta.product + "|" + meta.action + "@" + (meta.dayKey || "")
    );
  }
  return { keys, meta };
}
