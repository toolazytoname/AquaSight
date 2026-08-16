import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

export async function fetchVerge() {
  const parsed = (await fetchRss("https://www.theverge.com/rss/index.xml")).slice(0, 15);
  return parsed.map((it) => {
    const item = {
      id: makeId("verge", it.url),
      title: it.title,
      url: it.url,
      source: "verge",
    };
    if (it.summary) item.summary = it.summary;
    return item;
  });
}
