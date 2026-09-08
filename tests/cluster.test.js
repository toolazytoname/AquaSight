import { test } from "node:test";
import assert from "node:assert/strict";
import { cluster, classifyCard, shouldMerge } from "../src/cluster.js";

test("pangdonglai -> hidden/normal", () => {
  const cards = cluster([
    { id: "weibo:pdl", title: "胖东来", source: "weibo", rank: 1, url: "https://s.weibo.com/pdl" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].level, "normal");
  assert.equal(cards[0].category, "hidden");
});

test("same lab different products stay independent", () => {
  const cards = cluster(
    [
      {
        title: "OpenAI launches GPT-5 API",
        source: "openai",
        url: "https://openai.com/gpt5",
        publishedAt: "2026-09-02T10:00:00Z",
      },
      {
        title: "OpenAI launches Sora 2",
        source: "openai",
        url: "https://openai.com/sora2",
        publishedAt: "2026-09-02T11:00:00Z",
      },
    ],
    { now: new Date("2026-09-02T12:00:00Z") }
  );
  assert.equal(cards.length, 2);
});

test("lab plus publish word is not enough to merge", () => {
  assert.equal(
    shouldMerge(
      { title: "OpenAI launches GPT-5", source: "hn", url: "https://a.test/1", publishedAt: "2026-09-02T10:00:00Z" },
      { title: "OpenAI 发布新办公软件", source: "36kr", url: "https://b.test/2", publishedAt: "2026-09-02T10:00:00Z" },
      new Date("2026-09-02T12:00:00Z")
    ),
    false
  );
});

test("cross-language same product merges", () => {
  const cards = cluster(
    [
      {
        title: "OpenAI launches GPT-5 API",
        source: "openai",
        url: "https://openai.com/gpt5",
        publishedAt: "2026-09-02T10:00:00Z",
      },
      {
        title: "OpenAI 发布 GPT-5",
        source: "techcrunch",
        url: "https://techcrunch.com/gpt5",
        publishedAt: "2026-09-02T11:00:00Z",
      },
    ],
    { now: new Date("2026-09-02T12:00:00Z") }
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sources.length, 2);
});

test("hello saturday does not merge with DeepSeek", () => {
  const a = { id: "weibo:sat", title: "你好星期六", source: "weibo", rank: 2, url: "https://s.weibo.com/sat" };
  const b = { id: "hn:ds", title: "DeepSeek R1 发布", source: "hn", url: "https://hn.test/r1" };
  assert.equal(shouldMerge(a, b), false);
  const cards = cluster([a, b]);
  assert.equal(cards.length, 2);
});

test("same title different days stay independent", () => {
  const cards = cluster([
    {
      title: "DeepSeek R1 发布",
      source: "hn",
      url: "https://hn.test/old",
      publishedAt: "2026-01-01T00:00:00Z",
    },
    {
      title: "DeepSeek R1 发布",
      source: "36kr",
      url: "https://36kr.com/new",
      publishedAt: "2026-09-01T00:00:00Z",
    },
  ]);
  assert.equal(cards.length, 2);
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
      id: "36kr:earn" + i,
      title,
      source: "36kr",
      url: "https://36kr.com/e/" + i,
    }))
  );
  assert.equal(cards.length, 6);
});

test("durian same title weibo+baidu stay one card", () => {
  const title = "榴莲价格彻底崩了";
  const cards = cluster([
    { id: "weibo:d", title, source: "weibo", url: "https://s.weibo.com/d" },
    { id: "baidu:d", title, source: "baidu", url: "https://baidu.com/d" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sources.length, 2);
});

test("live earnings super-card titles stay split", () => {
  const cards = cluster([
    { title: "石头科技：上半年净利润9.86亿元，同比增长45.60%", source: "36kr", url: "https://36kr.com/s" },
    { title: "中矿资源：上半年净利润11.11亿元，同比增长1146.81%", source: "36kr", url: "https://36kr.com/m" },
    { title: "晶丰明源：上半年净利润8654.71万元，同比增长449.09%", source: "36kr", url: "https://36kr.com/c" },
  ]);
  assert.equal(cards.length, 3);
});

test("html-only summaries are dropped from cards", () => {
  const cards = cluster([
    {
      id: "hn:html",
      title: "Hello world title keep",
      source: "hn",
      url: "https://example.com/h",
      summary: '<a href="https://xcancel.com/x">https://xcancel.com/x</a>',
    },
  ]);
  assert.equal("summary" in cards[0], false);
});

test("classifyCard entertainment is not breaking", () => {
  const r = classifyCard([{ title: "胖东来", source: "weibo", url: "https://s.weibo.com/p" }]);
  assert.equal(r.level, "normal");
});

test("event ids are unique in a cluster output", () => {
  const cards = cluster([
    { title: "Rust 1.80 release", source: "hn", url: "https://hn.test/1" },
    { title: "Go 1.23 release", source: "hn", url: "https://hn.test/2" },
    { title: "Rust 1.80 release", source: "ithome", url: "https://ithome.com/1" },
  ]);
  const ids = cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("evt:")));
});
