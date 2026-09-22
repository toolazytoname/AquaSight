import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { verifyCode, requestCode, purgeAuthArtifacts } from "../src/auth.js";
import { fetchImported, assertSafeImportUrl, HARD_MAX_BYTES } from "../src/ssrf.js";
import { enrichItems, foreignUrls } from "../src/enrich.js";
import { readingMarks } from "../web/rules.js";

function envWith(store, extra = {}) {
  return { store, requireAuth: false, ...extra };
}

async function otpUserEnv(store, { email = "u@example.com", token = "tok-abc" } = {}) {
  await store.putUser({ id: "usr:1", email, createdAt: new Date().toISOString() });
  await store.putSession({
    id: "ses:1",
    userId: "usr:1",
    email,
    tokenHash: await crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(":" + token))
      .then((h) => [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("")),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
  });
  return { store, authMode: "otp", mailApiKey: "k" };
}

test("import-backup permission matrix: anonymous and OTP users blocked, no writes", async () => {
  const store = createMemoryStore();
  await store.putEvent({ id: "evt:keep", title: "t", source: "hn" });
  const dump = { events: [], articles: [] };

  const anonymous = await handleApi(
    new Request("http://x/api/v1/import-backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dump }),
    }),
    { store, authMode: "otp" }
  );
  assert.ok([401, 403].includes(anonymous.status), "anonymous status " + anonymous.status);

  const userEnv = await otpUserEnv(createMemoryStore());
  await userEnv.store.putEvent({ id: "evt:keep", title: "t", source: "hn" });
  const userStoreBefore = userEnv.store.listEvents();
  const user = await handleApi(
    new Request("http://x/api/v1/import-backup", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "aqs_session=tok-abc" },
      body: JSON.stringify({ dump }),
    }),
    { store: userEnv.store, authMode: "otp", mailApiKey: "k" }
  );
  assert.equal(user.status, 403);
  assert.equal((await userStoreBefore).length, 1);
  assert.equal((await userEnv.store.listEvents()).length, 1, "OTP user must not trigger any delete");

  const ingest = await handleApi(
    new Request("http://x/api/v1/import-backup", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer ingest-secret" },
      body: JSON.stringify({ dump }),
    }),
    { store, ingestToken: "ingest-secret", authMode: "otp" }
  );
  assert.equal(ingest.status, 403, "collector credential is not a site admin");
  assert.equal((await store.listEvents()).length, 1, "ingest role must not trigger any delete either");

  const local = await handleApi(
    new Request("http://x/api/v1/import-backup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dump: { events: [["e", { id: "e", title: "x", source: "hn" }]] } }),
    }),
    envWith(createMemoryStore())
  );
  assert.equal(local.status, 200);
});

test("export stays admin-gated for OTP users", async () => {
  const userEnv = await otpUserEnv(createMemoryStore());
  const res = await handleApi(
    new Request("http://x/api/v1/export", { headers: { cookie: "aqs_session=tok-abc" } }),
    { store: userEnv.store, authMode: "otp", mailApiKey: "k" }
  );
  assert.equal(res.status, 403);
});

test("OTP verifies exactly once under concurrent attempts", async () => {
  const store = createMemoryStore();
  await requestCode(store, { email: "race@example.com", ip: "1.1.1.1" }, { otpCode: "123456", exposeOtp: true });
  const attempts = await Promise.all([
    verifyCode(store, { email: "race@example.com", code: "123456" }),
    verifyCode(store, { email: "race@example.com", code: "123456" }),
  ]);
  const wins = attempts.filter((r) => r.ok).length;
  assert.equal(wins, 1, "exactly one concurrent verification may succeed");
  const sessions = await store.listSessions(
    (await store.getUserByEmail("race@example.com")).id
  );
  assert.equal(sessions.length, 1);
});

test("concurrent wrong guesses all count toward the attempt cap", async () => {
  const store = createMemoryStore();
  await requestCode(store, { email: "cap@example.com", ip: "1.1.1.1" }, { otpCode: "654321", exposeOtp: true });
  const wrongs = await Promise.all(
    Array.from({ length: 5 }, () => verifyCode(store, { email: "cap@example.com", code: "000000" }))
  );
  assert.ok(wrongs.every((r) => !r.ok));
  const late = await verifyCode(store, { email: "cap@example.com", code: "654321" });
  assert.ok(!late.ok, "correct code after exhausting attempts must fail");
});

test("request-code reports global mail outage without email enumeration", async () => {
  const store = createMemoryStore();
  const broken = await handleApi(
    new Request("http://x/api/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    }),
    { store, authMode: "otp" }
  );
  assert.equal((await broken.json()).delivery, "unavailable");

  const okMail = await handleApi(
    new Request("http://x/api/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "b@example.com" }),
    }),
    {
      store: createMemoryStore(),
      authMode: "otp",
      mailApiKey: "k",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }
  );
  assert.equal((await okMail.json()).delivery, "sent");

  const invalidMail = await handleApi(
    new Request("http://x/api/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "not-an-email" }),
    }),
    { store: createMemoryStore(), authMode: "otp", mailApiKey: "k" }
  );
  assert.equal((await invalidMail.json()).delivery, "sent", "invalid emails keep the generic answer");
});

test("personal import writes a private favorite, never the public pool", async () => {
  const userEnv = await otpUserEnv(createMemoryStore());
  const html = "<html><body><h1>Big AI news</h1><p>Body text here</p></body></html>";
  const res = await handleApi(
    new Request("http://x/api/v1/import", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "aqs_session=tok-abc" },
      body: JSON.stringify({ url: "https://example.com/article" }),
    }),
    {
      store: userEnv.store,
      authMode: "otp",
      mailApiKey: "k",
      fetchImpl: async () =>
        new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    }
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.private, true);
  assert.equal((await userEnv.store.listEvents()).length, 0, "no public events");
  assert.equal((await userEnv.store.listArticles()).length, 0, "no public articles");
  const favs = await userEnv.store.listFavorites({ userId: "usr:1" });
  assert.equal(favs.length, 1);
  assert.equal(favs[0].snapshot.source, "import");
  const other = await userEnv.store.listFavorites({ userId: "usr:other" });
  assert.equal(other.length, 0, "other accounts cannot see the import");
});

test("purgeAuthArtifacts removes expired otp, dead sessions and stale rate rows", async () => {
  const store = createMemoryStore();
  const now = new Date();
  await store.putOtp({
    email: "old@example.com",
    codeHash: "h",
    expiresAt: new Date(now.getTime() - 1000).toISOString(),
    attempts: 0,
    sentAt: "",
    ip: "",
  });
  await store.putOtp({
    email: "new@example.com",
    codeHash: "h",
    expiresAt: new Date(now.getTime() + 60000).toISOString(),
    attempts: 0,
    sentAt: "",
    ip: "",
  });
  const staleHourSlot = Math.floor((now.getTime() - 72 * 3600e3) / 3600e3);
  const freshHourSlot = Math.floor(now.getTime() / 3600e3);
  await store.bumpRate("email-h:a:" + staleHourSlot, 99);
  await store.bumpRate("email-h:b:" + freshHourSlot, 99);
  await purgeAuthArtifacts(store, now);
  assert.equal(await store.getOtp("old@example.com"), null);
  assert.ok(await store.getOtp("new@example.com"));
  assert.equal(store.tables.rates.has("email-h:a:" + staleHourSlot), false);
  assert.equal(store.tables.rates.has("email-h:b:" + freshHourSlot), true);
});

test("ssrf clamps client-provided caps to server ceilings", async () => {
  const spec = await assertSafeImportUrl("https://example.com/a", {
    maxBytes: 9e12,
    timeoutMs: 9e12,
    maxRedirects: 99,
    lookupImpl: async () => ["93.184.216.34"],
  });
  assert.equal(spec.maxBytes, HARD_MAX_BYTES);
  assert.ok(spec.timeoutMs <= 15000);
  assert.ok(spec.maxRedirects <= 3);
});

test("ssrf rejects binary content types", async () => {
  await assert.rejects(
    fetchImported("https://example.com/img", {
      fetchImpl: async () => new Response("", { status: 200, headers: { "content-type": "image/png" } }),
      lookupImpl: async () => ["93.184.216.34"],
    }),
    (e) => e.code === "IMPORT_CONTENT_TYPE"
  );
});

test("ssrf stops reading once the byte cap is exceeded", async () => {
  const chunk = "x".repeat(64 * 1024);
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulled++;
      controller.enqueue(new TextEncoder().encode(chunk));
    },
  });
  await assert.rejects(
    fetchImported("https://example.com/big", {
      maxBytes: 100_000,
      fetchImpl: async () => new Response(stream, { status: 200, headers: { "content-type": "text/html" } }),
      lookupImpl: async () => ["93.184.216.34"],
    }),
    (e) => e.code === "IMPORT_SIZE"
  );
  // 100KB cap with 64KB chunks: the reader must stop around chunk 2, long
  // before an unbounded producer could push arbitrary volumes.
  assert.ok(pulled <= 4, "reader pulled " + pulled + " chunks");
});

test("ssrf redirect chain shares one deadline", async () => {
  const fetchImpl = (url, opts = {}) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (String(url).includes("hop1")) {
          resolve(new Response(null, { status: 302, headers: { location: "https://example.com/hop2" } }));
        } else {
          resolve(new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
        }
      }, 400);
      if (opts.signal) {
        opts.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      }
    });
  await assert.rejects(
    fetchImported("https://example.com/hop1", {
      timeoutMs: 700,
      fetchImpl,
      lookupImpl: async () => ["93.184.216.34"],
    }),
    (e) => e.code === "IMPORT_TIMEOUT" || e.name === "AbortError" || /abort/i.test(String(e.message))
  );
});

function validEnrichmentPayload(overrides = {}) {
  return {
    category: "tech",
    entities: [],
    titleZh: "中文标题",
    overviewZh: "中文概述",
    facts: ["事实一"],
    impact: "",
    evidence: ["https://example.com/a 说错了"],
    uncertainty: [],
    attribution: [],
    insufficient: false,
    ...overrides,
  };
}

test("enrich persists real aiState per outcome", async () => {
  const item = { id: "e1", title: "T", summary: "S", url: "https://example.com/a", source: "hn" };
  const pricing = { usdPerMtokIn: 1, usdPerMtokOut: 2 };
  const respond = (payload) => async () =>
    new Response(
      JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  const ready = await enrichItems([item], { apiKey: "k", model: "m", fetchImpl: respond(validEnrichmentPayload()), ...pricing });
  assert.equal(ready[0].aiState, "ready");
  const queued = await enrichItems([item], { ...pricing, model: "m" });
  assert.equal(queued[0].aiState, "queued");
  const failed = await enrichItems([item], {
    apiKey: "k",
    model: "m",
    ...pricing,
    fetchImpl: async () => new Response("nope", { status: 500 }),
  });
  assert.equal(failed[0].aiState, "failed");
  const insufficient = await enrichItems([item], {
    apiKey: "k",
    model: "m",
    ...pricing,
    fetchImpl: respond(validEnrichmentPayload({ overviewZh: "", facts: [], insufficient: true })),
  });
  assert.equal(insufficient[0].aiState, "insufficient");
});

test("model citations outside the source set are scrubbed", async () => {
  const allowed = new Set(["example.com"]);
  assert.deepEqual(foreignUrls("见 https://example.com/a 和 https://evil.example/x", allowed), [
    "https://evil.example/x",
  ]);
  const item = {
    id: "e2",
    title: "T",
    summary: "S",
    url: "https://example.com/a",
    source: "hn",
  };
  const payload = validEnrichmentPayload({
    evidence: ["https://example.com/a 证实", "https://spin.example/made-up"],
    attribution: [{ claim: "说法", source: "https://hoax.example/why" }],
  });
  const out = await enrichItems([item], {
    apiKey: "k",
    model: "m",
    usdPerMtokIn: 1,
    usdPerMtokOut: 2,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }),
        { status: 200, headers: { "content-type": "application/json" } }
      ),
  });
  assert.equal(out[0].aiState, "ready");
  assert.deepEqual(out[0].evidence, ["https://example.com/a 证实"]);
  assert.deepEqual(out[0].attribution, []);
  assert.ok(out[0].uncertainty.some((u) => u.includes("来源之外")));
});

test("readingMarks trusts aiState over field-presence inference", () => {
  assert.equal(readingMarks({ aiState: "queued", title: "Some English Title" }).pending, true);
  assert.equal(readingMarks({ aiState: "ready", title: "Some English Title", titleZh: "中文" }).prepared, true);
  // English title, no fields, but state says failed: not "processing"
  assert.equal(readingMarks({ aiState: "failed", title: "Some English Title" }).pending, false);
  // legacy snapshot without aiState keeps the old inference
  assert.equal(readingMarks({ title: "Some English Title" }).pending, true);
});
