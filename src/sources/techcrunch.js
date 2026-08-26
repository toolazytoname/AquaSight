import { fetchRss, toSourceItem } from "../rss.js";

export async function fetchTechcrunch() {
  const parsed = (await fetchRss("https://techcrunch.com/feed/")).slice(0, 15);
  return parsed.map((it) => toSourceItem("techcrunch", it));
}
