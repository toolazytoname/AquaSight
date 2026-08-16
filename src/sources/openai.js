import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

export async function fetchOpenai() {
  const parsed = (await fetchRss("https://openai.com/news/rss.xml")).slice(0, 15);
  return parsed.map((it) => {
    const item = {
      id: makeId("openai", it.url),
      title: it.title,
      url: it.url,
      source: "openai",
    };
    if (it.summary) item.summary = it.summary;
    return item;
  });
}
