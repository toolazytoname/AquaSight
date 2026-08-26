import { getJson, makeId } from "../http.js";

export const GITHUB_JUNK_RE =
  /jailbreak|cracker|botnet|cheat|hack[-_ ]?tool|wallet[-_ ]?crack|exploit|auto[-_ ]?farm|infinite[-_ ]?cash|poc\b/i;

function weekAgoUTC() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function isGithubJunk(repo) {
  const blob = [repo.full_name, repo.name, repo.description]
    .map((x) => String(x || ""))
    .join(" ");
  return GITHUB_JUNK_RE.test(blob);
}

export async function fetchGitHub() {
  const day = weekAgoUTC();
  const q = "stars:>=20 created:>" + day;
  const url =
    "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(q) +
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
    .filter((r) => r && !isGithubJunk(r))
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
      if (r.created_at) item.publishedAt = r.created_at;
      return item;
    })
    .filter(Boolean);
}
