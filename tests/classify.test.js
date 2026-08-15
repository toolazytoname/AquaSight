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
