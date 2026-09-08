import { fetchRss, toSourceItem } from "../rss.js";

const ARTICLE_FEEDS = [
  "https://36kr.com/feed",
  "https://www.36kr.com/feed",
];

const FLASH_FEEDS = [
  "https://36kr.com/feed-newsflash",
  "https://www.36kr.com/feed-newsflash",
];

function krKey(url) {
  return String(url || "").replace(/\?f=rss$/i, "");
}

async function firstFeed(feeds, source) {
  const errors = [];
  try {
    const parsed = await Promise.any(
      feeds.map(async (feed) => {
        const items = await fetchRss(feed);
        if (!items.length) throw new Error(feed + " no items");
        return items;
      })
    );
    return parsed.map((it) => {
      const row = toSourceItem(source, it, krKey(it.url));
      row.role = source === "36kr-flash" ? "flash" : "article";
      return row;
    });
  } catch (e) {
    if (e && e.errors) {
      for (const err of e.errors) {
        errors.push(err && err.message ? err.message : String(err));
      }
    } else {
      errors.push(e && e.message ? e.message : String(e));
    }
  }
  throw new Error(errors.join("; ") || source + " failed");
}

export async function fetch36krArticles() {
  return firstFeed(ARTICLE_FEEDS, "36kr");
}

export async function fetch36krFlash() {
  return firstFeed(FLASH_FEEDS, "36kr-flash");
}

/** Article feed only. Flash is collected separately. */
export async function fetch36kr() {
  return fetch36krArticles();
}
