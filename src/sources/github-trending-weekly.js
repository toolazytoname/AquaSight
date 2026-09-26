import { fetchTrending } from "./github-trending.js";

/**
 * Weekly GitHub Trending (https://github.com/trending?since=weekly).
 * Growth numbers are explicitly weekly ("本周 +N star"); they must never be
 * rendered as today's growth. No publishedAt: the list is a discovery
 * signal, and a repo's age/push time is not a news publication time.
 */
export async function fetchGitHubTrendingWeekly(opts = {}) {
  return fetchTrending("weekly", {
    ...opts,
    source: "github-trending-weekly",
    kind: "repo-trending-weekly",
  });
}
