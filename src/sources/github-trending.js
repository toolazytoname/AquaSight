import { getText } from "../http.js";
import { articleId } from "../identity.js";
import { stripHtml } from "../html.js";
import { GITHUB_JUNK_RE } from "./github.js";

const TRENDING_URL = "https://github.com/trending";

function parseCount(text) {
  const n = String(text || "").replace(/[\s,]/g, "");
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

// Keyless HTML scrape of github.com/trending. The markup has been stable for
// years (article.Box-row > h2 a[href="/owner/repo"]); anything unfamiliar is
// skipped rather than guessed at, and an empty parse fails the source loudly.
export function parseTrendingHtml(html) {
  const out = [];
  const blocks = String(html || "").split(/<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>/i);
  for (const block of blocks.slice(1)) {
    const link = block.match(/<h2[^>]*>[\s\S]*?<a[^>]+href="\/([^"\/]+\/[^"\/]+)"/i);
    if (!link) continue;
    const fullName = link[1];
    if (!fullName || fullName.includes("#")) continue;
    if (GITHUB_JUNK_RE.test(fullName)) continue;
    const descMatch = block.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const desc = stripHtml(descMatch ? descMatch[1] : "").trim();
    if (desc && GITHUB_JUNK_RE.test(desc)) continue;
    const starsMatch = block.match(/([\d,]+)\s+stars?\s+today/i);
    const starsToday = parseCount(starsMatch ? starsMatch[1] : "");
    const totalStarsMatch = block.match(/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/i);
    const stars = parseCount(totalStarsMatch ? totalStarsMatch[1] : "");
    const langMatch = block.match(/<span[^>]*itemprop="programmingLanguage">([^<]+)<\/span>/i);
    const lang = langMatch ? langMatch[1].trim() : "";
    out.push({
      fullName,
      desc,
      starsToday,
      stars,
      lang,
    });
  }
  return out;
}

function summaryOf(row) {
  const bits = [];
  if (row.desc) bits.push(row.desc);
  const meta = [];
  if (row.lang) meta.push(row.lang);
  if (row.starsToday) meta.push("今日 +" + row.starsToday + " star");
  else if (row.stars) meta.push(row.stars + " star");
  if (meta.length) bits.push("（" + meta.join(" · ") + "）");
  return bits.join(" ").slice(0, 280);
}

export async function fetchGitHubTrending() {
  const { text } = await getText(TRENDING_URL, {
    headers: { "User-Agent": "AquaSight/0.2", Accept: "text/html" },
    timeoutMs: 12000,
  });
  const rows = parseTrendingHtml(text);
  if (!rows.length) throw new Error("github-trending: no rows parsed");
  return rows.slice(0, 15).map((row) => {
    const item = {
      title: row.fullName,
      url: "https://github.com/" + row.fullName,
      source: "github-trending",
      role: "opensource",
      kind: "repo-trending",
      externalId: row.fullName,
    };
    // No publishedAt: trending is a "now" signal, mirroring the HF models rule.
    if (row.stars) item.stars = row.stars;
    if (row.starsToday) item.points = row.starsToday;
    const summary = summaryOf(row);
    if (summary) item.summary = summary;
    item.id = articleId(item);
    item.articleId = item.id;
    return item;
  });
}
