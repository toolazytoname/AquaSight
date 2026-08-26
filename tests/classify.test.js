import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classify.js";

test("case zhu rongji death -> breaking", () => {
  const r = classify({
    title: "\u6731\u9555\u57fa\u53bb\u4e16",
    source: "weibo",
    rank: 2,
  });
  assert.equal(r.level, "breaking");
});

test("case DeepSeek market cap -> breaking", () => {
  const r = classify({
    title: "DeepSeek \u65f6\u523b\u5bfc\u81f4\u82f1\u4f1f\u8fbe\u5e02\u503c\u84b8\u53d1",
    source: "36kr",
  });
  assert.equal(r.level, "breaking");
});

test("case K3 beat -> breaking", () => {
  const r = classify({
    title: "K3 \u53d1\u5e03\u5982\u4f55\u540a\u6253\u56fd\u5916\u5927\u6a21\u578b",
    source: "hn",
  });
  assert.equal(r.level, "breaking");
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
  const r = classify({
    title: "\u80d6\u4e1c\u6765",
    source: "weibo",
    rank: 1,
  });
  assert.equal(r.level, "normal");
});

test("hello saturday hot rank 2 -> normal", () => {
  const r = classify({
    title: "\u4f60\u597d\u661f\u671f\u516d",
    source: "weibo",
    rank: 2,
  });
  assert.equal(r.level, "normal");
});

test("bbc + 36kr same title heat 2 stays normal", () => {
  const title = "plain same title no impact";
  const r = classify({ title, source: "bbc" }, [
    { title, source: "36kr" },
  ]);
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
  assert.equal(
    classify({ title: "印度去世乞丐家中有30多个麻袋现金", source: "weibo" }).level,
    "normal"
  );
});

test("notable death and designer death -> breaking", () => {
  assert.equal(classify({ title: "朱镕基去世", source: "weibo" }).level, "breaking");
  assert.equal(
    classify({ title: "歼轰7飞机总设计师陈一坚逝世", source: "toutiao" }).level,
    "breaking"
  );
});

test("earthquake still hard impact", () => {
  assert.equal(
    classify({ title: "四川宜宾市长宁县发生4.7级地震", source: "baidu" }).level,
    "breaking"
  );
});

test("pangdonglai still normal with rank", () => {
  const r = classify({
    title: "胖东来",
    source: "weibo",
    rank: 1,
  });
  assert.equal(r.level, "normal");
});

test("single-source market cap without lab -> normal", () => {
  const r = classify({
    title: "某某公司市值蒸发",
    source: "weibo",
  });
  assert.equal(r.level, "normal");
});

test("crash still hard impact", () => {
  const r = classify({
    title: "股市崩盘",
    source: "weibo",
  });
  assert.equal(r.level, "breaking");
});
