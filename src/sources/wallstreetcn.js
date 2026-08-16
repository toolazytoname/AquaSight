import { getJson, makeId } from "../http.js";
import { stripHtml } from "../rss.js";

const URL =
  "https://api-one-wscn.awtmt.com/apiv1/content/lives?channel=global-channel&limit=20";

export async function fetchWallstreetcn() {
  const data = await getJson(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://wallstreetcn.com/",
    },
  });
  const list =
    data && data.data && Array.isArray(data.data.items) ? data.data.items : [];
  const items = [];
  for (let i = 0; i < list.length && items.length < 15; i++) {
    const row = list[i] || {};
    const title = String(row.title || row.highlight_title || "").trim();
    const url = String(row.uri || "").trim();
    if (!title || !url || !/^https?:/i.test(url)) continue;
    const item = {
      id: makeId("wallstreetcn", row.id || url),
      title,
      url,
      source: "wallstreetcn",
    };
    const summary = stripHtml(row.content_text || row.content || "").slice(0, 120);
    if (summary) item.summary = summary;
    items.push(item);
  }
  if (!items.length) throw new Error("wallstreetcn empty");
  return items;
}
