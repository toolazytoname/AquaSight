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
