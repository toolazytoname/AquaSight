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

test("cremation or remains alone -> normal", () => {
  const a = cluster([{ id: "weibo:h", title: "现场火化", source: "weibo" }]);
  assert.equal(a[0].level, "normal");
  const b = cluster([{ id: "weibo:y", title: "遗体告别", source: "weibo" }]);
  assert.equal(b[0].level, "normal");
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

test("publishedAt 80h ago decays even if seenAt is now", () => {
  const publishedAt = new Date(Date.now() - 80 * 3600 * 1000).toISOString();
  const seenAt = new Date().toISOString();
  const title = "plain same title no impact";
  const cards = cluster([
    { id: "weibo:a", title, source: "weibo", publishedAt, seenAt },
    { id: "baidu:a", title, source: "baidu", publishedAt, seenAt },
    { id: "36kr:a", title, source: "36kr", publishedAt, seenAt },
  ]);
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
      id: "36kr:earn" + i,
      title,
      source: "36kr",
    }))
  );
  assert.equal(cards.length, 6);
});

test("durian same title weibo+baidu stay one card", () => {
  const title = "榴莲价格彻底崩了";
  const cards = cluster([
    { id: "weibo:d", title, source: "weibo" },
    { id: "baidu:d", title, source: "baidu" },
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].sources.length, 2);
});

test("live earnings super-card titles stay split", () => {
  const cards = cluster([
    {
      id: "36kr:stone",
      title: "石头科技：上半年净利润9.86亿元，同比增长45.60%",
      source: "36kr",
    },
    {
      id: "36kr:min",
      title: "中矿资源：上半年净利润11.11亿元，同比增长1146.81%",
      source: "36kr",
    },
    {
      id: "36kr:chip",
      title: "晶丰明源：上半年净利润8654.71万元，同比增长449.09%",
      source: "36kr",
    },
  ]);
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.level === "normal"));
});

test("gossip death is normal; notable death is breaking", () => {
  assert.equal(
    cluster([{ id: "weibo:cake", title: "成都蛋烘糕奶奶儿子已因病去世", source: "weibo" }])[0]
      .level,
    "normal"
  );
  assert.equal(
    cluster([{ id: "toutiao:x", title: "二婚夫妇意外去世 4个子女争遗产", source: "toutiao" }])[0]
      .level,
    "normal"
  );
  assert.equal(
    cluster([{ id: "weibo:beg", title: "印度去世乞丐家中有30多个麻袋现金", source: "weibo" }])[0]
      .level,
    "normal"
  );
  assert.equal(
    cluster([{ id: "weibo:zhu", title: "朱镕基去世", source: "weibo" }])[0].level,
    "breaking"
  );
  assert.equal(
    cluster([
      {
        id: "toutiao:chen",
        title: "歼轰7飞机总设计师陈一坚逝世",
        source: "toutiao",
      },
    ])[0].level,
    "breaking"
  );
});

test("html-only summaries are dropped from cards", () => {
  const cards = cluster([
    {
      id: "hn:html",
      title: "Hello world title keep",
      source: "hn",
      summary: '<a href="https://xcancel.com/x">https://xcancel.com/x</a>',
    },
  ]);
  assert.equal("summary" in cards[0], false);
});

test("stable id stays when a second source joins", () => {
  const first = cluster([
    { id: "hn:r1", title: "DeepSeek R1 发布", source: "hn" },
  ]);
  const second = cluster([
    { id: "hn:r1", title: "DeepSeek R1 发布", source: "hn" },
    { id: "36kr:nvda", title: "DeepSeek 开源致英伟达市值蒸发", source: "36kr" },
  ]);
  assert.equal(first[0].id, second[0].id);
  assert.equal(first[0].id, "card:deepseek");
  assert.deepEqual(second[0].memberIds.sort(), ["36kr:nvda", "hn:r1"]);
});
