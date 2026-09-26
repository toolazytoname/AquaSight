import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fetchGitHubTrending,
  parseTrendingHtml,
  TRENDING_WINDOWS,
} from "../src/sources/github-trending.js";
import { fetchGitHubTrendingWeekly } from "../src/sources/github-trending-weekly.js";
import { fetchGitHub } from "../src/sources/github.js";
import {
  fetchGitHubMaintained,
  selectDiverseRepos,
  eligible,
  searchUrl,
  MAX_REQUESTS,
} from "../src/sources/github-maintained.js";
import { cluster } from "../src/cluster.js";
import { publicItem } from "../src/compat.js";
import { buildPrompt } from "../src/enrich.js";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { collectOnce } from "../src/pipeline.js";

const NOW = new Date("2026-09-26T08:00:00.000Z");

function trendingHtml(growthText, total) {
  return (
    '<article class="Box-row"><h2 class="h3 lh-condensed"><a href="/owner/repo">owner / repo</a></h2>' +
    '<p class="col-9 color-fg-muted my-1 pr-4"> A useful tool for people </p>' +
    '<div class="f6 color-fg-muted mt-2">' +
    '<a href="/owner/repo/stargazers" class="Link--muted d-inline-block mr-3"><svg></svg> ' + total + " </a>" +
    "<span>" + growthText + "</span>" +
    '<span itemprop="programmingLanguage">Rust</span>' +
    "</div></article>"
  );
}

test("weekly trending parses this-week growth and never labels it today", async () => {
  const html = trendingHtml("1,234 stars this week", "24,500");
  const rows = parseTrendingHtml(html, { window: TRENDING_WINDOWS.weekly });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].growthWindow, "week");
  assert.equal(rows[0].growthStars, 1234);
  assert.equal(rows[0].stars, 24500);

  const calls = [];
  const items = await fetchGitHubTrendingWeekly({
    now: NOW,
    fetchImpl: async (url) => {
      calls.push(String(url));
      return { ok: true, status: 200, text: async () => html };
    },
  });
  assert.equal(items.length, 1);
  assert.ok(calls[0].includes("since=weekly"));
  assert.equal(items[0].source, "github-trending-weekly");
  assert.equal(items[0].points, 1234);
  assert.match(items[0].summary, /本周 \+1234 star/);
  assert.doesNotMatch(items[0].summary, /今日/);
  assert.equal(items[0].publishedAt, undefined);
  assert.equal(items[0].githubRepo.growth.window, "week");
  assert.equal(items[0].githubRepo.growth.stars, 1234);
  assert.equal(items[0].githubRepo.language, "Rust");
  assert.equal(items[0].githubRepo.description, "A useful tool for people");
});

test("daily trending keeps today growth and githubRepo metadata", async () => {
  const html = trendingHtml("321 stars today", "9,000");
  const items = await fetchGitHubTrending({
    now: NOW,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => html }),
  });
  assert.equal(items[0].source, "github-trending");
  assert.equal(items[0].points, 321);
  assert.match(items[0].summary, /今日 \+321 star/);
  assert.equal(items[0].githubRepo.growth.window, "day");
  assert.equal(items[0].githubRepo.signal, "今日 GitHub Trending +321 star");
});

function repoJson(fullName, extra = {}) {
  return {
    full_name: fullName,
    html_url: "https://github.com/" + fullName,
    description: "A maintained library with a real description",
    stargazers_count: 4200,
    language: "TypeScript",
    pushed_at: "2026-09-20T10:00:00Z",
    created_at: "2019-01-01T00:00:00Z",
    license: { spdx_id: "MIT" },
    fork: false,
    archived: false,
    disabled: false,
    ...extra,
  };
}

function searchRes(items, incomplete = false) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ total_count: items.length, incomplete_results: incomplete, items }),
  };
}

const BUCKETS = [{ topic: "ai", minStars: 1000, pushedWithinDays: 60 }];

test("maintained source filters fork/archived/disabled/junk/empty-desc repos", async () => {
  const items = [
    repoJson("good/one"),
    repoJson("bad/fork", { fork: true }),
    repoJson("bad/archived", { archived: true }),
    repoJson("bad/disabled", { disabled: true }),
    repoJson("bad/nodesc", { description: "  " }),
    repoJson("bad/BITCOIN-WALLET-CRACKER", { description: "wallet cracker tool for cheat" }),
  ];
  const out = await fetchGitHubMaintained({
    now: NOW,
    token: "",
    buckets: BUCKETS,
    fetchImpl: async () => searchRes(items),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].title, "good/one");
  assert.equal(out[0].source, "github-maintained");
  assert.equal(out[0].githubRepo.license, "MIT");
  assert.equal(out[0].githubRepo.pushedAt, "2026-09-20T10:00:00Z");
  assert.match(out[0].githubRepo.signal, /近 60 天有提交/);
  assert.match(out[0].githubRepo.signal, /非 fork、未归档/);
  // pushed_at must not become a publication date
  assert.equal(out[0].publishedAt, undefined);
});

test("maintained source caps requests, runs sequentially, and honors rate limits", async () => {
  const urls = [];
  let done = [];
  const langs = ["TypeScript", "Rust", "Go", "Python", "Zig"];
  // stars must clear every bucket's floor (web: >=5000)
  const items = Array.from({ length: 15 }, (_, i) =>
    repoJson("owner" + i + "/r" + i, { language: langs[i % langs.length], stargazers_count: 6000 + i })
  );
  const out = await fetchGitHubMaintained({
    now: NOW,
    token: "",
    fetchImpl: async (url) => {
      urls.push(String(url));
      // no second request may start before the previous resolved
      if (done.length !== urls.length - 1) throw new Error("parallel request detected");
      const p = searchRes(items.slice());
      done.push(1);
      return p;
    },
  });
  assert.equal(urls.length, 3);
  assert.ok(urls.length <= MAX_REQUESTS);
  for (const u of urls) assert.match(u, /api\.github\.com\/search\/repositories/);
  assert.equal(out.length, 12);

  await assert.rejects(
    () =>
      fetchGitHubMaintained({
        now: NOW,
        token: "",
        buckets: BUCKETS,
        fetchImpl: async () => ({ ok: false, status: 403 }),
      }),
    /rate limited/
  );
});

test("maintained source reports incomplete_results as a warning, not silence", async () => {
  const out = await fetchGitHubMaintained({
    now: NOW,
    token: "",
    buckets: BUCKETS,
    fetchImpl: async () => searchRes([repoJson("good/one")], true),
  });
  assert.equal(out.length, 1);
  assert.ok(Array.isArray(out.warnings) && out.warnings.length === 1);
  assert.match(out.warnings[0], /incomplete_results/);
});

test("maintained source uses GITHUB_TOKEN when present, none when absent", async () => {
  const auths = [];
  const impl = (headers) =>
    async (url, opts) => {
      auths.push(opts.headers.Authorization || "");
      return searchRes([repoJson("good/one")]);
    };
  await fetchGitHubMaintained({ now: NOW, token: "tok-1", buckets: BUCKETS, fetchImpl: impl() });
  await fetchGitHubMaintained({ now: NOW, token: "", buckets: BUCKETS, fetchImpl: impl() });
  assert.equal(auths[0], "Bearer tok-1");
  assert.equal(auths[1], "");
  const url = searchUrl(BUCKETS[0], NOW);
  assert.match(url, /topic%3Aai/);
  assert.match(url, /fork%3Afalse/);
  assert.match(url, /archived%3Afalse/);
  assert.match(url, /pushed%3A%3E2026-07-28/);
});

test("diversity rules stop owner and language monopolies", () => {
  const repos = [];
  for (let i = 0; i < 8; i++) repos.push({ repo: repoJson("megacorp/tool" + i), bucket: BUCKETS[0] });
  for (let i = 0; i < 8; i++) repos.push({ repo: repoJson("other" + i + "/x" + i), bucket: BUCKETS[0] });
  const picked = selectDiverseRepos(repos, BUCKETS, { ownerCap: 2, languageCap: 5, limit: 12 });
  const owners = new Map();
  for (const { repo } of picked) {
    const o = repo.full_name.split("/")[0];
    owners.set(o, (owners.get(o) || 0) + 1);
  }
  assert.ok(Math.max(...owners.values()) <= 2, "owner cap violated");
  assert.ok(picked.some(({ repo }) => repo.full_name.startsWith("megacorp")));
  assert.ok(picked.some(({ repo }) => !repo.full_name.startsWith("megacorp")));
});

test("auto-updated index/mirror repos are excluded and ranking is not raw recency", () => {
  const repos = [
    { repo: repoJson("rust-lang/crates.io-index", { name: "crates.io-index", stargazers_count: 30000, description: "Registry index for crates.io, automatically updated" }), bucket: BUCKETS[0] },
    { repo: repoJson("example/mirror", { name: "mirror", stargazers_count: 20000, description: "Mirror of upstream packages" }), bucket: BUCKETS[0] },
    { repo: repoJson("bot/auto-notes", { stargazers_count: 9000, description: "Changelog auto-generated by CI every hour" }), bucket: BUCKETS[0] },
    // most recently pushed (listed first by sort=updated) but tiny
    { repo: repoJson("a/fresh-small", { stargazers_count: 1100 }), bucket: BUCKETS[0] },
    { repo: repoJson("b/quality-lib", { stargazers_count: 20000 }), bucket: BUCKETS[0] },
    // a legit project legitimately named "*index" with a real product
    // description must NOT be killed by the narrow rules
    { repo: repoJson("c/search-index", { name: "search-index", stargazers_count: 8000, description: "A fast local full-text search index library for apps" }), bucket: BUCKETS[0] },
  ];
  const picked = selectDiverseRepos(repos, BUCKETS, { now: NOW });
  const names = picked.map(({ repo }) => repo.full_name);
  assert.equal(names.includes("rust-lang/crates.io-index"), false);
  assert.equal(names.includes("example/mirror"), false);
  assert.equal(names.includes("bot/auto-notes"), false);
  assert.equal(names.includes("c/search-index"), true);
  // within the maintained window, quality (stars) ranks first — not the
  // most-recently-pushed entry
  assert.equal(names[0], "b/quality-lib");
  assert.ok(names.includes("a/fresh-small"));
});

test("eligible re-verifies bucket thresholds locally instead of trusting search", () => {
  const bucket = { topic: "ai", minStars: 1000, pushedWithinDays: 60 };
  const base = repoJson("a/ok");
  assert.equal(eligible(base, bucket, NOW), true);
  // below the star floor even though the API returned it
  assert.equal(eligible({ ...base, stargazers_count: 500 }, bucket, NOW), false);
  // pushed too long ago relative to now
  assert.equal(
    eligible({ ...base, pushed_at: "2026-01-01T00:00:00Z" }, bucket, NOW),
    false
  );
  // no pushed_at at all: recency cannot be proven
  assert.equal(eligible({ ...base, pushed_at: undefined }, bucket, NOW), false);
});

test("per-bucket quota round-robin keeps every bucket represented", () => {
  const langs = ["TypeScript", "Rust", "Go", "Python", "Zig"];
  const aiBucket = { topic: "ai", minStars: 1000, pushedWithinDays: 60 };
  const devBucket = { topic: "developer-tools", minStars: 3000, pushedWithinDays: 90 };
  const webBucket = { topic: "web", minStars: 5000, pushedWithinDays: 90 };
  const ai = Array.from({ length: 12 }, (_, i) => ({
    repo: repoJson("aiowner" + i + "/tool" + i, {
      language: langs[i % langs.length],
      stargazers_count: 9000 - i,
    }),
    bucket: aiBucket,
  }));
  const dev = [{ repo: repoJson("devowner/lib", { stargazers_count: 5000 }), bucket: devBucket }];
  const web = [{ repo: repoJson("webowner/app", { stargazers_count: 6000 }), bucket: webBucket }];
  const picked = selectDiverseRepos([...ai, ...dev, ...web], [aiBucket, devBucket, webBucket], { now: NOW });
  const names = picked.map(({ repo }) => repo.full_name);
  // the first bucket no longer floods the output: quota = ceil(12/3) = 4
  assert.equal(names.filter((n) => n.startsWith("aiowner")).length, 4);
  assert.ok(names.includes("devowner/lib"), "developer-tools bucket must be represented");
  assert.ok(names.includes("webowner/app"), "web bucket must be represented");
});

test("observedAt records discovery time separate from news publishedAt", async () => {
  const api = await fetchGitHubMaintained({
    now: NOW,
    token: "",
    buckets: BUCKETS,
    fetchImpl: async () => searchRes([repoJson("owner/repo")]),
  });
  const stamped = api.map((it) => ({ ...it, firstSeenAt: NOW.toISOString() }));
  const cards = cluster(stamped, { now: NOW });
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.observedAt, NOW.toISOString());
  assert.equal(card.publishedAt, undefined);
  const pub = publicItem(card);
  assert.equal(pub.observedAt, NOW.toISOString());
});

test("re-collecting the same repo keeps firstSeenAt and event id stable", async () => {
  const { createMemoryStore } = await import("../src/store/memory.js");
  const store = createMemoryStore();
  const fetchMaintained = () =>
    fetchGitHubMaintained({
      now: NOW,
      token: "",
      buckets: BUCKETS,
      fetchImpl: async () => searchRes([repoJson("owner/repo")]),
    });
  const first = await collectOnce({
    now: NOW,
    store,
    skipNotify: true,
    skipLock: true,
    enrich: false,
    sources: [["github-maintained", fetchMaintained]],
  });
  const later = new Date("2026-09-27T08:00:00.000Z");
  const second = await collectOnce({
    now: later,
    store,
    skipNotify: true,
    skipLock: true,
    enrich: false,
    sources: [["github-maintained", fetchMaintained]],
  });
  const item1 = first.items.find((it) => it.githubRepo);
  const item2 = second.items.find((it) => it.githubRepo);
  assert.ok(item1 && item2);
  assert.equal(item2.id, item1.id);
  assert.equal(item2.firstSeenAt, item1.firstSeenAt);
  assert.equal(item2.observedAt, item1.observedAt);
});

test("same repo across daily/weekly/api merges into one card with distinct windows", async () => {
  const daily = (
    await fetchGitHubTrending({
      now: NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => trendingHtml("120 stars today", "9,000"),
      }),
    })
  ).map((it) => ({ ...it, firstSeenAt: NOW.toISOString() }));
  const weekly = (
    await fetchGitHubTrendingWeekly({
      now: NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => trendingHtml("900 stars this week", "9,400"),
      }),
    })
  ).map((it) => ({ ...it, firstSeenAt: NOW.toISOString() }));
  const api = await fetchGitHubMaintained({
    now: NOW,
    token: "",
    buckets: BUCKETS,
    fetchImpl: async () => searchRes([repoJson("owner/repo")]),
  });
  const cards = cluster([...daily, ...weekly, ...api], { now: NOW });
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.githubRepo.fullName, "owner/repo");
  const windows = card.githubRepo.growth.map((g) => g.window).sort();
  assert.deepEqual(windows, ["day", "week"]);
  assert.equal(card.githubRepo.license, "MIT");
  assert.ok(card.githubRepo.stars >= 9400);
  assert.equal(card.githubRepo.signals.length, 3);
  // observedAt = collect time, travels with the repo metadata
  assert.equal(card.githubRepo.observedAt, NOW.toISOString());
  assert.equal(card.observedAt, NOW.toISOString());
  // publicItem keeps the metadata for API/static payloads and favorites
  const pub = publicItem(card);
  assert.equal(pub.githubRepo.fullName, "owner/repo");
  assert.equal(pub.githubRepo.growth.length, 2);
  assert.equal(pub.observedAt, NOW.toISOString());
});

test("HN story citing the repo keeps project metadata even when HN is primary", async () => {
  // SOURCES runs HN first; an HN story about the repo merges with the GitHub
  // sources by title. The primary member has no githubRepo — the card must
  // still carry the project metadata from its other members.
  const hn = {
    source: "hn",
    role: "article",
    url: "https://github.com/owner/project",
    title: "owner/project",
    points: 300,
    firstSeenAt: NOW.toISOString(),
  };
  const daily = (
    await fetchGitHubTrending({
      now: NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => trendingHtml("80 stars today", "5,000").replaceAll("owner/repo", "owner/project"),
      }),
    })
  ).map((it) => ({ ...it, firstSeenAt: NOW.toISOString() }));
  const weekly = (
    await fetchGitHubTrendingWeekly({
      now: NOW,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => trendingHtml("700 stars this week", "5,600").replaceAll("owner/repo", "owner/project"),
      }),
    })
  ).map((it) => ({ ...it, firstSeenAt: NOW.toISOString() }));
  const api = await fetchGitHubMaintained({
    now: NOW,
    token: "",
    buckets: BUCKETS,
    fetchImpl: async () => searchRes([repoJson("owner/project")]),
  });
  const cards = cluster([hn, ...daily, ...weekly, ...api], { now: NOW });
  assert.equal(cards.length, 1);
  const card = cards[0];
  // primary/source may be hn, but the project survives
  assert.ok(card.githubRepo && card.githubRepo.fullName === "owner/project");
  assert.deepEqual(
    card.githubRepo.growth.map((g) => g.window).sort(),
    ["day", "week"]
  );
  assert.ok(card.githubRepo.signals.some((s) => s.source === "github-maintained"));
  assert.equal(card.observedAt, NOW.toISOString());
});

test("opensource entry sorts by latest observation and drops the no-longer-observed", async () => {
  const fresh = new Date(Date.now() - 3600000).toISOString();
  const stale = new Date(Date.now() - 10 * 86400000).toISOString();
  const store = createMemoryStore();
  await store.putEvent({
    id: "evt:repo-fresh",
    title: "owner/fresh",
    source: "github-maintained",
    category: "tech",
    url: "https://github.com/owner/fresh",
    githubRepo: { fullName: "owner/fresh", observedAt: fresh },
  });
  await store.putEvent({
    id: "evt:repo-stale",
    title: "owner/stale",
    source: "github-maintained",
    category: "tech",
    url: "https://github.com/owner/stale",
    githubRepo: { fullName: "owner/stale", observedAt: stale },
  });
  await store.putEvent({
    // legacy payload: no githubRepo.observedAt → falls back to firstSeenAt
    id: "evt:repo-legacy",
    title: "owner/legacy",
    source: "github-trending",
    category: "tech",
    url: "https://github.com/owner/legacy",
    firstSeenAt: fresh,
  });
  const res = await handleApi(new Request("http://127.0.0.1/api/v1/events?view=opensource"), {
    store,
    requireAuth: false,
  });
  const data = await res.json();
  const ids = data.items.map((it) => it.id);
  assert.equal(ids.includes("evt:repo-stale"), false);
  assert.ok(ids.includes("evt:repo-fresh"));
  assert.ok(ids.includes("evt:repo-legacy"));
  // newest observation first (legacy firstSeenAt == fresh ties with repo-fresh)
  assert.equal(ids.indexOf("evt:repo-fresh") < ids.indexOf("evt:repo-legacy"), true);
});

test("github discovery source keeps created_at as the event, pushed_at as metadata", async () => {
  // fetchGitHub uses the shared http helper, so inject via global fetch —
  // no real network in unit tests.
  const orig = globalThis.fetch;
  const payload = {
    total_count: 1,
    incomplete_results: false,
    items: [
      repoJson("new/hot-thing", {
        created_at: "2026-09-24T00:00:00Z",
        pushed_at: "2026-09-25T00:00:00Z",
      }),
    ],
  };
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(payload),
  });
  try {
    const items = await fetchGitHub();
    assert.equal(items[0].publishedAt, "2026-09-24T00:00:00Z");
    assert.equal(items[0].githubRepo.pushedAt, "2026-09-25T00:00:00Z");
    assert.equal(items[0].githubRepo.description, "A maintained library with a real description");
  } finally {
    globalThis.fetch = orig;
  }
});

test("enrich prompt carries bounded repo context without inventing facts", () => {
  const prompt = buildPrompt({
    title: "owner/repo",
    summary: "A useful tool",
    githubRepo: {
      fullName: "owner/repo",
      language: "Rust",
      stars: 24500,
      description: "A useful tool for people",
      growth: [{ window: "week", stars: 1234 }],
    },
    sources: [],
  });
  assert.match(prompt, /owner\/repo/);
  assert.match(prompt, /语言 Rust/);
  assert.doesNotMatch(prompt, /24500 star/);
  assert.doesNotMatch(prompt, /本周 \+1234 star/);
  assert.match(prompt, /不得虚构/);
});

test("pipeline surfaces warnings from the real maintained-source array", async () => {
  // the source fn returns the REAL array (warnings attached to it), exactly
  // as fetchGitHubMaintained does — no hand-wrapped {items, warnings} object.
  const payload = await collectOnce({
    now: NOW,
    skipNotify: true,
    skipLock: true,
    enrich: false,
    sources: [
      [
        "github-maintained",
        () =>
          fetchGitHubMaintained({
            now: NOW,
            token: "",
            buckets: BUCKETS,
            fetchImpl: async () => searchRes([repoJson("owner/repo")], true),
          }),
      ],
    ],
  });
  const row = payload.sourceHealth.find((h) => h.source === "github-maintained");
  assert.equal(row.ok, true);
  assert.deepEqual(row.warnings, ["topic:ai incomplete_results"]);
});

test("enrich pool reserves a few repo seats without evicting digest picks", async () => {
  const { selectEnrichPool, REPO_ENRICH_SEATS } = await import("../src/pipeline.js");
  const now = new Date("2026-09-26T08:00:00.000Z");
  const items = [];
  // a full pool of news from varied outlets (SOURCE_CAP=6 per source), enough
  // high-value stories to fill the pool without any repo
  const newsSources = ["techcrunch", "verge", "ithome", "qbitai", "hn", "openai", "v2ex", "bbc"];
  for (let i = 0; i < 60; i++) {
    items.push({
      id: "evt:news" + i,
      title: "新闻 " + i + "：某公司发布重要产品",
      source: newsSources[i % newsSources.length],
      category: "tech",
      url: "https://example.com/n" + i,
      publishedAt: new Date(now.getTime() - i * 60000).toISOString(),
      value: 0.9 - i * 0.001,
      points: 100,
    });
  }
  // a LOW-value project that the news pool would otherwise crowd out
  items.push({
    id: "evt:repo-low",
    title: "owner/quiet-tool",
    source: "github-maintained",
    category: "tech",
    url: "https://github.com/owner/quiet-tool",
    firstSeenAt: now.toISOString(),
    value: 0.2,
    githubRepo: {
      fullName: "owner/quiet-tool",
      language: "Rust",
      description: "A small but useful tool",
      observedAt: now.toISOString(),
    },
  });
  // hidden project must never take a seat
  items.push({
    id: "evt:repo-hidden",
    title: "owner/blocked",
    source: "github-maintained",
    category: "hidden",
    url: "https://github.com/owner/blocked",
    firstSeenAt: now.toISOString(),
    value: 0.95,
    githubRepo: { fullName: "owner/blocked", observedAt: now.toISOString() },
  });
  // stale project (not observed for 10 days) must not take a seat
  items.push({
    id: "evt:repo-stale",
    title: "owner/old",
    source: "github-maintained",
    category: "tech",
    url: "https://github.com/owner/old",
    firstSeenAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
    value: 0.95,
    githubRepo: {
      fullName: "owner/old",
      observedAt: new Date(now.getTime() - 10 * 86400000).toISOString(),
    },
  });

  const smallPool = selectEnrichPool(items, { now, limit: 40, repoSeats: 2 });
  assert.equal(smallPool.length, 40, "total cap unchanged");
  const ids = smallPool.map((it) => it.id);
  assert.ok(ids.includes("evt:repo-low"), "low-value fresh project still gets a seat");
  assert.equal(ids.includes("evt:repo-hidden"), false);
  assert.equal(ids.includes("evt:repo-stale"), false);
  const blocked = selectEnrichPool(items, { now, limit: 40, repoSeats: 2, prefs: { blockedSources: ["github-maintained"] } });
  assert.equal(blocked.some(it => it.githubRepo), false);
  const hidden = selectEnrichPool(items, { now, limit: 40, repoSeats: 2, prefs: { hiddenEventIds: ["evt:repo-low"] } });
  assert.equal(hidden.some(it => it.id === "evt:repo-low"), false);
  // digest picks stay first and are never evicted by the seats
  const { selectDigest } = await import("../src/select.js");
  const digestIds = selectDigest(items, { now }).map((it) => it.id);
  for (const d of digestIds) assert.ok(ids.includes(d), "digest pick evicted: " + d);
  // default seat count is small so repos cannot flood the pool
  assert.equal(REPO_ENRICH_SEATS, 4);
  assert.ok(ids.filter((id) => id.startsWith("evt:repo")).length <= 2);
});

test("enrich cache key ignores star/observation drift for repo items", async () => {
  const { enrichmentCacheKey } = await import("../src/enrich.js");
  const base = {
    title: "owner/tool",
    summary: "A useful tool",
    url: "https://github.com/owner/tool",
    sources: [],
    githubRepo: {
      fullName: "owner/tool",
      language: "Rust",
      description: "A useful tool for people",
      stars: 1000,
      observedAt: "2026-09-20T00:00:00Z",
    },
  };
  const k1 = enrichmentCacheKey(base, { apiKey: "k" });
  const k2 = enrichmentCacheKey(
    {
      ...base,
      githubRepo: {
        ...base.githubRepo,
        stars: 9999,
        observedAt: "2026-09-26T23:00:00Z",
      },
    },
    { apiKey: "k" }
  );
  assert.equal(k1, k2, "star/observedAt drift must not rebuild enrichment");
  const k3 = enrichmentCacheKey(
    { ...base, githubRepo: { ...base.githubRepo, description: "Completely different purpose" } },
    { apiKey: "k" }
  );
  assert.notEqual(k1, k3, "stable context change should rebuild");
});

test("api view=opensource returns repo items with metadata", async () => {
  const store = createMemoryStore();
  const fresh = new Date(Date.now() - 3600000).toISOString();
  await store.putEvent({
    id: "evt:repo1",
    title: "owner/repo",
    source: "github-maintained",
    category: "tech",
    url: "https://github.com/owner/repo",
    firstSeenAt: fresh,
    githubRepo: {
      fullName: "owner/repo",
      language: "Rust",
      stars: 1000,
      observedAt: fresh,
      growth: [{ source: "github-trending-weekly", window: "week", stars: 80 }],
      signals: [{ source: "github-maintained", signal: "近 60 天有提交 · 1000 star" }],
    },
  });
  await store.putEvent({
    id: "evt:news",
    title: "普通新闻",
    source: "hn",
    category: "tech",
    url: "https://example.com/n",
    firstSeenAt: fresh,
  });
  const res = await handleApi(new Request("http://127.0.0.1/api/v1/events?view=opensource"), {
    store,
    requireAuth: false,
  });
  const data = await res.json();
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].id, "evt:repo1");
  assert.equal(data.items[0].githubRepo.language, "Rust");
  // source filter keeps working on the opensource view
  const filtered = await handleApi(
    new Request("http://127.0.0.1/api/v1/events?view=opensource&source=github-trending"),
    { store, requireAuth: false }
  );
  const fdata = await filtered.json();
  assert.equal(fdata.items.length, 0);
});

test("new repository search is injectable, excludes archived results, and reports partial data", async () => {
  const rows = await fetchGitHub({ now: NOW, token: '', fetchImpl: async (url, init) => {
    assert.match(decodeURIComponent(url), /fork:false archived:false/);
    assert.equal(init.headers.Authorization, undefined);
    return Response.json({ incomplete_results: true, items: [{ ...repoJson('owner/useful'), created_at: undefined }, { ...repoJson('owner/archived'), archived: true }] });
  } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].publishedAt, undefined, 'pushed_at never substitutes for creation');
  assert.deepEqual(rows.warnings, ['github incomplete_results']);
  await assert.rejects(fetchGitHub({ now: NOW, token: '', fetchImpl: async () => Response.json({}) }), /unexpected search payload/);
});

test("project cache stays stable when real trending summaries update their counters", async () => {
  const { enrichmentCacheKey } = await import('../src/enrich.js');
  const a = { title: 'owner/repo', url: 'https://github.com/owner/repo', summary: 'A useful tool（今日 +10 star）', githubRepo: { fullName: 'owner/repo', description: 'A useful tool', language: 'Rust' } };
  const b = { ...a, summary: 'A useful tool（今日 +100 star）', githubRepo: { ...a.githubRepo, stars: 1000, observedAt: new Date().toISOString() } };
  assert.equal(enrichmentCacheKey(a), enrichmentCacheKey(b));
  assert.equal(buildPrompt(a), buildPrompt(b));
});

test("open-source API respects site source blocks and public health retains partial warnings", async () => {
  const store = createMemoryStore();
  await store.putEvent({ id: 'evt:blocked-repo', title: 'owner/tool', source: 'github-maintained', category: 'tech', githubRepo: { fullName: 'owner/tool', observedAt: new Date().toISOString() } });
  await store.setPrefs({ blockedSources: ['github-maintained'] });
  const result = await handleApi(new Request('http://localhost/api/v1/events?view=opensource'), { store, requireAuth: false });
  assert.equal((await result.json()).items.length, 0);
  await store.putSourceHealth({ source: 'github-maintained', ok: true, warnings: ['incomplete_results'] });
  const health = await handleApi(new Request('http://localhost/api/v1/health'), { store, requireAuth: false });
  assert.deepEqual((await health.json()).sources[0].warnings, ['incomplete_results']);
});
