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

test("two families two sources without impact stay normal", () => {
  const cards = cluster([
    { id: "bbc:a", title: "plain same title no impact", source: "bbc", url: "https://bbc.test/a" },
    { id: "36kr:a", title: "plain same title no impact", source: "36kr", url: "https://36kr.test/a" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "normal");
  assert.equal(cards[0].sources.length, 2);
});

test("cremation or remains -> breaking", () => {
  const a = cluster([{ id: "weibo:h", title: "现场火化", source: "weibo" }]);
  assert.equal(a[0].level, "breaking");
  const b = cluster([{ id: "weibo:y", title: "遗体告别", source: "weibo" }]);
  assert.equal(b[0].level, "breaking");
});

test("three sources two families within 3h -> breaking", () => {
  const seenAt = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  const title = "plain same title no impact";
  const cards = cluster([
    { id: "weibo:a", title, source: "weibo", seenAt },
    { id: "baidu:a", title, source: "baidu", seenAt },
    { id: "36kr:a", title, source: "36kr", seenAt },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "breaking");
});

test("three sources two families 80h ago -> normal", () => {
  const seenAt = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
  const title = "plain same title no impact";
  const cards = cluster([
    { id: "weibo:a", title, source: "weibo", seenAt },
    { id: "baidu:a", title, source: "baidu", seenAt },
    { id: "36kr:a", title, source: "36kr", seenAt },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "normal");
});

test("six 36kr half-year earnings stay six cards", () => {
  const titles = [
    "多氟多：上半年净利润5.12亿元，同比增长897.19%",
    "学大教育：上半年净利润3.01亿元，同比增长30.85%",
    "瑞芯微：上半年净利润8.59亿元，同比增长61.73%",
    "德科立：上半年净利润同比增长249.74%，拟10派1元",
    "北部湾港：上半年净利润同比增长5.09%，拟10派0.78元",
    "仲景食品：上半年净利润1.08亿元，同比增长7.75%",
  ];
  const cards = cluster(
    titles.map((title, i) => ({
      id: `36kr:earn${i}`,
      title,
      source: "36kr",
    }))
  );
  assert.equal(cards.length, 6);
});

test("durian same title weibo+baidu stay one card", () => {
  const title = "\u69df\u83b2\u4ef7\u683c\u5f7b\u5e95\u5d29\u4e86";
  const cards = cluster([
    { id: "weibo:d", title, source: "weibo" },
    { id: "baidu:d", title, source: "baidu" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sources.length, 2);
});
