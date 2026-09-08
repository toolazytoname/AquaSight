import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFeatured, selectDigest, FEATURED_LIMIT, SOURCE_CAP, SUBJECT_CAP } from "../src/select.js";

function item(partial) {
  return {
    id: partial.id,
    title: partial.title || partial.id,
    source: partial.source,
    category: partial.category || "tech",
    subject: partial.subject || partial.id,
    value: partial.value ?? 0.5,
    score: partial.score ?? 50,
    level: "normal",
    url: "https://example.com/" + partial.id,
    publishedAt: partial.publishedAt,
  };
}

test("featured quota 18/9/3 with source and subject caps", () => {
  const items = [];
  for (let i = 0; i < 40; i++) {
    items.push(item({ id: "t" + i, source: "hn", category: "tech", subject: "s" + Math.floor(i / 4), value: 0.9 - i / 200 }));
  }
  for (let i = 0; i < 20; i++) {
    items.push(item({ id: "b" + i, source: "36kr", category: "business", subject: "b" + i, value: 0.8 }));
  }
  for (let i = 0; i < 10; i++) {
    items.push(item({ id: "p" + i, source: "bbc", category: "public", subject: "p" + i, value: 0.7 }));
  }
  const out = selectFeatured(items, { now: new Date("2026-09-07T00:00:00Z") });
  assert.ok(out.length <= FEATURED_LIMIT);
  assert.ok(out.filter((x) => x.source === "hn").length <= SOURCE_CAP);
  const bySubject = new Map();
  for (const it of out) {
    bySubject.set(it.subject, (bySubject.get(it.subject) || 0) + 1);
    assert.ok(bySubject.get(it.subject) <= SUBJECT_CAP);
  }
  assert.ok(out.filter((x) => x.category === "public").length <= 3);
});

test("bank news from 36kr does not fill tech quota", () => {
  const items = [
    item({
      id: "bank",
      title: "招商银行：净利润增长",
      source: "36kr",
      category: "business",
      value: 0.99,
    }),
    ...Array.from({ length: 20 }, (_, i) =>
      item({ id: "tech" + i, source: "hn", category: "tech", subject: "t" + i, value: 0.5 })
    ),
  ];
  const out = selectFeatured(items);
  assert.equal(out.find((x) => x.id === "bank")?.category, "business");
  assert.ok(out.filter((x) => x.category === "tech").length >= 1);
});

test("hidden items do not re-enter digest", () => {
  const items = [
    item({ id: "hide", title: "某明星演唱会", source: "weibo", category: "hidden", value: 0.99 }),
    item({ id: "ok", title: "Rust 1.80 发布", source: "hn", category: "tech", value: 0.8, publishedAt: new Date().toISOString() }),
  ];
  const featured = selectFeatured(items);
  const digest = selectDigest(items);
  assert.equal(featured.some((x) => x.id === "hide"), false);
  assert.equal(digest.some((x) => x.id === "hide"), false);
  assert.equal(digest.length, 1);
});

test("same source can place both tech and business in featured", () => {
  const items = [];
  for (let i = 0; i < 12; i++) {
    items.push(
      item({
        id: "kr-tech-" + i,
        source: "36kr",
        category: "tech",
        subject: "kt" + i,
        value: 0.95 - i * 0.001,
      })
    );
  }
  for (let i = 0; i < 12; i++) {
    items.push(
      item({
        id: "kr-biz-" + i,
        source: "36kr",
        category: "business",
        subject: "kb" + i,
        value: 0.9 - i * 0.001,
      })
    );
  }
  const out = selectFeatured(items);
  assert.ok(out.filter((x) => x.category === "business").length >= 1);
  assert.ok(out.filter((x) => x.category === "tech").length >= 1);
  assert.ok(out.filter((x) => x.source === "36kr").length <= SOURCE_CAP);
});

test("public quota is not padded", () => {
  const items = [
    item({ id: "t1", source: "hn", category: "tech", value: 0.8 }),
    item({ id: "p1", source: "bbc", category: "public", value: 0.8 }),
  ];
  const out = selectFeatured(items);
  assert.equal(out.filter((x) => x.category === "public").length, 1);
  assert.ok(out.length < 30);
});

test("clue-only events stay out of featured", () => {
  const items = [
    {
      id: "clue",
      title: "普通热搜词",
      source: "weibo",
      category: "tech",
      value: 0.9,
      sources: [{ source: "weibo", url: "https://s.weibo.com/x" }],
    },
  ];
  assert.equal(selectFeatured(items).length, 0);
});
