import { fetchRss, toSourceItem } from "../rss.js";

export async function fetchQbitai() {
  const parsed = (await fetchRss("https://www.qbitai.com/feed")).slice(0, 15);
  return parsed.map((it) => toSourceItem("qbitai", it));
}
