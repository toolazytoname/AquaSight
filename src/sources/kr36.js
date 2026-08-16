import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

const FEEDS = [
  "https://36kr.com/feed-newsflash",
  "https://36kr.com/feed",
  "https://www.36kr.com/feed-newsflash",
  "https://www.36kr.com/feed",
];

export async function fetch36kr() {
  const errors = [];
  for (const feed of FEEDS) {
    try {
      const parsed = (await fetchRss(feed)).slice(0, 20);
      if (parsed.length) {
        return parsed.map((it) => {
          const item = {
            id: makeId("36kr", it.url),
            title: it.title,
            url: it.url,
            source: "36kr",
          };
          if (it.summary) item.summary = it.summary;
          return item;
        });
      }
      errors.push(feed + " no items");
    } catch (e) {
      errors.push(feed + " " + (e && e.message ? e.message : e));
    }
  }
  throw new Error(errors.join("; ") || "36kr failed");
}
