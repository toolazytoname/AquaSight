import { fetchRss, toSourceItem } from "../rss.js";

const FEEDS = [
  "https://36kr.com/feed-newsflash",
  "https://36kr.com/feed",
  "https://www.36kr.com/feed-newsflash",
  "https://www.36kr.com/feed",
];

function krKey(url) {
  return String(url || "").replace(/\?f=rss$/i, "");
}

export async function fetch36kr() {
  const errors = [];
  try {
    const parsed = await Promise.any(
      FEEDS.map(async (feed) => {
        const items = (await fetchRss(feed)).slice(0, 20);
        if (!items.length) throw new Error(feed + " no items");
        return items;
      })
    );
    return parsed.map((it) => toSourceItem("36kr", it, krKey(it.url)));
  } catch (e) {
    if (e && e.errors) {
      for (const err of e.errors) {
        errors.push(err && err.message ? err.message : String(err));
      }
    } else {
      errors.push(e && e.message ? e.message : String(e));
    }
  }
  throw new Error(errors.join("; ") || "36kr failed");
}
