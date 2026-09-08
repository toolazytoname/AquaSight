import { XMLParser } from "fast-xml-parser";
import { getText } from "./http.js";
import { stripHtml, decodeEntities } from "./html.js";
import { articleId } from "./identity.js";
import { toIso } from "./time.js";

const RSS_HEADERS = {
  Accept:
    "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  processEntities: true,
  trimValues: true,
  isArray: (name) =>
    ["item", "entry", "link", "category", "dc:creator"].includes(name),
});

export { stripHtml, decodeEntities };

export function decodeRss(s) {
  return stripHtml(decodeEntities(s));
}

export function toIsoDate(raw) {
  return toIso(raw);
}

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
  return stripHtml(decodeEntities(nodeText(node)));
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function linkHref(node) {
  const links = asArray(node);
  for (const link of links) {
    if (typeof link === "string" && /^https?:/i.test(link)) return link.trim();
    if (link && typeof link === "object") {
      const href = link["@_href"] || link["@_url"] || nodeText(link);
      const rel = String(link["@_rel"] || "alternate");
      if (href && /^https?:/i.test(href) && (rel === "alternate" || rel === "self" || !link["@_rel"])) {
        return String(href).trim();
      }
    }
  }
  for (const link of links) {
    if (link && typeof link === "object") {
      const href = link["@_href"] || nodeText(link);
      if (href && /^https?:/i.test(href)) return String(href).trim();
    }
  }
  return "";
}

function takeDate(it) {
  return (
    toIso(nodeText(it.pubDate)) ||
    toIso(nodeText(it.published)) ||
    toIso(nodeText(it.updated)) ||
    toIso(nodeText(it["dc:date"])) ||
    toIso(it["@_pubDate"]) ||
    ""
  );
}

function mapItem(it, kind) {
  const title = cleanText(it.title);
  const url =
    kind === "atom"
      ? linkHref(it.link) || cleanText(it.id)
      : cleanText(it.link) || linkHref(it.link) || cleanText(it.guid);
  if (!title || !url || !/^https?:/i.test(url)) return null;
  const rawSummary =
    it.description || it.summary || it.content || it["content:encoded"] || "";
  const summary = cleanText(rawSummary);
  const item = { title, url };
  if (summary) item.summary = summary;
  const publishedAt = takeDate(it);
  if (publishedAt) item.publishedAt = publishedAt;
  const guid = cleanText(it.guid) || cleanText(it.id);
  if (guid) item.guid = guid;
  return item;
}

export function parseRss(xml) {
  const raw = String(xml || "");
  try {
    const doc = parser.parse(raw);
    const channel = doc?.rss?.channel || doc?.channel || {};
    const items = asArray(channel.item);
    return items.map((it) => mapItem(it, "rss")).filter(Boolean);
  } catch {
    return fallbackParse(raw, "item");
  }
}

export function parseAtom(xml) {
  const raw = String(xml || "");
  try {
    const doc = parser.parse(raw);
    const feed = doc?.feed || doc;
    const items = asArray(feed.entry);
    return items.map((it) => mapItem(it, "atom")).filter(Boolean);
  } catch {
    return fallbackParse(raw, "entry");
  }
}

function fallbackParse(xml, tag) {
  const items = [];
  const re = new RegExp("<" + tag + "[\\s>]([\\s\\S]*?)</" + tag + ">", "gi");
  let m;
  while ((m = re.exec(String(xml || "")))) {
    const part = m[1];
    const title = decodeRss((part.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const hrefM = part.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const linkText = part.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const url = decodeRss(hrefM ? hrefM[1] : linkText ? linkText[1] : "");
    if (title && url && /^https?:/i.test(url)) {
      const desc = decodeRss(
        (part.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
          part.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
          [])[1] || ""
      );
      const item = { title, url };
      if (desc) item.summary = desc;
      items.push(item);
    }
  }
  return items;
}

export function toSourceItem(source, it, key) {
  const item = {
    title: it.title,
    url: it.url,
    source,
    externalId: String(key || it.guid || it.url || ""),
  };
  item.id = articleId(item);
  item.articleId = item.id;
  if (it.summary) item.summary = it.summary;
  if (it.publishedAt) item.publishedAt = it.publishedAt;
  if (it.guid) item.guid = it.guid;
  return item;
}

export async function fetchRss(url) {
  const { text, contentType } = await getText(url, { headers: RSS_HEADERS });
  const hasItem = /<item[\s>]/i.test(text);
  const hasEntry = /<entry[\s>]/i.test(text);
  if (/html/i.test(contentType) && !hasItem && !hasEntry) {
    throw new Error("rss returned html " + url);
  }
  let items = parseRss(text);
  if (!items.length) items = parseAtom(text);
  if (!items.length) throw new Error("rss empty " + url);
  return items;
}
