import { makeId } from "../http.js";
import { fetchRss } from "../rss.js";

export async function fetchIthome() {
  const parsed = (await fetchRss("https://www.ithome.com/rss/")).slice(0, 15);
  return parsed.map((it) => {
    const item = {
      id: makeId("ithome", it.url),
      title: it.title,
      url: it.url,
      source: "ithome",
    };
    if (it.summary) item.summary = it.summary;
    return item;
  });
}
