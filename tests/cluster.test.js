import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, classifyCard, shouldMerge } from "../src/cluster.js";

test("pangdonglai -> normal", () => {
  const cards = cluster([
    { id: "weibo:pdl", title: "胖东来", source: "weibo", rank: 1 },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "normal");
});

test("DeepSeek market cap -> breaking", () => {
  const cards = cluster([
    {
      id: "36kr:ds",
      title: "DeepSeek 时刻导致英伟达市值蒸发",
      source: "36kr",
    },
  ]);
  assert.equal(cards[0].level, "breaking");
});

test("K3 beat -> breaking", () => {
  const cards = cluster([
    {
      id: "hn:k3",
      title: "K3 发布如何吊打国外大模型",
      source: "hn",
    },
  ]);
  assert.equal(cards[0].level, "breaking");
});

test("death -> breaking", () => {
  const cards = cluster([
    { id: "weibo:zhu", title: "朱镕基去世", source: "weibo", rank: 2 },
  ]);
  assert.equal(cards[0].level, "breaking");
});

test("DeepSeek R1 + 开源市值蒸发 merge into one breaking card with 2 sources", () => {
  const cards = cluster([
    {
      id: "hn:r1",
      title: "DeepSeek R1 发布",
      source: "hn",
      url: "https://news.ycombinator.com/item?id=1",
    },
    {
      id: "36kr:nvda",
      title: "DeepSeek 开源致英伟达市值蒸发",
      source: "36kr",
      url: "https://36kr.com/example",
    },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "breaking");
  assert.equal(cards[0].sources.length, 2);
  const srcs = cards[0].sources.map((s) => s.source).sort();
  assert.deepEqual(srcs, ["36kr", "hn"]);
});

test("hello saturday does not merge with DeepSeek", () => {
  const a = { id: "weibo:sat", title: "你好星期六", source: "weibo", rank: 2 };
  const b = {
    id: "hn:ds",
    title: "DeepSeek R1 发布",
    source: "hn",
  };
  assert.equal(shouldMerge(a, b), false);
  const cards = cluster([a, b]);
  assert.equal(cards.length, 2);
});

test("classifyCard veto without hard impact is normal", () => {
  const r = classifyCard([{ title: "胖东来", source: "weibo" }]);
  assert.equal(r.level, "normal");
});

test("bbc + 36kr same title cluster is breaking across world+tech", () => {
  const cards = cluster([
    { id: "bbc:a", title: "DeepSeek open weights", source: "bbc", url: "https://bbc.test/a" },
    { id: "36kr:a", title: "DeepSeek open weights", source: "36kr", url: "https://36kr.test/a" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "breaking");
  const srcs = cards[0].sources.map((s) => s.source).sort();
  assert.deepEqual(srcs, ["36kr", "bbc"]);
});
