import { getJson, makeId } from "../http.js";

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
      return {
        id: makeId("hn", h.objectID || url),
        title,
        url,
        source: "hn",
      };
    })
    .filter(Boolean);
}
