import { fetchRss, toSourceItem } from "../rss.js";

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
        return parsed.map((it) => toSourceItem("bbc", it));
      }
      errors.push(feed + " no items");
    } catch (e) {
      errors.push(feed + " " + (e && e.message ? e.message : e));
    }
  }
  throw new Error(errors.join("; ") || "bbc failed");
}
