import { getJson } from "../http.js";
import { articleId } from "../identity.js";
import { stripHtml } from "../html.js";

export const GITHUB_JUNK_RE =
  /jailbreak|cracker|botnet|cheat|hack[-_ ]?tool|wallet[-_ ]?crack|exploit|auto[-_ ]?farm|infinite[-_ ]?cash|poc\b/i;

function weekAgoUTC(now = new Date()) {
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

export function isGithubJunk(repo) {
  const blob = [repo.full_name, repo.name, repo.description]
    .map((x) => String(x || ""))
    .join(" ");
  return GITHUB_JUNK_RE.test(blob);
}

export async function fetchGitHub(opts = {}) {
  const now = opts.now || new Date();
  const observedAt = now.toISOString();
  const day = weekAgoUTC(now);
  const q = "stars:>=20 fork:false archived:false created:>" + day;
  const url =
    "https://api.github.com/search/repositories?q=" +
    encodeURIComponent(q) +
    "&sort=stars&order=desc&per_page=20";
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "AquaSight/0.2",
  };
  const token = opts.token ?? process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = "Bearer " + token;
  }
  const data = await getJson(url, { headers, fetchImpl: opts.fetchImpl, timeoutMs: opts.timeoutMs ?? 12000 });
  if (!data || !Array.isArray(data.items)) throw new Error("github: unexpected search payload");
  const items = data.items;
  const result = items
    .filter((r) => r && !r.fork && !r.archived && !r.disabled && String(r.description || "").trim() && !isGithubJunk(r))
    .map((r) => {
      const title = String(r.full_name || r.name || "").trim();
      const page = r.html_url || "";
      if (!title || !page) return null;
      const item = {
        title,
        url: page,
        source: "github",
        role: "opensource",
        kind: "opensource-discovery",
        externalId: String(r.full_name || page),
        stars: Number(r.stargazers_count) || undefined,
      };
      const repo = { fullName: title, observedAt };
      if (r.description) repo.description = stripHtml(String(r.description)).trim();
      if (r.language) repo.language = r.language;
      if (Number.isFinite(r.stargazers_count)) repo.stars = r.stargazers_count;
      // pushed_at is repo activity, not a publication date; it stays in
      // githubRepo so the UI can show "最近维护" without faking news timing.
      if (r.pushed_at) repo.pushedAt = r.pushed_at;
      const spdx =
        r.license && r.license.spdx_id && r.license.spdx_id !== "NOASSERTION"
          ? r.license.spdx_id
          : "";
      if (spdx) repo.license = spdx;
      repo.signal = "新建仓库（近 7 天）· " + (r.stargazers_count || 0) + " star";
      item.githubRepo = repo;
      item.id = articleId(item);
      item.articleId = item.id;
      const summary = stripHtml(String(r.description || "")).trim();
      if (summary) item.summary = summary;
      // Creation time is distinct from repository activity.
      if (r.created_at) item.publishedAt = r.created_at;

      return item;
    })
    .filter(Boolean);
  if (data.incomplete_results) result.warnings = ["github incomplete_results"];
  return result;
}
