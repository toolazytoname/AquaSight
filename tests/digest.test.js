import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketSource, buildDigest } from "../src/digest.js";
import { selectDigest } from "../src/select.js";

test("source families still map", () => {
  assert.equal(bucketSource("ithome"), "tech");
  assert.equal(bucketSource("openai"), "tech");
  assert.equal(bucketSource("36kr"), "business");
  assert.equal(bucketSource("weibo"), "hot");
  assert.equal(bucketSource("bbc"), "other");
});

test("digest uses 6/3/1 and does not resurrect hidden", () => {
  const now = new Date("2026-09-07T00:00:00Z");
  const recent = "2026-09-06T12:00:00Z";
  const items = [
    { id: "t1", title: "Rust 编译器发布", source: "hn", category: "tech", value: 0.9, subject: "rust", publishedAt: recent },
    { id: "t2", title: "Linux 6.11", source: "ithome", category: "tech", value: 0.8, subject: "linux", publishedAt: recent },
    { id: "b1", title: "某公司净利润增长", source: "36kr", category: "business", value: 0.7, subject: "co", publishedAt: recent },
    { id: "p1", title: "强震发生", source: "bbc", category: "public", value: 0.6, subject: "eq", publishedAt: recent },
    { id: "h1", title: "某明星演唱会", source: "weibo", category: "hidden", value: 0.99, subject: "ent", publishedAt: recent },
  ];
  const d = buildDigest(items, now);
  assert.ok((d.tech || []).every((x) => x.category === "tech"));
  assert.equal((d.items || []).some((x) => x.id === "h1"), false);
  assert.ok((d.tech || []).length <= 6);
  assert.ok((d.business || []).length <= 3);
  assert.ok((d.public || []).length <= 1);
  const selected = selectDigest(items, { now });
  assert.equal(selected.some((x) => x.category === "hidden"), false);
});

test("digest does not pad public", () => {
  const items = [
    { id: "t1", title: "AI 模型发布", source: "hn", category: "tech", value: 0.9, subject: "ai", publishedAt: "2026-09-06T12:00:00Z" },
  ];
  const d = buildDigest(items, new Date("2026-09-07T00:00:00Z"));
  assert.equal((d.public || []).length, 0);
  assert.ok((d.items || []).length <= 10);
});
