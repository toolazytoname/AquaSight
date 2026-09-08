import { getJson } from "../http.js";
import { stripHtml } from "../html.js";
import { articleId } from "../identity.js";

function usableSummary(raw) {
  const cleaned = stripHtml(String(raw || ""))
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 12) return "";
  if (/^https?:\/\//i.test(cleaned)) return "";
  return cleaned;
}

export async function fetchHN() {
  const data = await getJson(
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=20"
  );
  const hits = Array.isArray(data.hits) ? data.hits : [];
  return hits
    .map((h) => {
      const title = String(h.title || "").trim();
      const storyUrl = h.url || "";
      const discussionUrl = h.objectID
        ? "https://news.ycombinator.com/item?id=" + h.objectID
        : "";
      const url = storyUrl || discussionUrl;
      if (!title || !url) return null;
      const item = {
        title,
        url,
        source: "hn",
        role: "article",
        externalId: String(h.objectID || url),
        discussionUrl,
        points: Number.isFinite(h.points) ? h.points : undefined,
        comments: Number.isFinite(h.num_comments) ? h.num_comments : undefined,
      };
      if (storyUrl && discussionUrl && storyUrl !== discussionUrl) {
        item.storyUrl = storyUrl;
      }
      item.id = articleId(item);
      item.articleId = item.id;
      const summary = usableSummary(h.story_text || "");
      if (summary) item.summary = summary;
      if (h.created_at) item.publishedAt = h.created_at;
      return item;
    })
    .filter(Boolean);
}
