import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../src/classify.js";
import {
  isHotEntertainment,
  normalListForPage,
  breakingListForPage,
} from "../src/display.js";
import { publicItem } from "../src/compat.js";
import { cardBody, readingMarks } from "../web/rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("hot entertainment is dropped from featured", () => {
  const items = [
    { id: "weibo:show", title: "某明星演唱会", source: "weibo", level: "normal", score: 9, category: "hidden" },
    { id: "hn:ok", title: "Rust compiler release notes", source: "hn", level: "normal", score: 3, category: "tech", value: 0.8, subject: "rust" },
  ];
  const out = normalListForPage(items);
  assert.deepEqual(out.map((x) => x.id), ["hn:ok"]);
  assert.equal(isHotEntertainment(items[0]), true);
});

test("single source cannot fill the whole featured list", () => {
  const items = [];
  for (let i = 1; i <= 31; i++) {
    items.push({
      id: "hn:" + i,
      title: "Hello world item " + i,
      source: "hn",
      level: "normal",
      category: "tech",
      subject: "s" + i,
      score: i,
      value: i / 40,
    });
  }
  const out = normalListForPage(items);
  assert.ok(out.length <= 6);
  assert.equal(out.filter((x) => x.source === "hn").length <= 6, true);
});

test("breaking list still returns breaking items", () => {
  const items = [
    { id: "hn:break", title: "OpenAI launches GPT-5", source: "hn", level: "breaking", score: 9, category: "tech" },
  ];
  const br = breakingListForPage(items);
  assert.deepEqual(br.map((x) => x.id), ["hn:break"]);
});

test("classify entertainment stays normal", () => {
  const a = classify({ title: "某明星演唱会", source: "weibo" });
  assert.equal(a.level, "normal");
});

test("app.js hides raw scores and uses Chinese nav", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  const html = await readFile(join(root, "web/index.html"), "utf8");
  assert.match(html, /精选/);
  assert.match(html, /早报/);
  assert.match(html, /收藏/);
  assert.equal(js.includes("分数"), false);
  assert.match(js, /Asia\/Shanghai/);
});

test("snapshot projection keeps credibility fields", () => {
  const out = publicItem({
    id: "e1",
    title: "t",
    overviewZh: "概述",
    impact: "影响说明",
    evidence: ["证据1"],
    uncertainty: ["不确定"],
    attribution: [{ claim: "企业自报", source: "36kr" }],
    enrichInsufficient: false,
  });
  assert.equal(out.impact, "影响说明");
  assert.deepEqual(out.evidence, ["证据1"]);
  assert.deepEqual(out.uncertainty, ["不确定"]);
  assert.equal(out.attribution[0].claim, "企业自报");
});

test("card body labels excerpt and empty summaries", () => {
  assert.equal(cardBody({ overviewZh: "中文概述" }).kind, "overview");
  assert.equal(cardBody({ summary: "long raw article" }).kind, "excerpt");
  assert.equal(cardBody({ title: "HN only" }).kind, "empty");
});

test("readingMarks distinguish prepared translation and pending latin news", () => {
  const ready = readingMarks({
    title: "OpenAI launches GPT-5 API",
    titleZh: "OpenAI 发布 GPT-5 接口",
    overviewZh: "官方发布，API 现已可用。",
    facts: ["API 可用"],
    impact: "开发者可接入。",
  });
  assert.equal(ready.prepared, true);
  assert.equal(ready.translated, true);
  assert.equal(ready.pending, false);
  const pending = readingMarks({ title: "DeepSeek launching v4.1 flash cheaper" });
  assert.equal(pending.pending, true);
  assert.equal(pending.prepared, false);
  const local = readingMarks({ title: "苹果发布会倒计时", source: "ithome" });
  assert.equal(local.pending, false);
  assert.equal(local.prepared, false);
});
