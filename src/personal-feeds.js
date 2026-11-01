import { XMLParser, XMLValidator } from "fast-xml-parser";
import { stripHtml, decodeEntities } from "./html.js";
import { shortHash } from "./hash.js";
import { toIso } from "./time.js";
import { fetchImported } from "./ssrf.js";

// 自定义 RSS（账户私有订阅源）。
// - 条目数据只存在于账户自己的 user_feeds / user_feed_items 表，绝不进入
//   共享 events/articles、公开目录、digest 或通用 sync/export。
// - 拉取走 SSRF 安全的 fetchImported（封顶字节/时限/重定向，逐跳校验）。

export const FEED_LIMIT_PER_USER = 30;
export const FEED_ITEM_RETENTION = 200;
export const FEED_FETCH_MAX_BYTES = 1_000_000;
export const FEED_FETCH_TIMEOUT_MS = 10_000;
export const FEED_NAME_MAX = 120;
export const FEED_DISCOVERY_LIMIT = 3;

// AIHOT（用户确认个人非商用使用；私有订阅，不进共享事件/公共镜像）。
export const AIHOT_FEED_URL = "https://aihot.news/feed.xml";
const AIHOT_UA = "aihot-api/2.0.0";
export const AIHOT_REFRESH_FLOOR_MS = 30 * 60 * 1000;

/// Provider 友好 UA：aihot.news 按 its API 标识请求。
export function feedUserAgentFor(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === "aihot.news" || host.endsWith(".aihot.news")) return AIHOT_UA;
  } catch { /* fall through */ }
  return "";
}

export function isAihotFeed(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "aihot.news" || host.endsWith(".aihot.news");
  } catch {
    return false;
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  processEntities: true,
  trimValues: true,
  isArray: (name) => ["item", "entry", "link", "category", "author"].includes(name),
});

function nodeText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object") {
    if (node.__cdata != null) return nodeText(node.__cdata);
    if (node["#text"] != null) return nodeText(node["#text"]);
  }
  return "";
}

function cleanText(node) {
  // 名称/摘要一律去 HTML：新源名称可能携带恶意标记，入库即纯文本。
  return stripHtml(decodeEntities(nodeText(node))).trim();
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function looksLikeFeedXml(text) {
  return /<rss[\s>]/i.test(text) || /<feed[\s>]/i.test(text) || /<channel[\s>]/i.test(text);
}

function absoluteUrl(href, baseUrl) {
  // 空 href 决不能回落成源 URL 本身（否则条目链接变成 feed 链接）。
  if (!String(href || "").trim()) return "";
  try {
    const u = new URL(String(href), baseUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (u.username || u.password) return "";
    return u.toString();
  } catch {
    return "";
  }
}

/// Atom link 选择：alternate 优先，其次无 rel，self 最后。
function linkHref(node, baseUrl) {
  const candidates = [];
  for (const link of asArray(node)) {
    if (typeof link === "string") {
      const abs = absoluteUrl(link, baseUrl);
      if (abs) candidates.push({ rel: "alternate", abs });
      continue;
    }
    if (link && typeof link === "object") {
      const raw = link["@_href"] || link["@_url"] || nodeText(link);
      if (!raw) continue;
      const rel = String(link["@_rel"] || "alternate").toLowerCase();
      if (rel !== "alternate" && rel !== "self" && link["@_rel"]) continue;
      const abs = absoluteUrl(raw, baseUrl);
      if (abs) candidates.push({ rel, abs });
    }
  }
  const pick = candidates.find((c) => c.rel === "alternate") || candidates.find((c) => c.rel !== "self") || candidates[0];
  return pick ? pick.abs : "";
}

function takeDate(it) {
  return (
    toIso(nodeText(it.pubDate)) ||
    toIso(nodeText(it.published)) ||
    toIso(nodeText(it.updated)) ||
    toIso(nodeText(it["dc:date"])) ||
    ""
  );
}

function mapEntry(it, kind, baseUrl) {
  const title = cleanText(it.title);
  let url;
  if (kind === "atom") {
    url = linkHref(it.link, baseUrl) || absoluteUrl(cleanText(it.id), baseUrl);
  } else {
    url = absoluteUrl(cleanText(it.link) || linkHref(it.link, baseUrl) || cleanText(it.guid), baseUrl);
  }
  if (!title || !url) return null;
  const rawSummary = it.description || it.summary || it.content || it["content:encoded"] || "";
  const summary = cleanText(rawSummary).slice(0, 4000);
  const publishedAt = takeDate(it);
  const guid = cleanText(it.guid) || cleanText(it.id);
  const key = guid || url;
  const item = { key, title: title.slice(0, 400), url };
  if (summary) item.summary = summary;
  if (publishedAt) item.publishedAt = publishedAt;
  return item;
}

export class NotAFeedError extends Error {
  constructor(message = "not a feed", discovered = []) {
    super(message);
    this.code = "NOT_A_FEED";
    this.discovered = discovered;
  }
}

/// 解析 RSS 2.0 / Atom 文档。允许合法空源（0 条目）。
/// 相对文章链接基于源 URL 解析；名称只保留纯文本。
export function parsePersonalFeed(xml, baseUrl = "") {
  const raw = String(xml || "");
  // 明确的 HTML 页面（即便体内嵌了 <rss> 字样）不是源。
  if (/<html[\s>]/i.test(raw) || /<!doctype html/i.test(raw)) {
    throw new NotAFeedError();
  }
  if (!looksLikeFeedXml(raw)) {
    throw new NotAFeedError();
  }
  // 残缺 XML（未闭合标签等）在此拒绝，不能靠 parser 的容错混过去。
  if (XMLValidator.validate(raw, { isArray: () => false }) !== true) {
    throw new NotAFeedError();
  }
  let doc;
  try {
    doc = parser.parse(raw);
  } catch {
    throw new NotAFeedError();
  }
  const channel = doc?.rss?.channel || doc?.channel || null;
  const atomFeed = doc?.feed || null;
  if (!channel && !atomFeed) throw new NotAFeedError();

  let title = "";
  let entries = [];
  let kind = "rss";
  if (channel) {
    title = cleanText(channel.title);
    entries = asArray(channel.item);
  } else {
    kind = "atom";
    title = cleanText(atomFeed.title);
    entries = asArray(atomFeed.entry);
  }
  const items = entries
    .map((it) => mapEntry(it, kind, baseUrl))
    .filter(Boolean);
  return { title: title.slice(0, FEED_NAME_MAX), items, kind };
}

/// HTML 页面声明的 feed 链接（有界：最多 FEED_DISCOVERY_LIMIT 个）。
export function discoverFeedLinks(html, baseUrl) {
  const raw = String(html || "");
  if (!/<html[\s>]/i.test(raw) && !/<!doctype html/i.test(raw)) return [];
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(raw)) && out.length < FEED_DISCOVERY_LIMIT) {
    const tag = m[0];
    if (!/rel=["']?alternate/i.test(tag)) continue;
    if (!/(rss|atom)/i.test(tag)) continue;
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const abs = absoluteUrl(href, baseUrl);
    if (abs) out.push(abs);
  }
  return out;
}

/// SSRF 安全地拉取并解析一个源。HTML 页面 → NotAFeedError（携带发现
/// 的候选源，调用方可有界重试一次）。fetchImpl/lookupImpl 可注入测试。
export async function fetchPersonalFeed(url, opts = {}) {
  const fetched = await fetchImported(url, {
    _startedAt: opts._startedAt,
    maxBytes: opts.maxBytes ?? FEED_FETCH_MAX_BYTES,
    timeoutMs: opts.timeoutMs ?? FEED_FETCH_TIMEOUT_MS,
    lookupImpl: opts.lookupImpl,
    fetchImpl: opts.fetchImpl,
    userAgent: feedUserAgentFor(url) || opts.userAgent || "",
  });
  const isHtml = /html/i.test(fetched.contentType);
  if (isHtml && !looksLikeFeedXml(fetched.text)) {
    throw new NotAFeedError("html not a feed", discoverFeedLinks(fetched.text, fetched.url));
  }
  try {
    // 以最终（重定向后）URL 为基准解析相对链接与 autodiscovery。
    return { ...parsePersonalFeed(fetched.text, fetched.url), url: fetched.url };
  } catch (e) {
    if (e instanceof NotAFeedError && isHtml) throw e;
    // XML 声明却解析不出 channel/feed：视为非源。
    throw new NotAFeedError();
  }
}

/// 同一篇文章（key 相同）去重，保留 firstSeenAt 与既有 id；按文章时间
/// 倒序，超出容量的最旧条目淘汰。
export function mergeFeedItems(prevItems, incoming, { retention = FEED_ITEM_RETENTION, nowIso } = {}) {
  const now = nowIso || new Date().toISOString();
  const byKey = new Map();
  for (const it of prevItems || []) {
    if (it && it.key) byKey.set(it.key, { ...it });
  }
  for (const it of incoming || []) {
    if (!it || !it.key) continue;
    const prev = byKey.get(it.key);
    if (prev) {
      byKey.set(it.key, {
        ...prev,
        title: it.title || prev.title,
        url: it.url || prev.url,
        summary: it.summary || prev.summary,
        publishedAt: it.publishedAt || prev.publishedAt,
      });
    } else {
      byKey.set(it.key, { ...it, firstSeenAt: now });
    }
  }
  const sorted = [...byKey.values()].sort((a, b) => {
    const ta = Date.parse(a.publishedAt || a.firstSeenAt || "") || 0;
    const tb = Date.parse(b.publishedAt || b.firstSeenAt || "") || 0;
    if (ta !== tb) return tb - ta;
    return String(a.key).localeCompare(String(b.key));
  });
  return sorted.slice(0, retention);
}

/// owner/source 稳定 ID：同一账户同一源自同一文章恒定。
/// Feed 身份用保守规范化：仅小写 host、去默认端口、去 fragment——
/// 保留 www 与全部查询参数（私有源 URL 不能套用文章级跟踪参数归一，
/// 否则会把不同订阅合并成一个）。
export function feedUrlKey(url) {
  try {
    const u = new URL(String(url));
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === "https:" && u.port === "443") || (u.protocol === "http:" && u.port === "80")) {
      u.port = "";
    }
    return u.toString();
  } catch {
    return String(url || "");
  }
}

export function personalFeedId(userId, url) {
  return "pf:" + shortHash(userId + "\n" + feedUrlKey(url), 16);
}

export function personalFeedItemId(userId, feedId, key) {
  return "pfi:" + shortHash(userId + "\n" + feedId + "\n" + key, 20);
}

export const PERSONAL_FEED_SOURCE = "rss";

/// 把账户源条目投影成阅读器条目（含来源标签；不进入共享事件表）。
export function personalItemToReader(userId, feed, it) {
  const id = it.id || personalFeedItemId(userId, feed.feedId, it.key);
  const item = {
    id,
    articleId: id,
    title: it.title,
    url: it.url,
    source: PERSONAL_FEED_SOURCE,
    sourceLabel: feed.name || "",
    feedId: feed.feedId,
    personalFeed: true,
  };
  if (it.summary) item.summary = it.summary;
  if (it.publishedAt) item.publishedAt = it.publishedAt;
  if (it.firstSeenAt) item.firstSeenAt = it.firstSeenAt;
  return item;
}
