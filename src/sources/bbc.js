import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

const FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://feeds.bbci.co.uk/news/rss.xml",
];

export async function fetchBbc() {
  const errors = [];
  for (const feed of FEEDS) {
    try {
      const parsed = (await fetchRss(feed)).slice(0, 15);
      if (parsed.length) {
        return parsed.map((it) => {
          const item = {
            id: makeId("bbc", it.url),
            title: it.title,
            url: it.url,
            source: "bbc",
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
  throw new Error(errors.join("; ") || "bbc failed");
}
