import { fetchRss, toSourceItem } from "../rss.js";

export async function fetchOpenai() {
  const parsed = (await fetchRss("https://openai.com/news/rss.xml")).slice(0, 15);
  return parsed.map((it) => toSourceItem("openai", it));
}
