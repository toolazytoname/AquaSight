import { getJson, makeId } from "../http.js";

function yesterdayUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function fetchGitHub() {
  const day = yesterdayUTC();
  const url =
    "https://api.github.com/search/repositories?q=created:>" +
    day +
    "&sort=stars&order=desc&per_page=20";
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AquaSight/0.1",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  }
  const data = await getJson(url, { headers });
  const items = Array.isArray(data.items) ? data.items : [];
  return items
    .map((r) => {
      const title = String(r.full_name || r.name || "").trim();
      const page = r.html_url || "";
      if (!title || !page) return null;
      const item = {
        id: makeId("github", r.full_name || page),
        title,
        url: page,
        source: "github",
      };
      const summary = String(r.description || "").trim();
      if (summary) item.summary = summary;
      return item;
    })
    .filter(Boolean);
}
