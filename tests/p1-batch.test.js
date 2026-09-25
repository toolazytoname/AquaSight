import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTrendingHtml, fetchGitHubTrending } from "../src/sources/github-trending.js";
import { fallbackBodyFromSources, extractFeaturedBodies } from "../src/pipeline.js";
import { notifySourceOutage } from "../src/notify.js";
import { cluster } from "../src/cluster.js";
import { createMemoryStore } from "../src/store/memory.js";
import { createD1Store } from "../src/store/d1.js";
import { createFakeD1 } from "./helpers/fake-d1.js";
import { handleApi } from "../src/api/handlers.js";

const TRENDING_HTML = `
<main>
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/owner/great-lib" data-view-component="true">owner / great-lib</a></h2>
  <p class="col-9 color-fg-muted my-1 pr-4"> A genuinely useful library &amp; tools </p>
  <div class="f6 color-fg-muted mt-2">
    <span itemprop="programmingLanguage">Rust</span>
    <a class="Link--muted d-inline-block mr-3" href="/owner/great-lib/stargazers"><svg></svg>1,234</a>
    <span class="d-inline-block float-sm-right">962 stars today</span>
  </div>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/evil/BITCOIN-WALLET-CRACKER">evil / BITCOIN-WALLET-CRACKER</a></h2>
  <p class="col-9 color-fg-muted my-1 pr-4">crack wallets</p>
</article>
<article class="Box-row">
  <h2 class="h3 lh-condensed"><a href="/owner/second-lib">owner / second-lib</a></h2>
</article>
<article class="not-a-row">
  <h2><a href="/owner/ignored">should not parse</a></h2>
</article>
</main>`;

test("github-trending parses rows, drops junk, reads stars", async () => {
  const rows = parseTrendingHtml(TRENDING_HTML);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].fullName, "owner/great-lib");
  assert.equal(rows[0].desc, "A genuinely useful library & tools");
  assert.equal(rows[0].starsToday, 962);
  assert.equal(rows[0].stars, 1234);
  assert.equal(rows[0].lang, "Rust");
  assert.ok(!rows.some((r) => r.fullName.includes("WALLET")));
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    text: async () => TRENDING_HTML,
  });
  try {
    const items = await fetchGitHubTrending();
    assert.equal(items.length, 2);
    assert.equal(items[0].source, "github-trending");
    assert.equal(items[0].url, "https://github.com/owner/great-lib");
    assert.ok(items[0].summary.includes("今日 +962 star"));
    assert.ok(items[0].id && items[0].articleId);
  } finally {
    globalThis.fetch = orig;
  }
});

test("github-trending fails loudly when nothing parses", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "text/html" },
    text: async () => "<html><body>login wall</body></html>",
  });
  try {
    await assert.rejects(() => fetchGitHubTrending(), /no rows parsed/);
  } finally {
    globalThis.fetch = orig;
  }
});

test("cluster keeps clamped member summaries on sources", () => {
  const events = [
    {
      id: "a1",
      articleId: "a1",
      title: "Same story",
      url: "https://s1.example/x",
      source: "hn",
      publishedAt: new Date().toISOString(),
      summary: "长".repeat(400),
    },
    {
      id: "a2",
      articleId: "a2",
      title: "Same story",
      url: "https://s2.example/y",
      source: "verge",
      publishedAt: new Date().toISOString(),
      summary: "short member summary",
    },
  ];
  const [card] = cluster(events);
  const withSummary = card.sources.find((s) => s.source === "hn");
  assert.equal(withSummary.summary.length, 280);
  const short = card.sources.find((s) => s.source === "verge");
  assert.equal(short.summary, "short member summary");
});

test("extractFeaturedBodies falls back to member material when fetch fails", async () => {
  const ev = {
    id: "e1",
    title: "Body-less event",
    summary: "too short",
    url: "https://blocked.example/story",
    sources: [
      { source: "hn", title: "Headline one", summary: "Member summary one is fairly informative." },
      { source: "verge", title: "Headline two" },
    ],
  };
  const orig = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("fetch failed");
  };
  try {
    const [out] = await extractFeaturedBodies([ev]);
    assert.ok(out.body);
    assert.ok(out.body.includes("Headline one：Member summary one"));
    assert.ok(out.body.includes("Headline two"));
    // fallback material itself is the floor: thin events stay empty
    const [thin] = await extractFeaturedBodies([
      { id: "e2", title: "Thin", url: "https://x.example/1", sources: [{ title: "t" }] },
    ]);
    assert.equal(thin.body, undefined);
  } finally {
    globalThis.fetch = orig;
  }
});

test("body fetching is bounded to four requests and preserves story order", async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let peak = 0;
  globalThis.fetch = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return new Response("<article><p>Enough original article text for extraction and model input.</p></article>", { status: 200 });
  };
  try {
    const stories = Array.from({ length: 9 }, (_, i) => ({ id: String(i), title: "Story " + i, url: "https://example.com/" + i }));
    const result = await extractFeaturedBodies(stories);
    assert.deepEqual(result.map((it) => it.id), stories.map((it) => it.id));
    assert.equal(peak, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fallbackBodyFromSources ignores junk input", () => {
  assert.equal(fallbackBodyFromSources(null), "");
  assert.equal(fallbackBodyFromSources({ sources: [] }), "");
  assert.equal(fallbackBodyFromSources({ sources: [{ title: "x" }] }), "");
});

test("notifySourceOutage alerts on consecutive-failure streaks with daily dedup", async () => {
  const mk = (num) => "/tmp/aquasight-test-outage-" + num + ".json";
  const { rm } = await import("node:fs/promises");
  await rm(mk(1), { force: true });
  const posts = [];
  const fetchImpl = async (url, init) => {
    posts.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => ({ code: 200 }) };
  };
  const health = [
    { source: "qbitai", ok: false, failStreak: 4 },
    { source: "bbc", ok: false, failStreak: 1 },
    { source: "hn", ok: true, failStreak: 0 },
  ];
  // 1 failure in round: below round threshold, but qbitai streak >= 3 fires.
  const first = await notifySourceOutage([{ source: "qbitai" }], {
    key: "k",
    fetchImpl,
    markerPath: mk(1),
    health,
    now: new Date(),
  });
  assert.equal(first.sent, true);
  assert.match(posts[0].body.body, /qbitai 已连续 4 轮失败/);
  assert.doesNotMatch(posts[0].body.body, /bbc/);
  // Same day: streak already alerted, no round hit → deduped.
  const second = await notifySourceOutage([{ source: "qbitai" }], {
    key: "k",
    fetchImpl,
    markerPath: mk(1),
    health,
    now: new Date(),
  });
  assert.equal(second.sent, false);
  assert.equal(second.reason, "deduped");
  // Same day: one-push-per-day — even a 5-source round is absorbed by the dedup.
  const errs = ["a", "b", "c", "d", "qbitai"].map((s) => ({ source: s }));
  const third = await notifySourceOutage(errs, {
    key: "k",
    fetchImpl,
    markerPath: mk(1),
    health,
    now: new Date(),
  });
  assert.equal(third.sent, false);
  assert.equal(third.reason, "deduped");
  assert.equal(posts.length, 1);
  // Next Beijing day: the round threshold fires again with the full list.
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
  const fourth = await notifySourceOutage(errs, {
    key: "k",
    fetchImpl,
    markerPath: mk(1),
    health,
    now: tomorrow,
  });
  assert.equal(fourth.sent, true);
  assert.match(posts[1].body.body, /共 5 个源本轮失败/);
  await rm(mk(1), { force: true });
});

test("d1 listEvents recency window matches full-scan selection and countEvents agrees", async () => {
  const db = createFakeD1();
  const store = createD1Store(db);
  const base = Date.now() - 1000 * 3600 * 24 * 10;
  for (let i = 0; i < 60; i++) {
    await store.putEvent({
      id: "ev" + i,
      title: "Event " + i,
      source: "hn",
      category: "tech",
      publishedAt: new Date(base + i * 3600 * 1000).toISOString(),
    });
  }
  assert.equal(await store.countEvents(), 60);
  const windowed = await store.listEvents({ order: "recency", limit: 10 });
  assert.equal(windowed.length, 10);
  assert.equal(windowed[0].id, "ev59");
  assert.equal(windowed[9].id, "ev50");
  const full = await store.listEvents();
  const byRecency = [...full].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt)
  );
  assert.deepEqual(
    windowed.map((it) => it.id),
    byRecency.slice(0, 10).map((it) => it.id)
  );
});

test("memory listEvents supports the same recency window", async () => {
  const store = createMemoryStore();
  const base = Date.now() - 1000 * 3600 * 24 * 5;
  for (let i = 0; i < 20; i++) {
    await store.putEvent({
      id: "m" + i,
      title: "M " + i,
      source: "hn",
      category: "tech",
      publishedAt: new Date(base + i * 60000).toISOString(),
    });
  }
  assert.equal(await store.countEvents(), 20);
  const windowed = await store.listEvents({ order: "recency", limit: 5 });
  assert.deepEqual(
    windowed.map((it) => it.id),
    ["m19", "m18", "m17", "m16", "m15"]
  );
});

test("latest view reports windowed when the table outgrows the window", async () => {
  const store = createMemoryStore();
  const base = Date.now() - 1000 * 3600 * 24 * 40;
  for (let i = 0; i < 500; i++) {
    await store.putEvent({
      id: "w" + i,
      title: "W " + i,
      source: i % 2 ? "hn" : "bbc",
      category: i % 2 ? "tech" : "public",
      publishedAt: new Date(base + i * 60000).toISOString(),
    });
  }
  const env = { store, requireAuth: false };
  const res = await handleApi(
    new Request("http://127.0.0.1/api/v1/events?view=latest&limit=5"),
    env
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.windowed, true);
  assert.equal(body.total, 480);
  assert.equal(body.items[0].id, "w499");
  // Featured view stays on the full scan: no windowed flag.
  const res2 = await handleApi(
    new Request("http://127.0.0.1/api/v1/events?view=featured&limit=5"),
    env
  );
  const body2 = await res2.json();
  assert.equal(body2.windowed, false);
});

test("export → wipe → import-backup roundtrip restores identical events", async () => {
  const db = createFakeD1();
  const store = createD1Store(db);
  for (let i = 0; i < 5; i++) {
    await store.putEvent({ id: "rt" + i, title: "RT " + i, source: "hn", category: "tech" });
    await store.setMembers("rt" + i, ["a" + i]);
    await store.putArticle({ id: "a" + i, articleId: "a" + i, title: "A " + i, source: "hn", url: "https://x/" + i });
  }
  const env = { store, requireAuth: false };
  const exportRes = await handleApi(new Request("http://127.0.0.1/api/v1/export"), env);
  assert.equal(exportRes.status, 200);
  const backup = await exportRes.json();
  // Wipe via importAll with an empty payload (the destructive step of the drill).
  await store.importAll({
    events: [],
    articles: [],
    members: [],
    articleEvent: [],
    prefs: {},
    feedback: [],
    reads: [],
    favorites: [],
    cache: [],
    notifications: [],
    tasks: [],
    sourceHealth: [],
    snapshots: [],
  });
  assert.equal(await store.countEvents(), 0);
  const importRes = await handleApi(
    new Request("http://127.0.0.1/api/v1/import-backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(backup),
    }),
    env
  );
  assert.equal(importRes.status, 200);
  assert.equal(await store.countEvents(), 5);
  const restored = await store.listEvents();
  assert.deepEqual(
    restored.map((it) => it.id).sort(),
    ["rt0", "rt1", "rt2", "rt3", "rt4"]
  );
  assert.deepEqual(await store.getMembers("rt3"), ["a3"]);
});

test("aiStateForReason maps budget gates to queued, dispatch errors to failed", async () => {
  const { aiStateForReason } = await import("../src/enrich.js");
  for (const r of [
    "BUDGET_CANDIDATES",
    "BUDGET_PRICING",
    "BUDGET_MONTH",
    "BUDGET_DAY",
    "candidate-cap",
    "pricing-missing",
    "no-credential",
    "budget",
  ]) {
    assert.equal(aiStateForReason(r), "queued", r);
  }
  for (const r of ["http-429", "invalid:not-object", "parse", "BUDGET_TYP0"]) {
    assert.equal(aiStateForReason(r), "failed", r);
  }
});

test("digest summary survives an exhausted candidate cap; item enrich still gated", async () => {
  const { createBudget, DAILY_CANDIDATE_CAP } = await import("../src/budget.js");
  const { summarizeDigest, enrichOne } = await import("../src/enrich.js");
  const pricing = { usdPerMtokIn: 1, usdPerMtokOut: 2 };
  const budget = createBudget(
    { dayCandidates: DAILY_CANDIDATE_CAP, daySpent: 0, monthSpent: 0 },
    new Date(),
    { pricing }
  );
  const entries = [{ titleZh: "一" }, { titleZh: "二" }, { titleZh: "三" }];
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "今天最重要的一条综述。" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
  });
  const summ = await summarizeDigest(entries, {
    apiKey: "k",
    budget,
    fetchImpl,
    usdPerMtokIn: 1,
    usdPerMtokOut: 2,
  });
  assert.equal(summ.text, "今天最重要的一条综述。");
  // Item enrichment at the same cap is still refused.
  const item = { id: "x", title: "t", sources: [] };
  const one = await enrichOne(item, {
    apiKey: "k",
    budget,
    fetchImpl,
    usdPerMtokIn: 1,
    usdPerMtokOut: 2,
  });
  assert.equal(one.fallbackReason, "BUDGET_CANDIDATES");
});

test("huggingface model junk (uncensored/abliterated) is filtered before items", async () => {
  const { fetchHuggingFace, isHfJunk } = await import("../src/sources/huggingface.js");
  assert.equal(isHfJunk("foo/Uncensored-GGUF", "", ""), true);
  assert.equal(isHfJunk("foo/qwen-abliterated", "text-generation", ""), true);
  assert.equal(isHfJunk("foo/Qwen2.5-7B", "text-generation", ""), false);
  const orig = globalThis.fetch;
  let modelsCalled = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("daily_papers")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        text: async () => "[]",
      };
    }
    modelsCalled++;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      text: async () =>
        JSON.stringify([
          { id: "org/Qwen3-8B", likes: 100, pipeline_tag: "text-generation", downloads: 5000 },
          { id: "org/Llama-UNCENSORED-GGUF", likes: 200, pipeline_tag: "text-generation" },
          { id: "org/x-abliterated", likes: 50, downloads: 10 },
        ]),
    };
  };
  try {
    const items = await fetchHuggingFace();
    const ids = items.map((it) => it.title);
    assert.equal(modelsCalled, 1);
    assert.deepEqual(ids, ["org/Qwen3-8B · Hugging Face 本周热门模型"]);
  } finally {
    globalThis.fetch = orig;
  }
});

test("same 36kr link via 36kr and 36kr-flash counts as one media, two articles", async () => {
  const { countCoverage, mediaKey } = await import("../web/rules.js");
  assert.equal(mediaKey("36kr-flash"), "36kr");
  assert.equal(mediaKey("techcrunch"), "techcrunch");
  const cov = countCoverage([
    { source: "36kr", url: "https://36kr.com/p/123" },
    { source: "36kr-flash", url: "https://36kr.com/p/123" },
    { source: "theverge", url: "https://www.theverge.com/x" },
  ]);
  assert.equal(cov.articles, 3);
  assert.equal(cov.media, 2);
  assert.equal(cov.origins, 2);
});

test("digest date line is Beijing-based under Shanghai, LA, and UTC timezones", async () => {
  const { digestDateLine } = await import("../web/rules.js");
  const expected = { showDate: "9月23日", weekday: "星期三" };
  for (const tz of ["Asia/Shanghai", "America/Los_Angeles", "UTC", "Pacific/Kiritimati"]) {
    process.env.TZ = tz;
    const line = digestDateLine("2026-09-23");
    assert.deepEqual(line, expected, tz);
  }
  delete process.env.TZ;
  // A Beijing Monday rendered from a device still in Sunday (LA) keeps Monday.
  process.env.TZ = "America/Los_Angeles";
  assert.equal(digestDateLine("2026-09-21").weekday, "星期一");
  delete process.env.TZ;
  assert.deepEqual(digestDateLine("not-a-date"), { showDate: "", weekday: "" });
});

test("lead qualifies only with Chinese title, substance and freshness", async () => {
  const { leadQualifies, pickLead } = await import("../web/rules.js");
  const now = Date.now();
  const hour = 3600 * 1000;
  const good = {
    titleZh: "中文标题",
    title: "English Title",
    overviewZh: "足够长的中文概述，超过六十个字符，确保这条内容真的有可读的实质材料而不是只有标题。" + "细节".repeat(10),
    publishedAt: new Date(now - 3 * hour).toISOString(),
    sources: [{ source: "hn", url: "https://a.example/1" }],
  };
  assert.equal(leadQualifies(good, now), true);
  assert.equal(leadQualifies({ ...good, titleZh: "" }, now), false, "no Chinese title");
  assert.equal(leadQualifies({ ...good, overviewZh: "太短" }, now), false, "no substance");
  assert.equal(leadQualifies({ ...good, publishedAt: new Date(now - 72 * hour).toISOString() }, now), false, "stale");
  assert.equal(pickLead([{ title: "junk-first" }, good], now), good, "junk first item is skipped");
  assert.equal(pickLead([{ title: "junk" }], now), null, "no qualifying item means no lead");
  // Among qualifiers, wider coverage wins regardless of position.
  const wide = { ...good, sources: [
    { source: "hn", url: "https://a.example/1" },
    { source: "verge", url: "https://b.example/2" },
  ] };
  assert.equal(pickLead([good, wide], now), wide);
});

test("orderEnrichPool puts featured-bound items first", async () => {
  const { orderEnrichPool } = await import("../src/pipeline.js");
  const items = [
    { id: "a", title: "A", source: "hn", category: "tech", value: 2, score: 2 },
    { id: "b", title: "B", source: "verge", category: "tech", value: 9, score: 9 },
    { id: "c", title: "C", source: "36kr", category: "business", value: 5, score: 5 },
  ];
  const ordered = orderEnrichPool(items, items, {});
  const featuredFirst = ordered.findIndex((it) => it.id === "b");
  assert.ok(featuredFirst < ordered.findIndex((it) => it.id === "a"), "featured item enriches before tail");
});

test("enrichment pool covers every digest and featured story before the long tail", async () => {
  const { selectEnrichPool } = await import("../src/pipeline.js");
  const { selectDigest, selectFeatured } = await import("../src/select.js");
  const now = new Date("2026-09-25T12:00:00Z");
  const sources = ["hn", "verge", "techcrunch", "openai", "36kr", "wallstreetcn", "bbc", "ithome"];
  const items = Array.from({ length: 80 }, (_, i) => ({
    id: String(i), title: "模型发布 " + i, category: i % 6 === 0 ? "business" : "tech",
    source: sources[i % sources.length], publishedAt: new Date(now.getTime() - (i % 30) * 3600000).toISOString(),
    subject: "subject-" + i,
  }));
  const wanted = new Set([...selectDigest(items, { now }), ...selectFeatured(items, { now })].map((it) => it.id));
  const pool = selectEnrichPool(items, { now, limit: 40 });
  assert.ok(pool.length <= 40);
  for (const id of wanted) assert.ok(pool.some((it) => it.id === id), "missing visible item " + id);
});
