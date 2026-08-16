import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketSource, buildDigest } from "../src/digest.js";

test("new sources follow three digest buckets", () => {
  assert.equal(bucketSource("ithome"), "tech");
  assert.equal(bucketSource("qbitai"), "tech");
  assert.equal(bucketSource("v2ex"), "tech");
  assert.equal(bucketSource("techcrunch"), "tech");
  assert.equal(bucketSource("verge"), "tech");
  assert.equal(bucketSource("openai"), "tech");
  assert.equal(bucketSource("toutiao"), "hot");
  assert.equal(bucketSource("weibo"), "hot");
  assert.equal(bucketSource("bbc"), "other");
  assert.equal(bucketSource("wallstreetcn"), "other");
});

test("buildDigest puts ithome in tech and bbc in other", () => {
  const d = buildDigest([
    { id: "ithome:1", title: "IT之家甲", source: "ithome", url: "https://ithome.com/a" },
    { id: "bbc:1", title: "BBC甲", source: "bbc", url: "https://bbc.test/a" },
    { id: "toutiao:1", title: "头条甲", source: "toutiao", url: "https://toutiao.test/a" },
  ]);
  assert.equal(d.tech[0].source, "ithome");
  assert.equal(d.other[0].source, "bbc");
  assert.equal(d.hot[0].source, "toutiao");
});

test("digest buckets sort by score desc, missing is 0, ties keep order", () => {
  const d = buildDigest([
    { id: "ithome:low", title: "低", source: "ithome", score: 1, url: "https://i/l" },
    { id: "ithome:high", title: "高", source: "ithome", score: 9, url: "https://i/h" },
    { id: "ithome:mid", title: "中", source: "ithome", score: 4, url: "https://i/m" },
    { id: "toutiao:low", title: "低", source: "toutiao", score: 2, url: "https://t/l" },
    { id: "toutiao:high", title: "高", source: "toutiao", score: 8, url: "https://t/h" },
    { id: "bbc:a", title: "A", source: "bbc", score: 3, url: "https://b/a" },
    { id: "bbc:b", title: "B", source: "bbc", url: "https://b/b" },
    { id: "wallstreetcn:x", title: "X", source: "wallstreetcn", score: 6, url: "https://w/x" },
  ]);
  assert.deepEqual(d.tech.map((x) => x.id), ["ithome:high", "ithome:mid", "ithome:low"]);
  assert.deepEqual(d.hot.map((x) => x.id), ["toutiao:high", "toutiao:low"]);
  assert.deepEqual(d.other.map((x) => x.id), ["wallstreetcn:x", "bbc:a", "bbc:b"]);
});

test("6th high-score item enters top 5, low score is sliced off", () => {
  const items = [];
  for (let i = 1; i <= 5; i++) {
    items.push({
      id: "ithome:low" + i,
      title: "低" + i,
      source: "ithome",
      score: i,
      url: "https://i/" + i,
    });
  }
  items.push({
    id: "ithome:late",
    title: "晚到高分",
    source: "ithome",
    score: 99,
    url: "https://i/late",
  });
  const d = buildDigest(items);
  assert.equal(d.tech.length, 5);
  assert.deepEqual(
    d.tech.map((x) => x.id),
    ["ithome:late", "ithome:low5", "ithome:low4", "ithome:low3", "ithome:low2"]
  );
});
