import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  parsePersonalFeed,
  discoverFeedLinks,
  mergeFeedItems,
  personalFeedId,
  personalFeedItemId,
  fetchPersonalFeed,
  NotAFeedError,
  AIHOT_FEED_URL,
  isAihotFeed,
} from "../src/personal-feeds.js";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";

// ---- fixtures ----

const RSS_FULL = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Example Feed &amp; <script>alert(1)</script></title>
<item><title>First</title><link>https://ex.example/one</link><guid>one</guid>
<pubDate>Wed, 01 Oct 2026 08:00:00 GMT</pubDate><description>hello &lt;b&gt;world&lt;/b&gt;</description></item>
<item><title>Second</title><link>https://ex.example/two</link><guid>two</guid>
<pubDate>Wed, 01 Oct 2026 09:00:00 GMT</pubDate></item>
</channel></rss>`;

const RSS_EMPTY = `<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`;

const ATOM_RELATIVE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Feed</title>
<entry><title>Rel</title><link href="/posts/1" /><id>urn:1</id>
<published>2026-10-01T10:00:00Z</published></entry>
</feed>`;

const HTML_PAGE = `<!doctype html><html><head>
<link rel="alternate" type="application/rss+xml" href="/feed.xml" title="Feed">
</head><body>hello</body></html>`;

function rssResponse(body, type = "application/rss+xml") {
  return new Response(body, { status: 200, headers: { "content-type": type } });
}

const LOOKUP_OK = async () => [{ address: "93.184.216.34" }];

// ---- parser ----

test("parsePersonalFeed: rss items, plain-text title (xss stripped), dates", () => {
  const feed = parsePersonalFeed(RSS_FULL, "https://ex.example/feed");
  assert.equal(feed.items.length, 2);
  assert.ok(!feed.title.includes("<"));
  assert.equal(feed.title, "Example Feed &");
  assert.equal(feed.items[0].key, "one");
  assert.equal(feed.items[0].summary, "hello world");
});

test("parsePersonalFeed: valid empty feed parses with zero items", () => {
  const feed = parsePersonalFeed(RSS_EMPTY);
  assert.equal(feed.title, "Empty");
  assert.deepEqual(feed.items, []);
});

test("parsePersonalFeed: malformed html page is not a feed", () => {
  assert.throws(() => parsePersonalFeed(HTML_PAGE), NotAFeedError);
  assert.throws(() => parsePersonalFeed("<div>just html</div>"), NotAFeedError);
});

test("parsePersonalFeed: atom relative article url resolves against feed url", () => {
  const feed = parsePersonalFeed(ATOM_RELATIVE, "https://atom.example/index.xml");
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].url, "https://atom.example/posts/1");
});

test("discoverFeedLinks: finds advertised alternate feed", () => {
  const links = discoverFeedLinks(HTML_PAGE, "https://site.example/");
  assert.deepEqual(links, ["https://site.example/feed.xml"]);
});

// ---- merge ----

test("mergeFeedItems: same key dedupes, keeps firstSeen, caps retention", () => {
  const now = "2026-10-01T00:00:00.000Z";
  const prev = [{ key: "a", title: "old a", url: "https://x/a", id: "pfi:1", firstSeenAt: "2026-09-01T00:00:00.000Z" }];
  const incoming = [
    { key: "a", title: "new a", url: "https://x/a" },
    { key: "b", title: "b", url: "https://x/b" },
  ];
  const merged = mergeFeedItems(prev, incoming, { nowIso: now, retention: 2 });
  assert.equal(merged.length, 2);
  const a = merged.find((m) => m.key === "a");
  assert.equal(a.title, "new a");
  assert.equal(a.firstSeenAt, "2026-09-01T00:00:00.000Z");
  assert.equal(a.id, "pfi:1");
  const many = Array.from({ length: 5 }, (_, i) => ({ key: "k" + i, title: "t", url: "https://x/" + i }));
  assert.equal(mergeFeedItems([], many, { retention: 2 }).length, 2);
});

test("stable ids: owner/source based", () => {
  assert.equal(personalFeedId("u1", "https://a.example/f"), personalFeedId("u1", "https://a.example/f"));
  assert.notEqual(personalFeedId("u1", "https://a.example/f"), personalFeedId("u2", "https://a.example/f"));
  assert.equal(
    personalFeedItemId("u1", "pf:x", "k"),
    personalFeedItemId("u1", "pf:x", "k")
  );
  assert.notEqual(personalFeedItemId("u1", "pf:x", "k"), personalFeedItemId("u2", "pf:x", "k"));
});

// ---- fetch (SSRF-safe path with injected impls) ----

test("fetchPersonalFeed: rejects private targets before any fetch", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return rssResponse(RSS_FULL); };
  await assert.rejects(
    () => fetchPersonalFeed("http://127.0.0.1:8080/feed", { fetchImpl, lookupImpl: LOOKUP_OK }),
    (e) => /not allowed|private/i.test(e.message)
  );
  assert.equal(called, false);
});

test("fetchPersonalFeed: embedded credentials rejected", async () => {
  await assert.rejects(
    () => fetchPersonalFeed("https://user:pass@example.com/feed.xml", { fetchImpl: async () => rssResponse(RSS_FULL), lookupImpl: LOOKUP_OK }),
    (e) => /credentials|invalid url|not allowed/i.test(e.message)
  );
});

test("fetchPersonalFeed: validates each redirect hop", async () => {
  const fetchImpl = async (url) => {
    if (url.startsWith("https://ok.example/feed")) {
      return new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    }
    return rssResponse(RSS_FULL);
  };
  await assert.rejects(
    () => fetchPersonalFeed("https://ok.example/feed", { fetchImpl, lookupImpl: LOOKUP_OK }),
    (e) => /private|not allowed/i.test(e.message)
  );
});

test("fetchPersonalFeed: size cap enforced", async () => {
  const big = "<?xml version='1.0'?><rss version='2.0'><channel><title>t</title>" +
    "<item>".repeat(1) + "x".repeat(2_000_000) + "</item></channel></rss>";
  const fetchImpl = async () => rssResponse(big);
  await assert.rejects(
    () => fetchPersonalFeed("https://ok.example/feed", { fetchImpl, lookupImpl: LOOKUP_OK, maxBytes: 1000 }),
    (e) => e.code === "IMPORT_SIZE"
  );
});

test("fetchPersonalFeed: html page throws NotAFeed with discovered links; aihot UA honored", async () => {
  let seenUa = "";
  const fetchImpl = async (url, opts) => {
    if (url.includes("aihot.news")) seenUa = opts.headers["User-Agent"];
    if (url === "https://site.example/" ) return rssResponse(HTML_PAGE, "text/html; charset=utf-8");
    return rssResponse(RSS_FULL);
  };
  await assert.rejects(
    () => fetchPersonalFeed("https://site.example/", { fetchImpl, lookupImpl: LOOKUP_OK }),
    (e) => e instanceof NotAFeedError && e.discovered.length === 1
  );
  const feed = await fetchPersonalFeed(AIHOT_FEED_URL, { fetchImpl, lookupImpl: LOOKUP_OK });
  assert.equal(feed.items.length, 2);
  assert.equal(seenUa, "aihot-api/2.0.0");
  assert.ok(isAihotFeed(AIHOT_FEED_URL));
});

// ---- API ----

const codeHashOf = (code) => createHash("sha256").update("test-pepper:" + code).digest("hex");

async function otpUser(store, email, id, token) {
  await store.putUser({ id, email, createdAt: new Date().toISOString() });
  const tokenHash = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(":" + token))
    .then((h) => [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  await store.putSession({
    id: "ses:" + id,
    userId: id,
    email,
    tokenHash,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
  });
  return (path, init = {}) => new Request("http://x" + path, {
    ...init,
    headers: { ...(init.headers || {}), authorization: "Bearer " + token },
  });
}

function feedEnv(store, extra = {}) {
  return { store, authMode: "otp", mailApiKey: "k", lookupImpl: LOOKUP_OK, ...extra };
}

test("api feeds: guest gets login-required; owner add/list/delete flow", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");

  const guest = await handleApi(new Request("http://x/api/v1/feeds"), feedEnv(store));
  assert.equal(guest.status, 401);
  assert.ok(["login-required", "unauthorized"].includes((await guest.json()).error));

  const fetchImpl = async () => rssResponse(RSS_FULL);
  const add = await handleApi(
    user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }),
    feedEnv(store, { fetchImpl })
  );
  assert.equal(add.status, 200);
  const added = await add.json();
  assert.ok(added.feed.feedId.startsWith("pf:"));
  assert.equal(added.feed.itemCount, 2);
  // 名称自动取自 channel title（纯文本）
  assert.ok(!added.feed.name.includes("<"));

  const list = await handleApi(user("/api/v1/feeds"), feedEnv(store));
  assert.equal((await list.json()).feeds.length, 1);

  // reader stream merges the two custom items
  const stream = await handleApi(user("/api/v1/events?view=reader&sources=github"), feedEnv(store));
  const data = await stream.json();
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every((it) => it.id.startsWith("pfi:")));
  assert.equal(data.items[0].title, "Second"); // 按文章时间倒序
  assert.equal(data.items[0].source, "rss");
  assert.equal(data.items[0].sourceLabel, "Example Feed &");

  // owner-only detail
  const other = await otpUser(store, "o@example.com", "usr:2", "tok-2");
  const detail = await handleApi(user("/api/v1/events/" + encodeURIComponent(data.items[0].id) + "?reader=1"), feedEnv(store));
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).item.title, "Second");
  const stranger = await handleApi(other("/api/v1/events/" + encodeURIComponent(data.items[0].id) + "?reader=1"), feedEnv(store));
  assert.equal(stranger.status, 404);

  // delete removes feed and items
  const del = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(added.feed.feedId), { method: "DELETE" }), feedEnv(store));
  assert.equal(del.status, 200);
  const after = await handleApi(user("/api/v1/events?view=reader&sources=github"), feedEnv(store));
  assert.equal((await after.json()).items.length, 0);
});

test("api feeds: duplicate rejected; not-a-feed rejected clearly", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const fetchImpl = async (url) => {
    if (url.includes("invite")) return rssResponse("<html><body>feishu invite</body></html>", "text/html");
    return rssResponse(RSS_FULL);
  };
  const env = feedEnv(store, { fetchImpl });
  const add = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), env);
  assert.equal(add.status, 200);
  const dup = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), env);
  assert.equal(dup.status, 409);
  const bad = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/invite" }) }), env);
  assert.equal(bad.status, 422);
  assert.equal((await bad.json()).error, "not a feed");
});

test("api feeds: refresh failure keeps items + records state; pause excludes from stream", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const okFetch = async () => rssResponse(RSS_FULL);
  const add = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), feedEnv(store, { fetchImpl: okFetch }));
  const feedId = (await add.json()).feed.feedId;

  const failFetch = async () => new Response("boom", { status: 500 });
  const refresh = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feedId) + "/refresh", { method: "POST" }), feedEnv(store, { fetchImpl: failFetch }));
  assert.equal(refresh.status, 200);
  const refreshed = (await refresh.json()).feed;
  assert.ok(refreshed.lastError);
  // items retained
  const stream = await handleApi(user("/api/v1/events?view=reader&sources=github"), feedEnv(store));
  assert.equal((await stream.json()).items.length, 2);

  const pause = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feedId) + "/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }) }), feedEnv(store));
  assert.equal((await pause.json()).feed.paused, true);
  const pausedStream = await handleApi(user("/api/v1/events?view=reader&sources=github"), feedEnv(store));
  assert.equal((await pausedStream.json()).items.length, 0);
  // resume restores
  await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feedId) + "/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: false }) }), feedEnv(store));
  const resumed = await handleApi(user("/api/v1/events?view=reader&sources=github"), feedEnv(store));
  assert.equal((await resumed.json()).items.length, 2);
});

test("api feeds: aihot refresh floor respects 30 minutes", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  let fetches = 0;
  const fetchImpl = async () => { fetches += 1; return rssResponse(RSS_FULL); };
  const env = feedEnv(store, { fetchImpl });
  const add = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: AIHOT_FEED_URL }) }), env);
  const feedId = (await add.json()).feed.feedId;
  assert.equal(fetches, 1);
  const refresh = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feedId) + "/refresh", { method: "POST" }), env);
  const body = await refresh.json();
  assert.equal(body.wait, true);
  assert.equal(fetches, 1); // 没有真正再拉提供方
});

test("api feeds: pagination and same-name feeds stay distinct", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const fetchImpl = async (url) => rssResponse(url.includes("two") ? RSS_FULL.replace("Example Feed", "Other Name") : RSS_FULL);
  const env = feedEnv(store, { fetchImpl });
  await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/one" }) }), env);
  await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/two" }) }), env);
  const list = await handleApi(user("/api/v1/feeds"), env);
  const feeds = (await list.json()).feeds;
  assert.equal(feeds.length, 2);
  assert.notEqual(feeds[0].name, feeds[1].name);

  const page1 = await handleApi(user("/api/v1/events?view=reader&sources=github&limit=2"), env);
  const d1 = await page1.json();
  assert.equal(d1.items.length, 2);
  assert.ok(d1.cursor);
  const page2 = await handleApi(user("/api/v1/events?view=reader&sources=github&limit=2&cursor=" + encodeURIComponent(d1.cursor)), env);
  const d2 = await page2.json();
  assert.equal(d2.items.length, 2);
  assert.ok(!d2.cursor);
  const all = [...d1.items, ...d2.items];
  assert.equal(new Set(all.map((i) => i.id)).size, 4);
});

test("api feeds: old-client reader settings PUT does not erase feeds", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const env = feedEnv(store, { fetchImpl: async () => rssResponse(RSS_FULL) });
  await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), env);
  // 旧客户端只写 selectedSources/moreSourcesEnabled
  const put = await handleApi(user("/api/v1/reader/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedSources: ["github"], moreSourcesEnabled: false }) }), env);
  assert.equal(put.status, 200);
  const list = await handleApi(user("/api/v1/feeds"), env);
  assert.equal((await list.json()).feeds.length, 1);
});

test("api feeds: deleteUserData removes feeds; exportUser excludes items; dump restore keeps them", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const env = feedEnv(store, { fetchImpl: async () => rssResponse(RSS_FULL) });
  await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), env);

  const exported = await store.exportUser({ userId: "usr:1" });
  assert.equal("feeds" in exported, false);
  assert.equal("userFeeds" in exported, false);
  assert.equal("userFeedItems" in exported, false);
  const dump = await store.exportAll();
  assert.ok(Array.isArray(dump.userFeeds) && dump.userFeeds.length === 1);
  assert.ok(Array.isArray(dump.userFeedItems) && dump.userFeedItems.length === 1);

  const restored = createMemoryStore();
  await restored.importAll(JSON.parse(JSON.stringify(dump)));
  const again = await restored.listUserFeeds({ userId: "usr:1" });
  assert.equal(again.length, 1);
  const items = await restored.listUserFeedItems({ userId: "usr:1" });
  assert.equal(items.length, 2);

  await restored.deleteUserData("usr:1");
  assert.equal((await restored.listUserFeeds({ userId: "usr:1" })).length, 0);
  assert.equal((await restored.listUserFeedItems({ userId: "usr:1" })).length, 0);
});

test("api feeds: feed limit per user enforced", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const env = feedEnv(store, { fetchImpl: async (u) => rssResponse(RSS_FULL.replace("Example Feed", "n" + u)) });
  for (let i = 0; i < 30; i++) {
    const r = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/f" + i }) }), env);
    assert.equal(r.status, 200);
  }
  const over = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/overflow" }) }), env);
  assert.equal(over.status, 409);
  assert.match((await over.json()).error, /limit/);
});

test("api feeds: reader search covers custom items", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const env = feedEnv(store, { fetchImpl: async () => rssResponse(RSS_FULL) });
  await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), env);
  const hit = await handleApi(user("/api/v1/events?view=reader&sources=github&q=second"), env);
  const hitData = await hit.json();
  assert.equal(hitData.items.length, 1);
  assert.equal(hitData.items[0].title, "Second");
  const miss = await handleApi(user("/api/v1/events?view=reader&sources=github&q=nothingmatches"), env);
  assert.equal((await miss.json()).items.length, 0);
});

test("api feeds: DELETE dispatch reachable; saved snapshot survives feed deletion", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const env = feedEnv(store, { fetchImpl: async () => rssResponse(RSS_FULL) });
  const add = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/feed" }) }), env);
  const feed = (await add.json()).feed;

  const stream = await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  const itemId = (await stream.json()).items[0].id;

  // favorite the custom item (owner snapshot)
  const fav = await handleApi(user("/api/v1/favorites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId: itemId, snapshot: { id: itemId, title: "Second", url: "https://ex.example/two", source: "rss", kind: "" } }) }), env);
  assert.equal(fav.status, 200);

  // DELETE the feed (previously unreachable dispatch)
  const del = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feed.feedId), { method: "DELETE" }), env);
  assert.equal(del.status, 200);
  assert.equal((await handleApi(user("/api/v1/feeds"), env).then((r) => r.json())).feeds.length, 0);

  // owner's saved snapshot remains readable; a stranger still gets 404
  const after = await handleApi(user("/api/v1/events/" + encodeURIComponent(itemId) + "?reader=1"), env);
  assert.equal(after.status, 200);
  assert.equal((await after.json()).item.title, "Second");
  const other = await otpUser(store, "o@example.com", "usr:2", "tok-2");
  const stranger = await handleApi(other("/api/v1/events/" + encodeURIComponent(itemId) + "?reader=1"), feedEnv(store));
  assert.equal(stranger.status, 404);
});

test("assertSafeImportUrl directly rejects embedded credentials", async () => {
  const { assertSafeImportUrl } = await import("../src/ssrf.js");
  await assert.rejects(
    () => assertSafeImportUrl("https://user:pass@example.com/f", { lookupImpl: LOOKUP_OK }),
    (e) => e.code === "IMPORT_URL"
  );
});

test("api feeds: autodiscovery + final-url dedup; refresh preserves paused; mutation rate limit", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const fetchImpl = async (url) => {
    if (url === "https://site.example/") return rssResponse(HTML_PAGE, "text/html; charset=utf-8");
    return rssResponse(RSS_FULL);
  };
  const env = feedEnv(store, { fetchImpl });
  // HTML page → autodiscovery → /feed.xml
  const add = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://site.example/" }) }), env);
  assert.equal(add.status, 200);
  const feed = (await add.json()).feed;
  assert.equal(feed.url, "https://site.example/feed.xml");
  // adding the discovered URL directly is a duplicate (final-URL identity)
  const dup = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://site.example/feed.xml" }) }), env);
  assert.equal(dup.status, 409);

  // pause then refresh: paused survives a successful refresh
  await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feed.feedId) + "/pause", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paused: true }) }), env);
  const refresh = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feed.feedId) + "/refresh", { method: "POST" }), env);
  assert.equal(refresh.status, 200);
  assert.equal((await refresh.json()).feed.paused, true);

  // per-user mutation rate limit: hammering add eventually 429s
  let saw429 = false;
  for (let i = 0; i < 70 && !saw429; i++) {
    const r = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://ex.example/f" + i }) }), env);
    if (r.status === 429) saw429 = true;
  }
  assert.ok(saw429);
});

test("api feeds: failed aihot refresh also floors later attempts with retry hint", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("boom", { status: 500 }); };
  const env = feedEnv(store, { fetchImpl });
  // 直接种子一个 AIHOT 源：上次成功/尝试都在地板窗外。
  const fid = personalFeedId("usr:1", AIHOT_FEED_URL);
  await store.putUserFeed({ feedId: fid, url: AIHOT_FEED_URL, name: "aihot", lastRefreshAt: "2020-01-01T00:00:00.000Z", lastAttemptAt: "2020-01-01T00:00:00.000Z" }, { userId: "usr:1" });
  await store.setUserFeedItems(fid, [{ id: "pfi:a", key: "k", title: "t", url: "https://aihot.news/x" }], { userId: "usr:1" });
  // 第 1 次显式 refresh 真正失败（保留条目并记录状态）。
  const fail = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(fid) + "/refresh", { method: "POST" }), env);
  const failBody = await fail.json();
  assert.equal(failBody.wait, undefined);
  assert.equal(calls, 1);
  assert.ok(failBody.feed.lastError);
  // 失败的尝试同样进入 30 分钟地板：第 2 次不再发请求，带重试时间。
  const wait = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(fid) + "/refresh", { method: "POST" }), env);
  const body = await wait.json();
  assert.equal(body.wait, true);
  assert.ok(body.retryAfterSec > 0 && body.retryAfterSec <= 1800);
  assert.equal(calls, 1);
});

test("api feeds: stale auto refresh backs off after a failed attempt", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response("boom", { status: 500 }); };
  const env = feedEnv(store, { fetchImpl });
  // Direct seed: feed whose last success is old, so the stream path would refresh.
  const fid = personalFeedId("usr:1", "https://old.example/feed");
  await store.putUserFeed({ feedId: fid, url: "https://old.example/feed", name: "old", lastRefreshAt: "2020-01-01T00:00:00.000Z" }, { userId: "usr:1" });
  await store.setUserFeedItems(fid, [{ id: "pfi:x", key: "k", title: "t", url: "https://old.example/x" }], { userId: "usr:1" });
  await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  assert.equal(calls, 1); // 第一次（失败）尝试
  await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  assert.equal(calls, 1); // 退避窗内不再发网络调用
});

test('refresh completing after unsubscribe cannot recreate feed or items', async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, 'race@example.com', 'usr:race', 'race-token');
  const env = feedEnv(store, { fetchImpl: async () => rssResponse(RSS_FULL) });
  const added = await handleApi(user('/api/v1/feeds', { method:'POST', body:JSON.stringify({url:'https://ex.example/feed'}) }), env);
  const {feed} = await added.json();
  let resolveFetch, entered;
  const fetching = new Promise(r => { entered = r; });
  const pending = handleApi(user('/api/v1/feeds/' + encodeURIComponent(feed.feedId) + '/refresh', {method:'POST'}), {...env,fetchImpl:()=>{entered();return new Promise(r=>{resolveFetch=r})}});
  await fetching;
  await handleApi(user('/api/v1/feeds/' + encodeURIComponent(feed.feedId), {method:'DELETE'}), env);
  resolveFetch(rssResponse(RSS_FULL));
  assert.equal((await pending).status,404);
  assert.deepEqual(await store.listUserFeeds({userId:'usr:race'}),[]);
  assert.deepEqual(await store.listUserFeedItems({userId:'usr:race'}),[]);
});

test('refresh does not overwrite a pause made while fetching', async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, 'pause@example.com', 'usr:pause', 'pause-token');
  const env = feedEnv(store, {fetchImpl:async()=>rssResponse(RSS_FULL)});
  const added = await handleApi(user('/api/v1/feeds',{method:'POST',body:JSON.stringify({url:'https://ex.example/feed'})}),env);
  const {feed}=await added.json();
  let release, entered;const fetching=new Promise(r=>{entered=r});
  const pending=handleApi(user('/api/v1/feeds/'+encodeURIComponent(feed.feedId)+'/refresh',{method:'POST'}),{...env,fetchImpl:()=>{entered();return new Promise(r=>{release=r})}});
  await fetching;
  await handleApi(user('/api/v1/feeds/'+encodeURIComponent(feed.feedId)+'/pause',{method:'POST',body:JSON.stringify({paused:true})}),env);
  release(rssResponse(RSS_FULL));await pending;
  assert.equal((await store.getUserFeed(feed.feedId,{userId:'usr:pause'})).paused,true);
});

test("Worker reader responds from saved items while a slow RSS refresh runs in background", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "background@example.com", "usr:bg", "tok-bg");
  const me = { userId: "usr:bg" };
  const fid = personalFeedId(me.userId, "https://slow.example/feed");
  await store.putUserFeed({ feedId: fid, url: "https://slow.example/feed", name: "slow", lastRefreshAt: "2020-01-01T00:00:00.000Z" }, me);
  await store.setUserFeedItems(fid, [{ id: "pfi:saved", key: "saved", title: "Already saved", url: "https://slow.example/saved" }], me);
  const pending = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const env = feedEnv(store, {
    waitUntil: task => pending.push(task),
    fetchImpl: async () => { await gate; return rssResponse(RSS_FULL); },
  });
  let timer;
  try {
    const result = await Promise.race([
      handleApi(user("/api/v1/events?view=reader"), env),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("reading blocked on slow RSS")), 500); }),
    ]);
    assert.equal(result.status, 200);
    assert.deepEqual((await result.json()).items.map(item => item.title), ["Already saved"]);
    assert.equal(pending.length, 1);
  } finally {
    clearTimeout(timer);
    release();
    await Promise.all(pending);
  }
  const refreshed = await handleApi(user("/api/v1/events?view=reader"), env);
  const titles = (await refreshed.json()).items.map(item => item.title);
  assert.ok(titles.includes("First"));
  assert.ok(titles.includes("Already saved"));
  await Promise.all(pending);
});

test("feed discovery candidates cannot reset an exhausted shared fetch deadline", async () => {
  let requests = 0;
  await assert.rejects(fetchPersonalFeed("https://example.com/feed", {
    timeoutMs: 500,
    _startedAt: Date.now() - 600,
    lookupImpl: LOOKUP_OK,
    fetchImpl: async () => { requests++; return rssResponse(RSS_FULL); },
  }), { code: "IMPORT_TIMEOUT" });
  assert.equal(requests, 0);
});


test("personalOnly reader never loads publisher content or inherits Web subscriptions", async () => {
  const store = createMemoryStore();
  const user = await otpUser(store, "private-tool@example.com", "usr:tool", "tok-tool");
  const other = await otpUser(store, "other-tool@example.com", "usr:other-tool", "tok-other-tool");
  const env = feedEnv(store, { fetchImpl: async () => rssResponse(RSS_FULL) });
  const prefs = await handleApi(user("/api/v1/reader/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ selectedSources: ["github", "bbc"], moreSourcesEnabled: true }) }), env);
  assert.equal(prefs.status, 200);
  await store.putEvent({ id: "publisher:item", source: "github", title: "Publisher item", url: "https://example.com/public", category: "tech", publishedAt: new Date().toISOString() });
  const added = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://owned.example/rss" }) }), env);
  assert.equal(added.status, 200);
  const originalGet = store.getEvent.bind(store);
  store.readerIndex = () => { throw new Error("must not read publisher index"); };
  store.listEvents = () => { throw new Error("must not list publisher events"); };
  store.getEvent = () => { throw new Error("must not read publisher detail"); };
  const path = "/api/v1/events?view=reader&personalOnly=1&sources=github,bbc";
  const r = await handleApi(user(path), env);const body = await r.json();
  assert.equal(r.status, 200);assert.equal(body.personalOnly, true);assert.equal(body.items.length, 2);
  assert.ok(body.items.every(x => x.personalFeed === true));
  assert.equal((await (await handleApi(new Request("http://x" + path), env)).json()).items.length, 0);
  assert.equal((await (await handleApi(other(path), env)).json()).items.length, 0);
  const detailPath = "/api/v1/events/" + encodeURIComponent(body.items[0].id) + "?reader=1&personalOnly=1";
  assert.equal((await handleApi(user(detailPath), env)).status, 200);
  assert.equal((await handleApi(other(detailPath), env)).status, 404);
  assert.equal((await handleApi(user("/api/v1/events/publisher%3Aitem?reader=1&personalOnly=1"), env)).status, 404);
  store.getEvent = originalGet;
});
