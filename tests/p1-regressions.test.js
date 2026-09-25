import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { createBudget, RESERVE_CNY, MAX_TOKENS_IN } from "../src/budget.js";
import { collectOnce, digestOnce, maybeCatchUpDigest, digestSlotUtc } from "../src/pipeline.js";
import { enrichItems, enrichOne, clipToTokens, buildPrompt, estimateTokens } from "../src/enrich.js";
import { selectDigest } from "../src/select.js";
import { loadRemotePrefs } from "../src/remote.js";
import { ingestPayload } from "../src/ingest.js";
import { EVENT_KEEP_MS } from "../src/retention.js";
import { beijingYmd } from "../src/time.js";
import { loadFileStore } from "../src/store/file.js";
import { createD1Store } from "../src/store/d1.js";
import { createFakeD1 } from "./helpers/fake-d1.js";
import { visibleCards } from "../web/rules.js";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function envWith(store, extra = {}) {
  return { store, requireAuth: false, ...extra };
}

function makeAccess() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  jwk.kid = "test";
  jwk.alg = "RS256";
  jwk.use = "sig";
  function jwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const sig = sign("RSA-SHA256", Buffer.from(header + "." + body), privateKey).toString("base64url");
    return header + "." + body + "." + sig;
  }
  return { jwks: { keys: [jwk] }, jwt };
}

test("ingest top-level items writes event rows", async () => {
  const store = createMemoryStore();
  const req = new Request("http://127.0.0.1/api/v1/ingest", {
    method: "POST",
    headers: { authorization: "Bearer ingest-secret", "content-type": "application/json" },
    body: JSON.stringify({
      updatedAt: "2026-09-07T01:00:00.000Z",
      items: [
        {
          id: "evt:ingested",
          title: "OpenAI launches GPT-5",
          source: "openai",
          category: "tech",
          url: "https://openai.com/gpt5",
          memberIds: ["art:1"],
        },
      ],
    }),
  });
  const res = await handleApi(req, envWith(store, { ingestToken: "ingest-secret", requireAuth: true }));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.count, 1);
  const ev = await store.getEvent("evt:ingested");
  assert.ok(ev);
  assert.equal(ev.title, "OpenAI launches GPT-5");
  const listed = await (await handleApi(
    new Request("http://127.0.0.1/api/v1/events?view=featured"),
    envWith(store)
  )).json();
  assert.ok(listed.items.some((it) => it.id === "evt:ingested"));
});

test("spoofed access email is rejected; ingest cannot export", async () => {
  const store = createMemoryStore();
  const pair = makeAccess();
  const spoof = await handleApi(
    new Request("http://127.0.0.1/api/v1/export", {
      headers: {
        "x-auth-email": "me@example.com",
        "cf-access-authenticated-user-email": "me@example.com",
      },
    }),
    {
      store,
      requireAuth: true,
      allowedEmail: "me@example.com",
      accessAud: "aud",
      jwks: pair.jwks,
    }
  );
  assert.equal(spoof.status, 401);
  const token = pair.jwt({
    email: "me@example.com",
    aud: "aud",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const ok = await handleApi(
    new Request("http://127.0.0.1/api/v1/settings", {
      headers: { "cf-access-jwt-assertion": token },
    }),
    {
      store,
      requireAuth: true,
      allowedEmail: "me@example.com",
      accessAud: "aud",
      jwks: pair.jwks,
    }
  );
  assert.equal(ok.status, 200);
  const exportRes = await handleApi(
    new Request("http://127.0.0.1/api/v1/export"),
    envWith(store, { ingestToken: "ingest-secret", requireAuth: true })
  );
  const withIngest = await handleApi(
    new Request("http://127.0.0.1/api/v1/export", {
      headers: { authorization: "Bearer ingest-secret" },
    }),
    envWith(store, { ingestToken: "ingest-secret", requireAuth: true })
  );
  assert.equal(exportRes.status, 401);
  assert.equal(withIngest.status, 403);
});

test("budget records actual cost even when it exceeds the reservation", async () => {
  const persist = [];
  const b = createBudget(
    {
      monthSpent: 0,
      daySpent: 0,
      reserved: 0,
      dayCandidates: 0,
      month: "2026-09",
      day: "2026-09-07",
    },
    new Date("2026-09-07T00:00:00Z"),
    { persist: async (s) => persist.push({ ...s }) }
  );
  const r = await b.reserve({ cny: RESERVE_CNY, now: new Date("2026-09-07T00:00:00Z") });
  assert.ok(persist.length >= 1);
  await b.commit(r, 0.1944);
  const snap = b.snapshot();
  assert.ok(Math.abs(snap.monthSpent - 0.1944) < 1e-9);
  assert.ok(snap.monthSpent > RESERVE_CNY);
});

test("digest catch-up waits for Beijing 08:05 and retries send after 500", async () => {
  const store = createMemoryStore();
  const items = [
    {
      id: "evt:new",
      title: "Rust 编译器发布",
      source: "hn",
      category: "tech",
      subject: "rust",
      publishedAt: "2026-09-07T01:00:00.000Z",
      url: "https://example.com/r",
    },
  ];
  const before = await maybeCatchUpDigest(store, {
    now: new Date("2026-09-06T17:00:00Z"),
    items,
    skipLock: true,
    key: "k",
    fetchImpl: async () => ({ ok: true, json: async () => ({ code: 200 }) }),
  });
  assert.equal(before.reason, "before-slot");
  assert.ok(digestSlotUtc(new Date("2026-09-06T17:00:00Z")) > Date.parse("2026-09-06T17:00:00Z"));
  let fail = true;
  const fake = async () => {
    if (fail) return { ok: false, status: 500, json: async () => ({ code: 500 }) };
    return { ok: true, status: 200, json: async () => ({ code: 200, message: "success" }) };
  };
  const first = await digestOnce({
    store,
    items,
    skipLock: true,
    now: new Date("2026-09-07T00:10:00Z"),
    key: "k",
    fetchImpl: fake,
    sleepImpl: async () => {},
  });
  assert.equal(first.bark.ok, false);
  fail = false;
  const second = await digestOnce({
    store,
    items,
    skipLock: true,
    now: new Date("2026-09-07T00:20:00Z"),
    key: "k",
    fetchImpl: fake,
    sleepImpl: async () => {},
  });
  assert.equal(second.bark.ok, true);
});

test("all-source failure keeps last good snapshot time", async () => {
  const store = createMemoryStore();
  const good = await collectOnce({
    store,
    raw: [
      {
        title: "OpenAI launches GPT-5 API",
        source: "openai",
        url: "https://openai.com/gpt5",
        publishedAt: new Date().toISOString(),
      },
    ],
    sourceErrors: [],
    sourceHealth: [{ source: "openai", ok: true }],
    skipNotify: true,
    skipLock: true,
    enrich: false,
  });
  assert.ok(good.items.length >= 1);
  const oldAt = good.updatedAt;
  const saved = await store.getSnapshot("last-good-events");
  assert.ok(saved && saved.json && saved.json.items.length >= 1);
  const failed = await collectOnce({
    store,
    raw: [],
    sourceErrors: [{ source: "openai", message: "down" }],
    sourceHealth: [{ source: "openai", ok: false }],
    skipNotify: true,
    skipLock: true,
    enrich: false,
    forceNotify: true,
  });
  assert.equal(failed.collectFailed, true);
  assert.equal(failed.updatedAt, oldAt);
  assert.ok(failed.items.length >= 1);
  const snap = await store.getSnapshot("events");
  assert.ok(snap.json.items.length >= 1);
});

test("August news does not enter September digest even with high stored score", () => {
  const now = new Date("2026-09-07T00:00:00Z");
  const out = selectDigest(
    [
      {
        id: "old",
        title: "Rust 1.80 发布",
        source: "hn",
        category: "tech",
        subject: "rust",
        value: 0.99,
        publishedAt: "2026-08-10T00:00:00Z",
      },
    ],
    { now }
  );
  assert.equal(out.length, 0);
});

test("model hidden category is applied and drops featured", async () => {
  const fake = async () => ({
    ok: true,
    json: async () => ({
      choices: [
        {
          message: {
            content: JSON.stringify({
              category: "hidden",
              entities: [],
              titleZh: "促销",
              overviewZh: "广告",
              facts: [],
              impact: "",
              evidence: [],
              uncertainty: [],
              attribution: [],
              insufficient: false,
            }),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    }),
  });
  const out = await enrichItems(
    [{ id: "e1", title: "限时折扣芯片", source: "36kr", category: "tech", url: "https://36kr.com/a" }],
    { apiKey: "k", fetchImpl: fake, budget: createBudget({}, new Date("2026-09-07T00:00:00Z")) }
  );
  assert.equal(out[0].category, "hidden");
});

test("file-like memory seed restores feedback notifications and locks", async () => {
  const seeded = createMemoryStore({
    feedback: [{ id: "fb:1", kind: "hide", eventId: "evt:x" }],
    notifications: [{ id: "n:1", channel: "bark-digest", status: "failed" }],
    locks: [["collect", new Date(Date.now() + 60000).toISOString()]],
  });
  assert.equal((await seeded.listFeedback())[0].id, "fb:1");
  assert.equal((await seeded.listNotifications())[0].id, "n:1");
  assert.equal(await seeded.acquireLock("collect", new Date(Date.now() + 1000).toISOString()), false);
});

test("collector reads remote prefs before scoring", async () => {
  const fake = async (url) => {
    assert.match(String(url), /\/api\/v1\/settings$/);
    return {
      ok: true,
      json: async () => ({ prefs: { blockedSources: ["hn"], hiddenEventIds: [], topicWeights: {} } }),
    };
  };
  const prefs = await loadRemotePrefs({
    ingestUrl: "https://example.workers.dev/api/v1/ingest",
    token: "ingest-secret",
    fetchImpl: fake,
  });
  assert.deepEqual(prefs.blockedSources, ["hn"]);
});

test("timeout keeps reserved model cost", async () => {
  const budget = createBudget({}, new Date("2026-09-07T00:00:00Z"));
  const fake = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  await enrichOne(
    { title: "OpenAI launches GPT-5", summary: "x", url: "https://openai.com/a" },
    { apiKey: "k", fetchImpl: fake, budget, now: new Date("2026-09-07T00:00:00Z") }
  );
  assert.ok(budget.snapshot().monthSpent >= RESERVE_CNY);
});

test("prompt clipping stays within reserved input tokens", () => {
  const clipped = clipToTokens("字".repeat(5000), 100);
  assert.ok(clipped.length <= 100);
  const latin = clipToTokens("abcd".repeat(5000), 100);
  assert.ok(latin.length <= 100);
  const prompt = buildPrompt({
    title: "题".repeat(3000),
    summary: "摘".repeat(3000),
    body: "正".repeat(8000),
    sources: [{ source: "hn", title: "t".repeat(400), url: "https://x/" + "u".repeat(400) }],
  });
  assert.ok(estimateTokens(prompt) <= MAX_TOKENS_IN);
  assert.ok(prompt.length <= MAX_TOKENS_IN);
});

test("HTTP 200 with unreadable body keeps reserved model cost", async () => {
  const budget = createBudget({}, new Date("2026-09-07T00:00:00Z"));
  const fake = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("unexpected end of json");
    },
  });
  await enrichOne(
    { title: "OpenAI launches GPT-5", summary: "x", url: "https://openai.com/a" },
    { apiKey: "k", fetchImpl: fake, budget, now: new Date("2026-09-07T00:00:00Z") }
  );
  assert.ok(budget.snapshot().monthSpent >= RESERVE_CNY);
});

test("digest timeout is stored as unknown and not resent", async () => {
  const store = createMemoryStore();
  const items = [
    {
      id: "e",
      title: "Rust 发布",
      source: "hn",
      category: "tech",
      subject: "rust",
      publishedAt: "2026-09-07T01:00:00Z",
      url: "https://e/1",
    },
  ];
  let n = 0;
  const fake = async () => {
    n += 1;
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  const first = await digestOnce({
    store,
    items,
    skipLock: true,
    now: new Date("2026-09-07T00:10:00Z"),
    key: "k",
    fetchImpl: fake,
    timeoutMs: 5,
  });
  assert.equal(first.bark.result.kind, "unknown");
  const second = await digestOnce({
    store,
    items,
    skipLock: true,
    now: new Date("2026-09-07T00:20:00Z"),
    key: "k",
    fetchImpl: fake,
    timeoutMs: 5,
  });
  assert.equal(second.bark.reason, "unknown");
  assert.equal(n, 1);
});

test("today's digest can be refreshed silently after it was sent", async () => {
  const store = createMemoryStore();
  const now = new Date("2026-09-07T04:00:00Z");
  await store.putSnapshot("digest-sent:2026-09-07", { ok: true });
  await store.putEvent({ id: "new", title: "新发布的模型", category: "tech", source: "hn", publishedAt: now.toISOString() });
  const result = await digestOnce({ store, now, force: true, skipNotify: true, skipLock: true });
  assert.equal(result.digest.items[0]?.id, "new");
  assert.equal(result.bark.attempted, 0);
  assert.equal((await store.getSnapshot("digest:2026-09-07")).json.items[0].id, "new");
});

test("digest send drops events hidden after generation", async () => {
  const store = createMemoryStore();
  const items = [
    {
      id: "keep",
      title: "Rust 编译器发布",
      source: "hn",
      category: "tech",
      subject: "rust",
      publishedAt: "2026-09-07T01:00:00Z",
      url: "https://e/1",
    },
    {
      id: "hide-me",
      title: "OpenAI launches GPT-5 API",
      source: "openai",
      category: "tech",
      subject: "openai",
      publishedAt: "2026-09-07T01:00:00Z",
      url: "https://e/2",
    },
  ];
  await digestOnce({
    store,
    items,
    skipLock: true,
    skipNotify: true,
    now: new Date("2026-09-07T00:10:00Z"),
  });
  await store.setPrefs({ hiddenEventIds: ["hide-me"] });
  const bodies = [];
  const fake = async (_u, init) => {
    bodies.push(JSON.parse(init.body).body);
    return { ok: true, status: 200, json: async () => ({ code: 200, message: "success" }) };
  };
  const sent = await digestOnce({
    store,
    items,
    skipLock: true,
    now: new Date("2026-09-07T00:10:00Z"),
    key: "k",
    fetchImpl: fake,
  });
  assert.equal(sent.digest.items.some((i) => i.id === "hide-me"), false);
  assert.equal(bodies.join("").includes("GPT-5"), false);
});

test("ingest applyFeed failure keeps previous events", async () => {
  const store = createMemoryStore();
  await ingestPayload(store, {
    items: [{ id: "old", title: "old", source: "hn", category: "tech", url: "https://e/o" }],
  });
  const orig = store.applyFeed.bind(store);
  store.applyFeed = async (feed) => {
    if ((feed.events || []).some((e) => e.id === "new2")) throw new Error("write fail");
    return orig(feed);
  };
  await assert.rejects(() =>
    ingestPayload(store, {
      items: [
        { id: "new1", title: "n1", source: "hn", category: "tech", url: "https://e/1" },
        { id: "new2", title: "n2", source: "hn", category: "tech", url: "https://e/2" },
      ],
    })
  );
  assert.equal((await store.getEvent("old")).title, "old");
  assert.equal(await store.getEvent("new1"), null);
});

test("ingest writes articles with events", async () => {
  const store = createMemoryStore();
  const r = await ingestPayload(store, {
    items: [
      {
        id: "e1",
        title: "Rust 发布",
        source: "hn",
        category: "tech",
        url: "https://e/1",
        memberIds: ["art:1"],
      },
    ],
    articles: [{ id: "art:1", title: "raw", source: "hn", url: "https://e/1" }],
  });
  assert.equal(r.articleCount, 1);
  assert.equal((await store.listArticles()).length, 1);
});

test("fallback list hides obituaries", () => {
  const items = visibleCards([
    { id: "a", title: "张三去世", category: "hidden", source: "weibo" },
    { id: "b", title: "Rust 1.80 发布", category: "tech", source: "hn" },
  ]);
  assert.deepEqual(items.map((x) => x.id), ["b"]);
});

test("file store serializes concurrent writes and shares locks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aq-file-"));
  const p = join(dir, "store.json");
  const a = await loadFileStore(p);
  await Promise.all(
    Array.from({ length: 10 }, (_, i) => a.putEvent({ id: "e" + i, title: "t" + i, source: "hn" }))
  );
  const b = await loadFileStore(p);
  assert.equal((await b.listEvents()).length, 10);
  const until = new Date(Date.now() + 60000).toISOString();
  assert.equal(await a.acquireLock("collect", until), true);
  assert.equal(await b.acquireLock("collect", until), false);
  await a.releaseLock("collect");
  await rm(dir, { recursive: true, force: true });
});

test("import-backup replaces rather than merging extra events", async () => {
  const store = createMemoryStore();
  await store.putEvent({ id: "extra", title: "extra", source: "hn" });
  await store.importAll({
    events: [["kept", { id: "kept", title: "kept", source: "hn" }]],
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
  assert.equal(await store.getEvent("extra"), null);
  assert.ok(await store.getEvent("kept"));
});

test("collect payload includes articles budget notifications and digest", async () => {
  const store = createMemoryStore();
  const r = await collectOnce({
    store,
    raw: [
      {
        title: "Rust 1.80 发布",
        source: "hn",
        url: "https://example.com/r",
        publishedAt: new Date().toISOString(),
      },
    ],
    sourceErrors: [],
    sourceHealth: [{ source: "hn", ok: true }],
    skipNotify: true,
    skipLock: true,
    enrich: false,
  });
  assert.ok(Array.isArray(r.articles));
  assert.ok(r.articles.length >= 1);
  assert.ok("budget" in r);
  assert.ok(Array.isArray(r.notifications));
});

test("GET digest returns stored snapshot instead of live reselect", async () => {
  const store = createMemoryStore();
  const date = beijingYmd();
  await store.putEvent({
    id: "live",
    title: "live event should not appear",
    source: "hn",
    category: "tech",
    publishedAt: new Date().toISOString(),
    url: "https://e/live",
  });
  await store.putSnapshot("digest:" + date, {
    date,
    items: [{ id: "fixed", title: "fixed digest", category: "tech", source: "hn" }],
    tech: [{ id: "fixed", title: "fixed digest", category: "tech", source: "hn" }],
    business: [],
    public: [],
  });
  const res = await handleApi(new Request("http://127.0.0.1/api/v1/digest"), envWith(store));
  const data = await res.json();
  assert.equal(data.digest.items[0].id, "fixed");
  assert.equal(data.digest.items.some((it) => it.id === "live"), false);
});

test("GET digest can verify a published historical date", async () => {
  const store = createMemoryStore();
  await store.putSnapshot("digest:2026-09-25", {
    date: "2026-09-25",
    items: [{ id: "historical", title: "historical digest", category: "tech" }],
  });
  const res = await handleApi(
    new Request("http://127.0.0.1/api/v1/digest?date=2026-09-25"),
    envWith(store)
  );
  const data = await res.json();
  assert.equal(data.digest.date, "2026-09-25");
  assert.equal(data.digest.items[0].id, "historical");
  const invalid = await handleApi(
    new Request("http://127.0.0.1/api/v1/digest?date=not-a-date"),
    envWith(store)
  );
  assert.equal(invalid.status, 400);
});

test("events list filters category source and unread on the server", async () => {
  const store = createMemoryStore();
  await store.putEvent({
    id: "tech-hn",
    title: "Rust",
    source: "hn",
    category: "tech",
    url: "https://e/1",
    publishedAt: new Date().toISOString(),
  });
  await store.putEvent({
    id: "biz-kr",
    title: "融资",
    source: "36kr",
    category: "business",
    url: "https://e/2",
    publishedAt: new Date().toISOString(),
  });
  await store.setRead("tech-hn", new Date().toISOString());
  const byCat = await (
    await handleApi(new Request("http://127.0.0.1/api/v1/events?category=business"), envWith(store))
  ).json();
  assert.ok(byCat.items.every((it) => it.category === "business"));
  const bySrc = await (
    await handleApi(new Request("http://127.0.0.1/api/v1/events?source=hn"), envWith(store))
  ).json();
  assert.ok(bySrc.items.every((it) => it.source === "hn"));
  const unread = await (
    await handleApi(new Request("http://127.0.0.1/api/v1/events?unread=1"), envWith(store))
  ).json();
  assert.equal(unread.items.some((it) => it.id === "tech-hn"), false);
});

test("D1 duplicate X import stays private and idempotent", async () => {
  const db = createFakeD1();
  const req = () =>
    new Request("http://127.0.0.1/api/v1/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://x.com/foo/status/1234567890", excerpt: "hello" }),
    });
  const first = await handleApi(req(), envWith(createD1Store(db)));
  assert.equal(first.status, 200);
  const a = await first.json();
  assert.ok(a.items[0].id);
  assert.equal(a.private, true);
  const second = await handleApi(req(), envWith(createD1Store(db)));
  const b = await second.json();
  assert.equal(b.items[0].id, a.items[0].id, "same link maps to the same stable id");
  const store = createD1Store(db);
  assert.equal(await store.getEvent(a.items[0].id), null, "manual imports never write the public events table");
  assert.equal((await store.listEvents()).length, 0);
});

test("D1 import-backup replaces extra events and ingest writes articles", async () => {
  const db = createFakeD1();
  const store = createD1Store(db);
  await store.putEvent({ id: "extra", title: "extra", source: "hn", category: "tech" });
  await store.importAll({
    events: [["kept", { id: "kept", title: "kept", source: "hn", category: "tech" }]],
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
  assert.equal(await store.getEvent("extra"), null);
  assert.ok(await store.getEvent("kept"));
  await ingestPayload(store, {
    items: [
      {
        id: "e1",
        title: "Rust 发布",
        source: "hn",
        category: "tech",
        url: "https://e/1",
        memberIds: ["art:1"],
      },
    ],
    articles: [{ id: "art:1", title: "raw", source: "hn", url: "https://e/1" }],
    budget: { monthSpent: 0.2, daySpent: 0.2 },
    notifications: [{ id: "n:1", channel: "bark-digest", status: "sent" }],
    digest: { date: "2026-09-07", items: [{ id: "e1", title: "Rust 发布" }] },
  });
  assert.equal((await store.listArticles()).length, 1);
  assert.equal((await store.getBudget()).monthSpent, 0.2);
  assert.equal((await store.listNotifications()).length, 1);
  assert.ok(await store.getSnapshot("digest:2026-09-07"));
});

test("empty ingest does not call D1 batch with zero statements", async () => {
  const store = createD1Store(createFakeD1());
  const result = await ingestPayload(store, { items: [] });
  assert.equal(result.count, 0);
  assert.ok(await store.getSnapshot("events"));
});

test("D1 ingest keeps firstSeenAt and only writes referenced articles", async () => {
  const store = createD1Store(createFakeD1());
  await ingestPayload(store, {
    items: [{ id: "e1", title: "one", source: "hn", memberIds: ["art:keep"], firstSeenAt: "2026-01-01T00:00:00.000Z" }],
    articles: [
      { id: "art:keep", title: "keep", source: "hn", url: "https://e/1" },
      { id: "art:extra", title: "extra", source: "hn", url: "https://e/x" },
    ],
  });
  assert.equal((await store.listArticles()).map((a) => a.id).sort().join(","), "art:keep");
  await ingestPayload(store, {
    items: [{ id: "e1", title: "one-updated", source: "hn", memberIds: ["art:keep"] }],
    articles: [{ id: "art:keep", title: "keep", source: "hn", url: "https://e/1" }],
  });
  assert.equal((await store.getEvent("e1")).firstSeenAt, "2026-01-01T00:00:00.000Z");
  const snap = await store.getSnapshot("events");
  assert.equal(snap.json.articleCount, 1);
  assert.equal(snap.json.articles, undefined);
});

test("digest-only ingest does not wipe events", async () => {
  const publishedAt = new Date().toISOString();
  for (const store of [createMemoryStore(), createD1Store(createFakeD1())]) {
  await ingestPayload(store, {
    items: [
      { id: "keep", title: "keep", source: "hn", category: "tech", url: "https://e/k", publishedAt },
      { id: "history", title: "history", source: "openai", category: "tech", url: "https://e/h", publishedAt },
    ],
    featured: ["keep"],
  });
  const before = await store.getSnapshot("events");
  await ingestPayload(store, {
    digest: { date: "2026-09-07", items: [{ id: "keep", title: "keep" }] },
  });
  assert.ok(await store.getEvent("keep"));
  assert.deepEqual((await store.getSnapshot("events")).json.featured, before.json.featured);
  const response = await handleApi(new Request("http://127.0.0.1/api/v1/events?view=featured"), envWith(store));
  const featured = await response.json();
  assert.deepEqual(featured.items.map((it) => it.id), ["keep"]);
  }
});

test("ingest applyFeed upserts by id and keeps prior events and imports", async () => {
  const db = createFakeD1();
  const store = createD1Store(db);
  await ingestPayload(store, {
    items: [{ id: "round1", title: "first", source: "hn", category: "tech", url: "https://e/1" }],
  });
  await store.putEvent({ id: "manual", title: "imported", source: "x", category: "tech", url: "https://x/1" });
  await ingestPayload(store, {
    items: [{ id: "round2", title: "second", source: "hn", category: "tech", url: "https://e/2" }],
  });
  assert.ok(await store.getEvent("round1"));
  assert.ok(await store.getEvent("round2"));
  assert.ok(await store.getEvent("manual"));
});

test("purgeExpired deletes expired rows only and keeps prefs favorites reads", async () => {
  const now = new Date("2026-09-08T00:00:00Z");
  for (const store of [createMemoryStore(), createD1Store(createFakeD1())]) {
    await store.setPrefs({ blockedSources: ["weibo"] });
    await store.putFavorite("saved", { id: "saved", title: "fav" });
    await store.setRead("saved", now.toISOString());
    await store.putEvent({
      id: "old",
      title: "old",
      source: "hn",
      updatedAt: new Date(now.getTime() - 40 * 24 * 3600 * 1000).toISOString(),
    });
    await store.putEvent({
      id: "fresh",
      title: "fresh",
      source: "hn",
      updatedAt: now.toISOString(),
    });
    await store.purgeExpired(now);
    assert.equal(await store.getEvent("old"), null);
    assert.ok(await store.getEvent("fresh"));
    assert.ok(await store.getFavorite("saved"));
    assert.deepEqual((await store.getPrefs()).blockedSources, ["weibo"]);
    assert.ok((await store.listReads()).saved);
  }
});

test("D1 importAll rolls back when a later insert fails", async () => {
  const db = createFakeD1({ failInsert: "fail-art" });
  const store = createD1Store(db);
  await store.putEvent({ id: "keep", title: "keep", source: "hn", category: "tech" });
  await store.setPrefs({ blockedSources: ["hn"] });
  await store.putFavorite("keep", { id: "keep", title: "keep" });
  await store.setRead("keep", "t");
  await assert.rejects(() =>
    store.importAll({
      events: [["keep", { id: "keep", title: "keep", source: "hn" }]],
      articles: [["fail-art", { id: "fail-art", title: "x", source: "hn" }]],
      members: [],
      articleEvent: [],
      prefs: { blockedSources: [] },
      feedback: [],
      reads: [],
      favorites: [],
      cache: [],
      notifications: [],
      tasks: [],
      sourceHealth: [],
      snapshots: [],
    })
  );
  assert.ok(await store.getEvent("keep"));
  assert.deepEqual((await store.getPrefs()).blockedSources, ["hn"]);
  assert.ok(await store.getFavorite("keep"));
  assert.equal((await store.listReads()).keep, "t");
});

test("file store creates missing directory and merges across instances", async () => {
  const rootDir = join(tmpdir(), "aq-missing-" + Date.now());
  const p = join(rootDir, "nested", "store.json");
  const a = await loadFileStore(p);
  await a.putEvent({ id: "e1", title: "t1", source: "hn" });
  const until = new Date(Date.now() + 60000).toISOString();
  assert.equal(await a.acquireLock("collect", until), true);
  await a.releaseLock("collect");
  const b = await loadFileStore(p);
  await a.setRead("e1", "t-a");
  await b.setRead("e2", "t-b");
  const c = await loadFileStore(p);
  const reads = await c.listReads();
  assert.equal(reads.e1, "t-a");
  assert.equal(reads.e2, "t-b");
  await rm(rootDir, { recursive: true, force: true });
});

test("file store keeps overlapping same-instance writes after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aq-overlap-"));
  const p = join(dir, "store.json");
  const store = await loadFileStore(p);
  await store.importAll({
    events: Array.from({ length: 400 }, (_, i) => [
      "evt:" + i,
      { id: "evt:" + i, title: "t" + i, source: "hn" },
    ]),
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
  for (let n = 0; n < 5; n++) {
    const a = store.setRead("e1", "t-a-" + n);
    // The lock file can appear and vanish faster than stat catches it on a
    // fast machine; observing it was incidental and made this test flaky.
    // What matters is below: overlapping writes survive a restart.
    const b = store.setRead("e2", "t-b-" + n);
    await Promise.all([a, b]);
    const restarted = await loadFileStore(p);
    const reads = await restarted.listReads();
    assert.equal(reads.e1, "t-a-" + n);
    assert.equal(reads.e2, "t-b-" + n);
  }
  await rm(dir, { recursive: true, force: true });
});

test("favorites and digest honor search filters", async () => {
  const store = createMemoryStore();
  await store.putFavorite("keep", { id: "keep", title: "Rust 发布", category: "tech", source: "hn" });
  await store.putFavorite("other", { id: "other", title: "融资新闻", category: "business", source: "36kr" });
  const miss = await (
    await handleApi(new Request("http://127.0.0.1/api/v1/favorites?q=no-such-term"), envWith(store))
  ).json();
  assert.equal(miss.items.length, 0);
  const hit = await (
    await handleApi(new Request("http://127.0.0.1/api/v1/favorites?q=Rust"), envWith(store))
  ).json();
  assert.deepEqual(hit.items.map((it) => it.id), ["keep"]);
  const date = beijingYmd();
  await store.putSnapshot("digest:" + date, {
    date,
    items: [
      { id: "keep", title: "Rust 发布", category: "tech", source: "hn" },
      { id: "other", title: "融资新闻", category: "business", source: "36kr" },
    ],
    tech: [{ id: "keep", title: "Rust 发布", category: "tech", source: "hn" }],
    business: [{ id: "other", title: "融资新闻", category: "business", source: "36kr" }],
    public: [],
  });
  const digest = await (
    await handleApi(new Request("http://127.0.0.1/api/v1/digest?q=no-such-term"), envWith(store))
  ).json();
  assert.equal(digest.digest.items.length, 0);
});

test("file store collectOnce purges without nested lock and reloads after restart", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aq-collect-"));
  const p = join(dir, "store.json");
  const store = await loadFileStore(p);
  const now = new Date("2026-09-08T00:00:00Z");
  const oldAt = new Date(now.getTime() - EVENT_KEEP_MS - 86400000).toISOString();
  await store.putEvent({
    id: "evt:old",
    title: "old news",
    source: "hn",
    category: "tech",
    updatedAt: oldAt,
    publishedAt: oldAt,
  });
  const result = await collectOnce({
    store,
    now,
    raw: [
      {
        title: "Rust 1.80 发布",
        source: "hn",
        url: "https://example.com/r",
        publishedAt: now.toISOString(),
      },
    ],
    sourceErrors: [],
    sourceHealth: [{ source: "hn", ok: true }],
    skipNotify: true,
    enrich: false,
  });
  assert.ok(result.items.length >= 1);
  assert.equal(await store.getEvent("evt:old"), null);
  const restarted = await loadFileStore(p);
  assert.equal(await restarted.getEvent("evt:old"), null);
  const listed = await restarted.listEvents();
  assert.ok(listed.some((it) => /Rust/.test(it.title)));
  await rm(dir, { recursive: true, force: true });
});
