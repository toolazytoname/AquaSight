import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { createBudget, MONTHLY_CNY, RESERVE_CNY } from "../src/budget.js";
import { collectOnce, digestOnce, maybeCatchUpDigest, digestSlotUtc } from "../src/pipeline.js";
import { enrichItems } from "../src/enrich.js";
import { selectDigest } from "../src/select.js";
import { loadRemotePrefs } from "../src/run.js";

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

test("budget commit cannot exceed reservation or monthly cap", async () => {
  const persist = [];
  const b = createBudget({ monthSpent: MONTHLY_CNY - RESERVE_CNY, daySpent: 0, reserved: 0, dayCandidates: 0, month: "2026-09", day: "2026-09-07" }, new Date("2026-09-07T00:00:00Z"), {
    persist: async (s) => persist.push({ ...s }),
  });
  const r = await b.reserve({ cny: RESERVE_CNY, now: new Date("2026-09-07T00:00:00Z") });
  assert.ok(persist.length >= 1);
  await b.commit(r, RESERVE_CNY + 1);
  const snap = b.snapshot();
  assert.ok(snap.monthSpent <= MONTHLY_CNY);
  await assert.rejects(() => b.reserve({ cny: RESERVE_CNY, now: new Date("2026-09-07T00:00:00Z") }));
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
