import { fetchRss, toSourceItem } from "../rss.js";

export async function fetchIthome() {
  const parsed = (await fetchRss("https://www.ithome.com/rss/")).slice(0, 15);
  return parsed.map((it) => toSourceItem("ithome", it));
}
