import { getJson, makeId } from "../http.js";
import { stripHtml } from "../rss.js";

export async function fetchV2ex() {
  const data = await getJson("https://www.v2ex.com/api/topics/hot.json", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });
  const list = Array.isArray(data) ? data : [];
  const items = [];
  for (let i = 0; i < list.length && items.length < 15; i++) {
    const row = list[i] || {};
    const title = String(row.title || "").trim();
    const url = String(row.url || "").trim();
    if (!title || !url || !/^https?:/i.test(url)) continue;
    const item = {
      id: makeId("v2ex", row.id || url),
      title,
      url,
      source: "v2ex",
    };
    const summary = stripHtml(row.content || row.content_rendered || "").slice(0, 120);
    if (summary) item.summary = summary;
    if (Number.isFinite(row.created)) {
      item.publishedAt = new Date(row.created * 1000).toISOString();
    }
    items.push(item);
  }
  if (!items.length) throw new Error("v2ex empty");
  return items;
}
