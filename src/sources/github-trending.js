import { articleId } from "../identity.js";
import { stripHtml } from "../html.js";
import { GITHUB_JUNK_RE } from "./github.js";

const TRENDING_URL = "https://github.com/trending";

function parseCount(text) {
  const n = String(text || "").replace(/[\s,]/g, "");
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

// Growth-window descriptors for github.com/trending. `since=daily` (default)
// reports "N stars today"; `since=weekly` reports "N stars this week". The
// window label must travel with the number so weekly growth is never shown
// as today's growth.
export const TRENDING_WINDOWS = {
  daily: {
    since: "daily",
    growthRe: /([\d,]+)\s+stars?\s+today/i,
    window: "day",
    label: "今日",
    summaryLabel: "今日 +",
  },
  weekly: {
    since: "weekly",
    growthRe: /([\d,]+)\s+stars?\s+this\s+week/i,
    window: "week",
    label: "本周",
    summaryLabel: "本周 +",
  },
};

// Keyless HTML scrape of github.com/trending. The markup has been stable for
// years (article.Box-row > h2 a[href="/owner/repo"]); anything unfamiliar is
// skipped rather than guessed at, and an empty parse fails the source loudly.
export function parseTrendingHtml(html, opts = {}) {
  const win = opts.window || TRENDING_WINDOWS.daily;
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
    const starsMatch = block.match(win.growthRe);
    const growthStars = parseCount(starsMatch ? starsMatch[1] : "");
    const totalStarsMatch = block.match(/stargazers"[\s\S]*?<\/svg>\s*([\d,]+)\s*<\/a>/i);
    const stars = parseCount(totalStarsMatch ? totalStarsMatch[1] : "");
    const langMatch = block.match(/<span[^>]*itemprop="programmingLanguage">([^<]+)<\/span>/i);
    const lang = langMatch ? langMatch[1].trim() : "";
    out.push({
      fullName,
      desc,
      growthStars,
      growthWindow: win.window,
      growthLabel: win.label,
      // Window-specific aliases kept for callers/tests of the daily feed.
      starsToday: win.window === "day" ? growthStars : undefined,
      starsThisWeek: win.window === "week" ? growthStars : undefined,
      stars,
      lang,
    });
  }
  return out;
}

function summaryOf(row, win) {
  const bits = [];
  if (row.desc) bits.push(row.desc);
  const meta = [];
  if (row.lang) meta.push(row.lang);
  if (row.growthStars) meta.push(win.summaryLabel + row.growthStars + " star");
  else if (row.stars) meta.push(row.stars + " star");
  if (meta.length) bits.push("（" + meta.join(" · ") + "）");
  return bits.join(" ").slice(0, 280);
}

export function trendingItems(rows, { source, kind, window: win, now }) {
  const observedAt = (now instanceof Date ? now : new Date(now || Date.now())).toISOString();
  return rows.map((row) => {
    const item = {
      title: row.fullName,
      url: "https://github.com/" + row.fullName,
      source,
      role: "opensource",
      kind,
      externalId: row.fullName,
    };
    // No publishedAt: trending is a "now" signal, mirroring the HF models rule.
    if (row.stars) item.stars = row.stars;
    if (row.growthStars) item.points = row.growthStars;
    const summary = summaryOf(row, win);
    if (summary) item.summary = summary;
    const repo = {
      fullName: row.fullName,
      observedAt,
      growth: { window: row.growthWindow, stars: row.growthStars },
      signal: row.growthStars ? win.label + " GitHub Trending +" + row.growthStars + " star" : win.label + " GitHub Trending 上榜",
    };
    if (row.desc) repo.description = row.desc;
    if (row.lang) repo.language = row.lang;
    if (row.stars) repo.stars = row.stars;
    item.githubRepo = repo;
    item.id = articleId(item);
    item.articleId = item.id;
    return item;
  });
}

export async function fetchTrending(windowKey, opts = {}) {
  const now = opts.now || new Date();
  const win = TRENDING_WINDOWS[windowKey] || TRENDING_WINDOWS.daily;
  const url = TRENDING_URL + "?since=" + win.since;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(url, {
    headers: { "User-Agent": "AquaSight/0.2", Accept: "text/html" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 12000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  const rows = parseTrendingHtml(text, { window: win });
  if (!rows.length) throw new Error("github-trending(" + win.since + "): no rows parsed");
  return trendingItems(rows, {
    source: opts.source,
    kind: opts.kind,
    window: win,
    now,
  }).slice(0, opts.limit || 15);
}

export async function fetchGitHubTrending(opts = {}) {
  return fetchTrending("daily", { ...opts, source: "github-trending", kind: "repo-trending" });
}
