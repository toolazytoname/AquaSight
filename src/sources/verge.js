import { fetchRss, toSourceItem } from "../rss.js";

export async function fetchVerge() {
  const parsed = (await fetchRss("https://www.theverge.com/rss/index.xml")).slice(
    0,
    15
  );
  return parsed.map((it) => toSourceItem("verge", it));
}
