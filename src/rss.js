import { getText } from "./http.js";

const RSS_HEADERS = {
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

export function decodeRss(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseRss(xml) {
  const items = [];
  const parts = String(xml || "").split(/<item[\s>]/i).slice(1);
  for (const part of parts) {
    const titleM = part.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM =
      part.match(/<link[^>]*>([\s\S]*?)<\/link>/i) ||
      part.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const descM = part.match(/<description[^>]*>([\s\S]*?)<\/description>/i);
    const title = decodeRss(titleM ? titleM[1] : "");
    const url = decodeRss(linkM ? linkM[1] : "");
    if (title && url && /^https?:/i.test(url)) {
      const item = { title, url };
      const summary = stripHtml(decodeRss(descM ? descM[1] : "")).slice(0, 120);
      if (summary) item.summary = summary;
      items.push(item);
    }
  }
  return items;
}

export async function fetchRss(url) {
  const { text, contentType } = await getText(url, { headers: RSS_HEADERS });
  if (/html/i.test(contentType) && !/<item[\s>]/i.test(text)) {
    throw new Error("rss returned html " + url);
  }
  const items = parseRss(text);
  if (!items.length) throw new Error("rss empty " + url);
  return items;
}
