import { getText, makeId } from "../http.js";

const FEEDS = [
  "https://36kr.com/feed-newsflash",
  "https://36kr.com/feed",
];

function decode(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function parseRss(xml) {
  const items = [];
  const parts = xml.split(/<item[\s>]/i).slice(1);
  for (const part of parts) {
    const titleM = part.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkM =
      part.match(/<link[^>]*>([\s\S]*?)<\/link>/i) ||
      part.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
    const title = decode(titleM ? titleM[1] : "");
    const url = decode(linkM ? linkM[1] : "");
    if (title && url && /^https?:/i.test(url)) {
      items.push({ title, url });
    }
  }
  return items;
}

export async function fetch36kr() {
  const errors = [];
  for (const feed of FEEDS) {
    try {
      const { text, contentType } = await getText(feed, {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });
      if (/html/i.test(contentType) && !/<item[\s>]/i.test(text)) {
        errors.push(feed + " returned html");
        continue;
      }
      const parsed = parseRss(text).slice(0, 20);
      if (parsed.length) {
        return parsed.map((it) => ({
          id: makeId("36kr", it.url),
          title: it.title,
          url: it.url,
          source: "36kr",
        }));
      }
      errors.push(feed + " no items");
    } catch (e) {
      errors.push(feed + " " + (e && e.message ? e.message : e));
    }
  }
  throw new Error(errors.join("; ") || "36kr failed");
}
