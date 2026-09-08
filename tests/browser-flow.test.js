import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";

test("browser reading flow: featured, detail, search, favorite", async () => {
  const store = createMemoryStore();
  await store.putEvent({
    id: "evt:read",
    title: "OpenAI launches GPT-5 API",
    titleZh: "OpenAI 发布 GPT-5 接口",
    overviewZh: "官方发布，API 现已可用。",
    facts: ["API 可用", "面向开发者"],
    source: "openai",
    category: "tech",
    value: 0.9,
    subject: "openai",
    url: "https://openai.com/gpt5",
    publishedAt: "2026-09-02T10:00:00.000Z",
    sources: [{ source: "openai", url: "https://openai.com/gpt5", title: "OpenAI launches GPT-5 API" }],
  });
  const { server, port } = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + port;
  try {
    const html = await (await fetch(base + "/")).text();
    assert.match(html, /精选/);
    assert.match(html, /收藏/);
    const css = await fetch(base + "/style.css");
    assert.equal(css.ok, true);
    const list = await (await fetch(base + "/api/v1/events?view=featured")).json();
    assert.equal(list.apiVersion, "v1");
    assert.ok(list.items.some((it) => it.id === "evt:read"));
    const detail = await (await fetch(base + "/api/v1/events/evt:read")).json();
    assert.match(detail.item.titleZh, /GPT-5/);
    assert.ok(Array.isArray(detail.item.facts));
    const searched = await (await fetch(base + "/api/v1/events?q=GPT-5")).json();
    assert.ok(searched.items.length >= 1);
    const fav = await fetch(base + "/api/v1/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "evt:read" }),
    });
    assert.equal(fav.ok, true);
    const saved = await (await fetch(base + "/api/v1/favorites")).json();
    assert.equal(saved.items.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
