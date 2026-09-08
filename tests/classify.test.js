import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, classifyMembers } from "../src/classify.js";

test("ordinary obituary is not breaking", () => {
  const r = classify({ title: "张三去世", source: "weibo", url: "https://s.weibo.com/z" });
  assert.equal(r.level, "normal");
  assert.equal(r.notifyEligible, false);
});

test("old disaster review is not breaking", () => {
  const r = classifyMembers(
    [
      {
        title: "十年前地震回顾",
        source: "bbc",
        url: "https://bbc.test/eq",
        publishedAt: "2026-09-01T00:00:00Z",
      },
    ],
    new Date("2026-09-07T00:00:00Z")
  );
  assert.equal(r.level, "normal");
  assert.equal(r.notifyEligible, false);
});

test("English official tech release is a related candidate", () => {
  const r = classifyMembers(
    [
      {
        title: "OpenAI launches GPT-5 API",
        source: "openai",
        url: "https://openai.com/gpt5",
        publishedAt: new Date().toISOString(),
      },
    ],
    new Date()
  );
  assert.equal(r.category, "tech");
  assert.equal(r.notifyEligible, true);
});

test("plain HN -> normal", () => {
  const r = classify({
    title: "Show HN: a tiny CSS framework for forms",
    source: "hn",
    url: "https://news.ycombinator.com/item?id=1",
  });
  assert.equal(r.level, "normal");
});

test("plain GitHub -> normal", () => {
  const r = classify({
    title: "leftpad-utils: small string helpers",
    source: "github",
    url: "https://github.com/example/leftpad-utils",
  });
  assert.equal(r.level, "normal");
});

test("pangdonglai hot rank 1 -> normal", () => {
  const r = classify({ title: "胖东来", source: "weibo", rank: 1 });
  assert.equal(r.level, "normal");
});

test("hello saturday hot rank 2 -> normal", () => {
  const r = classify({ title: "你好星期六", source: "weibo", rank: 2 });
  assert.equal(r.level, "normal");
});

test("cremation remains -> normal", () => {
  const r = classify({ title: "遗体火化", source: "weibo" });
  assert.equal(r.level, "normal");
});

test("gossip death stays normal", () => {
  assert.equal(
    classify({ title: "成都蛋烘糕奶奶儿子已因病去世", source: "weibo" }).level,
    "normal"
  );
  assert.equal(
    classify({ title: "二婚夫妇意外去世 4个子女争遗产", source: "toutiao" }).level,
    "normal"
  );
});

test("notable death is not auto-breaking", () => {
  assert.equal(classify({ title: "朱镕基去世", source: "weibo" }).level, "normal");
  assert.equal(
    classify({ title: "歼轰7飞机总设计师陈一坚逝世", source: "toutiao" }).level,
    "normal"
  );
});

test("bank content from 36kr is business", () => {
  const r = classifyMembers([
    { title: "招商银行：净利润增长，净息差走阔", source: "36kr", url: "https://36kr.com/cmb" },
  ]);
  assert.equal(r.category, "business");
});
