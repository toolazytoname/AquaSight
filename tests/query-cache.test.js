import { test } from "node:test";
import assert from "node:assert/strict";
import { createSqliteD1, queryPlan } from "./helpers/sqlite-d1.js";
import { createD1Store } from "../src/store/d1.js";
import { createMemoryStore } from "../src/store/memory.js";
import { createContentCache, contentCacheFor } from "../src/store/content-cache.js";
import { readerIndexQueries } from "../src/store/query.js";
import { handleApi } from "../src/api/handlers.js";
import { sortReaderItems, readerAllowed, effectiveSources, normalizeReader } from "../src/reader.js";
import { itemMatchesFilters } from "../src/api/handlers.js";

/// Seed a deterministic, gnarly dataset: multiple sources, hidden rows,
/// unsafe URLs, credential URLs, repo items ordered by observedAt (not
/// publishedAt), exact timestamp ties (id tiebreak), and unread markers.
async function seedGnarly(store, { reads = {}, userId = "" } = {}) {
  const base = Date.now() - 3 * 3600 * 1000;
  const mk = (i, extra = {}) => ({
    id: "ev:" + String(i).padStart(4, "0"),
    title: "Event " + i,
    source: i % 3 === 0 ? "github" : i % 3 === 1 ? "openai" : "bbc",
    category: i % 17 === 0 ? "hidden" : "tech",
    url: i % 13 === 0 ? "javascript:void(0)" : i % 11 === 0 ? "https://u:p@example.com/x" : "https://example.com/" + i,
    publishedAt: new Date(base + i * 3600 * 1000).toISOString(),
    summary: i % 7 === 0 ? "needle haystack " + i : "summary " + i,
    ...extra,
  });
  const events = [];
  for (let i = 0; i < 1200; i++) {
    let ev;
    if (i % 5 === 0) {
      // Repo observation: observedAt drives ordering, deliberately diverging
      // from publishedAt so the precedence chain is observable.
      ev = mk(i, {
        githubRepo: { observedAt: new Date(base + (600 - i) * 7200 * 1000).toISOString() },
        publishedAt: new Date(base + i * 1000).toISOString(),
      });
    } else if (i % 29 === 0) {
      // Exact timestamp ties → id ascending tiebreak.
      ev = mk(i, { publishedAt: new Date(base).toISOString() });
    } else {
      ev = mk(i);
    }
    events.push(ev);
    await store.putEvent(ev);
  }
  for (const [eventId, at] of Object.entries(reads)) {
    await store.setRead(eventId, at, userId ? { userId } : undefined);
  }
  return events;
}

function legacyReaderView(allEvents, effectiveSet, filters = {}, reads = {}) {
  // The pre-optimization pipeline, verbatim: full scan → text filters →
  // readerAllowed → repo-aware sort.
  const filtered = allEvents
    .filter((it) => itemMatchesFilters(it, { ...filters, reads }))
    .filter((it) => readerAllowed(it, effectiveSet));
  return sortReaderItems(filtered);
}

test("sqlite: reader index reproduces legacy reader view exactly, deep pages included", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  await seedGnarly(store);

  const effective = new Set(["github", "openai"]);
  const expected = legacyReaderView(await store.listEvents(), effective);

  const index = await store.readerIndex({ sources: effective });
  const got = sortReaderItems(
    index.filter((it) => readerAllowed(it, effective))
  );
  assert.equal(got.length, expected.length);
  assert.deepEqual(
    got.map((it) => it.id),
    expected.map((it) => it.id)
  );

  // Deep pagination beyond the legacy 480-row window: every page matches.
  const limit = 30;
  for (let start = 0; start < got.length; start += limit) {
    const pageIds = got.slice(start, start + limit).map((it) => it.id);
    const rows = await store.getEventsByIds(pageIds);
    assert.deepEqual(
      rows.map((it) => it.id),
      expected.slice(start, start + limit).map((it) => it.id),
      "page @" + start
    );
  }
  assert.ok(got.length > 480, "dataset must exercise deep pagination");
});

test("sqlite: reader index applies q/category/source/unread filters identically", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  const events = await seedGnarly(store);
  const reads = { [events[1].id]: new Date().toISOString(), [events[3].id]: new Date().toISOString() };
  for (const [eventId, at] of Object.entries(reads)) await store.setRead(eventId, at);

  const effective = new Set(["github", "openai", "bbc"]);
  for (const filters of [
    { q: "needle" },
    { category: "tech" },
    { source: "github" },
    { unread: true, reads },
    { q: "haystack", unread: true, reads },
  ]) {
    const expected = legacyReaderView(events, effective, filters, filters.reads || {});
    const index = await store.readerIndex({ sources: effective });
    const got = sortReaderItems(
      index
        .filter((it) => itemMatchesFilters(it, { ...filters, reads: filters.reads || {} }))
        .filter((it) => readerAllowed(it, effective))
    );
    assert.deepEqual(
      got.map((it) => it.id),
      expected.map((it) => it.id),
      "filters " + JSON.stringify(filters)
    );
  }
});

test("sqlite: reader metadata query never ships the JSON blob and uses the source index", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  await seedGnarly(store);

  // Metadata rows carry only projections — no raw json field.
  const [{ sql, binds }] = readerIndexQueries(["github"]);
  const { results } = await db.prepare(sql).bind(...binds).all();
  assert.ok(results.length > 0);
  for (const row of results) {
    assert.equal("json" in row, false);
    assert.equal(Object.hasOwn(row, "j_url"), true);
  }

  // Planner: the WHERE clause is served by events_reader_source, not a scan.
  const plan = queryPlan(db, sql, ...binds);
  assert.ok(
    plan.some((d) => d.includes("events_reader_source")),
    "expected events_reader_source in plan: " + plan.join(" | ")
  );
  assert.ok(!plan.some((d) => d.includes(" scan")), "no table scans: " + plan.join(" | "));

  // Recency pushdown matches its expression index.
  const recency =
    "SELECT json FROM events ORDER BY COALESCE(NULLIF(published_at, ''), NULLIF(first_seen_at, ''), created_at) DESC LIMIT ?";
  const recPlan = queryPlan(db, recency, 10);
  assert.ok(
    recPlan.some((d) => d.includes("events_recency")),
    "expected events_recency in plan: " + recPlan.join(" | ")
  );
});

test("sqlite: events view=reader/featured/digest never reads the full event table", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  const events = await seedGnarly(store);
  await store.putSnapshot("events", {
    featured: [events[2].id, events[3].id, events[4].id],
  });
  const { beijingYmd } = await import("../src/time.js");
  const date = beijingYmd();
  await store.putSnapshot("digest:" + date, { date, items: [events[3]] });

  let fullScans = 0;
  const origListEvents = store.listEvents.bind(store);
  store.listEvents = async (...args) => {
    if (!args.length) fullScans += 1;
    return origListEvents(...args);
  };
  const env = { store, requireAuth: false };
  const getJson = async (p) => {
    const res = await handleApi(new Request("http://127.0.0.1" + p), env);
    assert.equal(res.status, 200);
    return res.json();
  };

  const reader = await getJson("/api/v1/events?view=reader&sources=github,openai&limit=50");
  assert.equal(reader.windowed, false);
  assert.ok(reader.total > 0);
  assert.equal(reader.items[0].url.startsWith("https://"), true);

  const featured = await getJson("/api/v1/events?view=featured");
  assert.ok(featured.items.length > 0);
  for (const it of featured.items) assert.ok([events[2].id, events[3].id, events[4].id].includes(it.id));

  const digest = await getJson("/api/v1/events?view=digest");
  assert.equal(digest.items.length, 1);

  assert.equal(fullScans, 0, "reader/featured/digest must not full-scan the events table");
});

test("sqlite: reader API pagination cursor, total and filters match the legacy pipeline", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  const events = await seedGnarly(store);
  const effective = new Set(["github", "openai"]);
  const expected = legacyReaderView(events, effective);

  const env = { store, requireAuth: false };
  const collected = [];
  let cursor = null;
  let guard = 0;
  do {
    const url = "/api/v1/events?view=reader&sources=github,openai&limit=37" + (cursor ? "&cursor=" + cursor : "");
    const res = await handleApi(new Request("http://127.0.0.1" + url), env);
    assert.equal(res.status, 200);
    const data = await res.json();
    collected.push(...data.items.map((it) => it.id));
    cursor = data.cursor;
    assert.equal(data.total, expected.length);
    guard += 1;
    assert.ok(guard < 100, "cursor loop runaway");
  } while (cursor);
  assert.deepEqual(collected, expected.map((it) => it.id));
});

test("sqlite: independent accounts get isolated reader feeds; guest stays empty by default", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  store.authPepper = "test-pepper";
  await seedGnarly(store);

  const { verifyCode } = await import("../src/auth.js");
  const { createHash } = await import("node:crypto");
  const login = async (email) => {
    const code = String(Math.floor(100000 + Math.random() * 899999));
    await store.putUser({ id: "u:" + email, email, createdAt: new Date().toISOString() });
    await store.putOtp({
      email,
      codeHash: createHash("sha256").update("test-pepper:" + code).digest("hex"),
      expiresAt: new Date(Date.now() + 600000).toISOString(),
      attempts: 0,
      sentAt: new Date().toISOString(),
      ip: "127.0.0.1",
    });
    const r = await verifyCode(store, { email, code }, {});
    assert.equal(r.ok, true);
    return r.token;
  };
  const t1 = await login("a@example.com");
  const t2 = await login("b@example.com");
  await store.setReaderPrefs({ selectedSources: ["github"], configured: true, moreSourcesEnabled: false }, { userId: (await store.getUserByEmail("a@example.com")).id });
  await store.setReaderPrefs({ selectedSources: ["openai"], configured: true, moreSourcesEnabled: false }, { userId: (await store.getUserByEmail("b@example.com")).id });

  const call = async (path, token) =>
    handleApi(new Request("http://127.0.0.1" + path, { headers: token ? { authorization: "Bearer " + token } : {} }), {
      store,
      authMode: "otp",
    });

  const r1 = await (await call("/api/v1/events?view=reader&limit=50", t1)).json();
  const r2 = await (await call("/api/v1/events?view=reader&limit=50", t2)).json();
  assert.ok(r1.items.length > 0 && r1.items.every((it) => it.source === "github"));
  assert.ok(r2.items.length > 0 && r2.items.every((it) => it.source === "openai"));

  const guest = await (await call("/api/v1/events?view=reader&limit=50", null)).json();
  assert.equal(guest.total, 0);
  const guestGithub = await (await call("/api/v1/events?view=reader&sources=github&limit=50", null)).json();
  assert.ok(guestGithub.items.length > 0);
  assert.ok(guestGithub.items.every((it) => it.source === "github"));
});

test("cache: TTL expiry, concurrent miss dedupe, clone-on-read, byte/entry bounds", async () => {
  let now = 0;
  const cache = createContentCache({ ttlMs: 30, maxEntries: 3, maxBytes: 200, now: () => now });
  let loads = 0;
  const loader = async () => {
    loads += 1;
    return { n: loads, list: [1, 2, 3] };
  };
  const a = await cache.getOrLoad("k", loader);
  const b = await cache.getOrLoad("k", loader);
  assert.equal(loads, 1);
  a.n = 999;
  a.list.push(4);
  assert.deepEqual(b, { n: 1, list: [1, 2, 3] }, "callers must not alias the cached value");
  const c = await cache.getOrLoad("k", loader);
  assert.deepEqual(c, { n: 1, list: [1, 2, 3] }, "mutation of a returned clone must not poison the cache");

  // TTL expiry forces a reload.
  now += 40;
  await cache.getOrLoad("k", loader);
  assert.equal(loads, 2);

  // Entry-count bound (LRU eviction).
  await cache.getOrLoad("e1", async () => "x");
  await cache.getOrLoad("e2", async () => "x");
  await cache.getOrLoad("e3", async () => "x");
  await cache.getOrLoad("e4", async () => "x");
  assert.ok(cache.size <= 3, "entries bounded: " + cache.size);

  // Byte bound: oversized values return but are not cached.
  let bigLoads = 0;
  const big = "y".repeat(500);
  await cache.getOrLoad("big", async () => {
    bigLoads += 1;
    return big;
  });
  await cache.getOrLoad("big", async () => {
    bigLoads += 1;
    return big;
  });
  assert.equal(bigLoads, 2, "oversized values must not be cached");
});

test("cache: failed loaders are not cached and do not poison later reads", async () => {
  const cache = createContentCache();
  let attempts = 0;
  await assert.rejects(
    cache.getOrLoad("bad", async () => {
      attempts += 1;
      throw new Error("db down");
    })
  );
  const ok = await cache.getOrLoad("bad", async () => {
    attempts += 1;
    return "recovered";
  });
  assert.equal(ok, "recovered");
  assert.equal(attempts, 2);
});

test("cache: invalidate detaches in-flight loaders — stale completion cannot repopulate", async () => {
  const cache = createContentCache({ ttlMs: 60_000 });
  let releaseOld;
  const oldStarted = cache.getOrLoad("k", () => new Promise((resolve) => (releaseOld = () => resolve("stale"))));
  await new Promise((r) => setTimeout(r, 1));
  cache.invalidate();
  const fresh = await cache.getOrLoad("k", async () => "fresh");
  assert.equal(fresh, "fresh");
  releaseOld();
  assert.equal(await oldStarted, "stale");
  // The stale loader finished AFTER the invalidation; the cache must keep
  // serving "fresh", not "stale".
  const again = await cache.getOrLoad("k", async () => "loader-must-not-run");
  assert.equal(again, "fresh");
});

test("cache: one instance per DB handle — no cross-database leak", async () => {
  const db1 = await createSqliteD1();
  const db2 = await createSqliteD1();
  test.after(() => {
    db1.close();
    db2.close();
  });
  const s1 = createD1Store(db1);
  const s2 = createD1Store(db2);
  await s1.putEvent({ id: "only-in-db1", title: "X", source: "github", category: "tech", url: "https://a.example/1" });
  assert.equal((await s1.getEvent("only-in-db1")).id, "only-in-db1");
  assert.equal(await s2.getEvent("only-in-db1"), null);
  assert.notEqual(contentCacheFor(db1), contentCacheFor(db2));
});

test("sqlite: content mutations invalidate cached reads (upsert, ingest, snapshot, import)", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);

  await store.putEvent({ id: "e1", title: "v1", source: "github", category: "tech", url: "https://a.example/1" });
  assert.equal((await store.getEvent("e1")).title, "v1");
  await store.putEvent({ id: "e1", title: "v2", source: "github", category: "tech", url: "https://a.example/1" });
  assert.equal((await store.getEvent("e1")).title, "v2", "upsert must invalidate");

  await store.applyFeed({ events: [{ id: "e1", title: "v3", source: "github", category: "tech", url: "https://a.example/1" }] });
  assert.equal((await store.getEvent("e1")).title, "v3", "ingest must invalidate");

  await store.putSnapshot("events", { featured: ["e1"] });
  assert.deepEqual(await store.getFeaturedIds(), ["e1"]);
  await store.putSnapshot("events", { featured: ["e1", "e2"] });
  assert.deepEqual(await store.getFeaturedIds(), ["e1", "e2"], "snapshot write must invalidate the ID projection");

  assert.equal(await store.countEvents(), 1);
  await store.importAll({ events: [], articles: [], members: [], articleEvent: [] });
  assert.equal(await store.countEvents(), 0, "import must invalidate counts");
});

test("sqlite: getSnapshotAt and getFeaturedIds read metadata without full snapshots", async () => {
  const db = await createSqliteD1();
  test.after(() => db.close());
  const store = createD1Store(db);
  assert.equal(await store.getSnapshotAt("events"), null);
  assert.equal(await store.getFeaturedIds(), null);
  const at = new Date().toISOString();
  await store.putSnapshot("events", { at, featured: ["a", "b"], items: [{ id: "a" }, { id: "b" }] });
  assert.equal(await store.getSnapshotAt("events"), at);
  assert.deepEqual(await store.getFeaturedIds(), ["a", "b"]);
});

test("memory store readerIndex matches D1 reader index pipeline", async () => {
  const mem = createMemoryStore();
  const events = await seedGnarly(mem);
  const effective = effectiveSources(normalizeReader({ selectedSources: ["github", "openai"], moreSourcesEnabled: true }));
  const expected = legacyReaderView(events, effective);
  const index = await mem.readerIndex({ sources: effective });
  const got = sortReaderItems(index.filter((it) => readerAllowed(it, effective)));
  assert.deepEqual(
    got.map((it) => it.id),
    expected.map((it) => it.id)
  );
});


test("sqlite: latest and opensource use cached metadata and fetch only page bodies", async t => {
  const db = await createSqliteD1(); t.after(() => db.close());
  const store = createD1Store(db);
  const now = Date.now() - 60_000;
  const ids = [];
  for (let i = 0; i < 650; i++) {
    const id = "page:" + String(i).padStart(4, "0"); ids.push(id);
    await store.putEvent({ id, title: "Open source framework " + i,
      source: "github", category: "tech", url: "https://example.com/" + i,
      publishedAt: new Date(now - i * 1000).toISOString(),
      githubRepo: { observedAt: new Date(now - i * 1000).toISOString() },
      // Large fields must stay out of the metadata projection.
      details: "body ".repeat(5000) });
  }
  const prepare = db.prepare.bind(db);
  let metadataQueries = 0, bodyRows = 0, fullScans = 0;
  db.prepare = sql => {
    const stmt = prepare(sql);
    if (sql.includes("j_repo_type") && sql.includes("FROM events")) metadataQueries++;
    if (sql === "SELECT json FROM events") fullScans++;
    if (sql.startsWith("SELECT id, json FROM events WHERE id IN")) {
      const all = stmt.all.bind(stmt);
      stmt.all = async () => { const result = await all(); bodyRows += result.results.length; return result; };
    }
    return stmt;
  };
  const get = async path => {
    const res = await handleApi(new Request("https://example.com/api/v1/events?" + path), { store });
    assert.equal(res.status, 200); return res.json();
  };
  const first = await get("view=latest&limit=30");
  assert.equal(first.total, 650); assert.equal(first.windowed, false);
  assert.deepEqual(first.items.map(it => it.id), ids.slice(0, 30));
  assert.equal(bodyRows, 30); assert.equal(metadataQueries, 1); assert.equal(fullScans, 0);
  assert.ok(first.items[0].details.length > 20_000);
  await get("view=latest&limit=30");
  assert.equal(bodyRows, 30, "warm identical page must reuse public body cache");
  assert.equal(metadataQueries, 1, "warm metadata must not query D1 again");
  const cursor = Buffer.from(JSON.stringify({ o: 600 })).toString("base64url");
  const deep = await get("view=latest&limit=30&cursor=" + cursor);
  assert.deepEqual(deep.items.map(it => it.id), ids.slice(600, 630));
  const open = await get("view=opensource&limit=30");
  assert.deepEqual(open.items.map(it => it.id), ids.slice(0, 30));
  assert.equal(metadataQueries, 1); assert.equal(fullScans, 0);
});

test("sqlite: feed metadata preserves hidden-content and null repo semantics", async t => {
  const db = await createSqliteD1(); t.after(() => db.close());
  const store = createD1Store(db);
  const events = [
    { id: "null-repo", title: "Framework", githubRepo: null, publishedAt: "invalid", observedAt: "2026-09-01T00:00:00Z" },
    { id: "false-repo", title: "Framework", githubRepo: false, publishedAt: "2026-09-02T00:00:00Z" },
    { id: "hidden-summary", title: "Framework", summaryZh: "去世" },
    { id: "good", title: "Compiler release", publishedAt: "2026-09-03T00:00:00Z" },
  ].map(it => ({ source: "github", category: "tech", url: "https://example.com/x", ...it }));
  for (const event of events) await store.putEvent(event);
  const index = await store.feedIndex();
  const { selectLatest } = await import("../src/select.js");
  assert.deepEqual(selectLatest(index).map(it => it.id), selectLatest(events).map(it => it.id));
  const effective = new Set(["github"]);
  assert.deepEqual(sortReaderItems(index.filter(it => readerAllowed(it, effective))).map(it => it.id),
    legacyReaderView(events, effective).map(it => it.id));
});

test("cache: concurrent callers share one loader and receive separate values", async () => {
  const cache = createContentCache(); let release, loads = 0;
  const loader = () => { loads++; return new Promise(resolve => { release = resolve; }); };
  const a = cache.getOrLoad("same", loader), b = cache.getOrLoad("same", loader);
  assert.equal(loads, 1); release({ items: [1] });
  const [one, two] = await Promise.all([a, b]);
  one.items.push(2); assert.deepEqual(two.items, [1]);
});


test("sqlite: read indexes migrate existing rows and can be applied twice", async t => {
  const db = await createSqliteD1(); t.after(() => db.close());
  db.__db.exec("DROP INDEX events_reader_source; DROP INDEX events_recency");
  const store = createD1Store(db);
  await store.putEvent({ id: "old-row", source: "github", title: "Existing project",
    category: "tech", url: "https://example.com/x" });
  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../worker/migrations/20260930_read_indexes.sql", import.meta.url), "utf8");
  db.__db.exec(migration); db.__db.exec(migration);
  const [{ sql, binds }] = readerIndexQueries(["github"]);
  assert.ok(queryPlan(db, sql, ...binds).some(it => it.includes("events_reader_source")));
  assert.deepEqual((await store.readerIndex({ sources: ["github"] })).map(it => it.id), ["old-row"]);
});

test("sqlite: reader rechecks changed rows and malformed cursors reset safely", async t => {
  const db = await createSqliteD1(); t.after(() => db.close());
  const store = createD1Store(db);
  const original = { id: "changed", source: "github", title: "Project", category: "tech", url: "https://example.com/x" };
  await store.putEvent(original);
  await store.readerIndex({ sources: ["github"] });
  // Simulate another isolate changing content after this isolate warmed its metadata.
  await db.prepare("UPDATE events SET json = ? WHERE id = ?")
    .bind(JSON.stringify({ ...original, source: "bbc" }), original.id).run();
  const get = async cursor => {
    const res = await handleApi(new Request("https://example.com/api/v1/events?view=reader&sources=github&cursor=" + cursor), { store });
    assert.equal(res.status, 200); return res.json();
  };
  const cursor = Buffer.from("null").toString("base64url");
  const body = await get(cursor);
  assert.deepEqual(body.items, []); assert.equal(body.cursor, null);
});


test("sqlite: operational snapshots bypass shared content cache", async t => {
  const db = await createSqliteD1(); t.after(() => db.close());
  const store = createD1Store(db);
  const key = "scheduler:collect:2026-09-30";
  await store.putSnapshot(key, { dispatched: false });
  assert.equal((await store.getSnapshot(key)).json.dispatched, false);
  await db.prepare("UPDATE snapshots SET json = ? WHERE name = ?")
    .bind(JSON.stringify({ dispatched: true }), key).run();
  assert.equal((await store.getSnapshot(key)).json.dispatched, true);
});
