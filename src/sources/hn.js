import { getJson, makeId } from "../http.js";
import { stripHtml } from "../rss.js";

function usableSummary(raw) {
  const cleaned = stripHtml(String(raw || ""))
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 12) return "";
  if (/^https?:\/\//i.test(cleaned)) return "";
  return cleaned.slice(0, 200);
}

export async function fetchHN() {
  const data = await getJson(
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20"
  );
  const hits = Array.isArray(data.hits) ? data.hits : [];
  return hits
    .map((h) => {
      const title = String(h.title || "").trim();
      const url =
        h.url ||
        (h.objectID
          ? "https://news.ycombinator.com/item?id=" + h.objectID
          : "");
      if (!title || !url) return null;
      const item = {
        id: makeId("hn", h.objectID || url),
        title,
        url,
        source: "hn",
      };
      const summary = usableSummary(h.story_text || "");
      if (summary) item.summary = summary;
      if (h.created_at) item.publishedAt = h.created_at;
      return item;
    })
    .filter(Boolean);
}
