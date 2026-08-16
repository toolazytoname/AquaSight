import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

export async function fetchTechcrunch() {
  const parsed = (await fetchRss("https://techcrunch.com/feed/")).slice(0, 15);
  return parsed.map((it) => {
    const item = {
      id: makeId("techcrunch", it.url),
      title: it.title,
      url: it.url,
      source: "techcrunch",
    };
    if (it.summary) item.summary = it.summary;
    return item;
  });
}
