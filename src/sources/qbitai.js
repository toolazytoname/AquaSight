import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

export async function fetchQbitai() {
  const parsed = (await fetchRss("https://www.qbitai.com/feed")).slice(0, 15);
  return parsed.map((it) => {
    const item = {
      id: makeId("qbitai", it.url),
      title: it.title,
      url: it.url,
      source: "qbitai",
    };
    if (it.summary) item.summary = it.summary;
    return item;
  });
}
