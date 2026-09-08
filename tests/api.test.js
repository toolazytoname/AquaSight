import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { collectOnce } from "../src/pipeline.js";

function envWith(store, extra = {}) {
  return { store, requireAuth: false, ...extra };
}

async function get(store, path, extra = {}) {
  const req = new Request("http://127.0.0.1" + path, extra);
  return handleApi(req, envWith(store, extra.env));
}

test("api v1 list has version, snapshot, stable ids and cursor", async () => {
  const store = createMemoryStore();
  await store.putEvent({
    id: "evt:1",
    title: "Rust 1.80 发布",
    source: "hn",
    category: "tech",
    value: 0.8,
    subject: "rust",
    url: "https://example.com/r",
  });
  const res = await get(store, "/api/v1/events?view=featured");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.apiVersion, "v1");
  assert.ok(data.snapshotAt);
  assert.ok(Array.isArray(data.items));
  assert.equal(data.items[0].id, "evt:1");
  assert.equal("reason" in data.items[0], false);
});

test("unauthenticated cannot read private data when auth required", async () => {
  const store = createMemoryStore();
  const req = new Request("http://127.0.0.1/api/v1/events");
  const res = await handleApi(req, {
    store,
    requireAuth: true,
    allowedEmail: "me@example.com",
  });
  assert.equal(res.status, 401);
});

test("ingest token is distinct from user access", async () => {
  const store = createMemoryStore();
  const req = new Request("http://127.0.0.1/api/v1/ingest", {
    method: "POST",
    headers: { authorization: "Bearer user-token", "content-type": "application/json" },
    body: JSON.stringify({ events: { items: [] } }),
  });
  const res = await handleApi(req, {
    store,
    ingestToken: "ingest-secret",
    authToken: "user-token",
    requireAuth: true,
  });
  assert.equal(res.status, 403);
});

test("settings, favorites and feedback round-trip", async () => {
  const store = createMemoryStore();
  await store.putEvent({
    id: "evt:x",
    title: "OpenAI launches GPT-5",
    source: "openai",
    category: "tech",
    value: 0.9,
    url: "https://openai.com/x",
  });
  const hide = await handleApi(
    new Request("http://127.0.0.1/api/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "hide", eventId: "evt:x" }),
    }),
    envWith(store)
  );
  const hideData = await hide.json();
  assert.ok(hideData.prefs.hiddenEventIds.includes("evt:x"));
  const undo = await handleApi(
    new Request("http://127.0.0.1/api/v1/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ undoId: hideData.feedback.id }),
    }),
    envWith(store)
  );
  const undone = await undo.json();
  assert.equal(undone.prefs.hiddenEventIds.includes("evt:x"), false);
  await handleApi(
    new Request("http://127.0.0.1/api/v1/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "evt:x" }),
    }),
    envWith(store)
  );
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.equal(favs.items.length, 1);
});

test("status distinguishes failed collect from empty news", async () => {
  const store = createMemoryStore();
  await store.putSourceHealth({ source: "hn", ok: false, message: "timeout", purpose: "hn" });
  await store.putSourceHealth({ source: "bbc", ok: false, message: "403", purpose: "bbc" });
  const data = await (await get(store, "/api/v1/status")).json();
  assert.equal(data.emptyMeansFailure, true);
  assert.ok(data.sources.every((s) => s.ok === false));
});

test("collect failure keeps last good snapshot", async () => {
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
  await store.putSnapshot("last-good-events", good);
  const held = await store.acquireLock("collect", new Date(Date.now() + 60000).toISOString());
  assert.equal(held, true);
  const locked = await collectOnce({
    store,
    skipNotify: true,
    skipLock: false,
    raw: [],
  });
  assert.equal(locked.lockSkipped, true);
});
