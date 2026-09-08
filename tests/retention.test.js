import { test } from "node:test";
import assert from "node:assert/strict";
import { purgeData, EVENT_KEEP_MS, RAW_KEEP_MS } from "../src/retention.js";
import { collectOnce } from "../src/pipeline.js";
import { createMemoryStore } from "../src/store/memory.js";

test("retention keeps favorites and drops expired events", () => {
  const now = new Date("2026-09-07T00:00:00Z");
  const old = new Date(now.getTime() - EVENT_KEEP_MS - 86400000).toISOString();
  const fresh = now.toISOString();
  const dumped = {
    events: [
      ["evt:old", { id: "evt:old", updatedAt: old, title: "old" }],
      ["evt:new", { id: "evt:new", updatedAt: fresh, title: "new" }],
    ],
    articles: [
      ["art:old", { id: "art:old", firstSeenAt: new Date(now.getTime() - RAW_KEEP_MS - 1000).toISOString() }],
      ["art:new", { id: "art:new", firstSeenAt: fresh }],
    ],
    articleEvent: [
      ["art:old", "evt:old"],
      ["art:new", "evt:new"],
    ],
    favorites: [["evt:old", { eventId: "evt:old", snapshot: { id: "evt:old", title: "saved" } }]],
  };
  const out = purgeData(dumped, now);
  const eventIds = out.events.map(([id]) => id);
  assert.equal(eventIds.includes("evt:new"), true);
  assert.equal(eventIds.includes("evt:old"), false);
  assert.equal(out.favorites.length, 1);
  assert.equal(out.favorites[0][0], "evt:old");
});

test("first collect is a silent baseline and does not notify", async () => {
  const store = createMemoryStore();
  const r = await collectOnce({
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
    skipLock: true,
    enrich: false,
    key: "k",
    fetchImpl: async () => {
      throw new Error("bark should not be called on baseline");
    },
  });
  const baseline = await store.getSnapshot("baseline-done");
  assert.ok(baseline);
  assert.equal(r.bark.attempted, 0);
  assert.equal(r.bark.silentBaseline, true);
});
