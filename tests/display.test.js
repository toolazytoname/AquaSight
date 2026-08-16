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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("hot entertainment is dropped from normal list", () => {
  const items = [
    { id: "weibo:show", title: "某明星演唱会", source: "weibo", level: "normal", score: 9 },
    { id: "toutiao:var", title: "新综艺晚会", source: "toutiao", level: "normal", score: 8 },
    { id: "baidu:veto", title: "你好星期六", source: "baidu", level: "normal", score: 7 },
    { id: "hn:ok", title: "Hello world title keep", source: "hn", level: "normal", score: 3 },
  ];
  const out = normalListForPage(items);
  assert.deepEqual(out.map((x) => x.id), ["hn:ok"]);
  assert.equal(isHotEntertainment(items[0]), true);
});

test("31st normal item is sliced off", () => {
  const items = [];
  for (let i = 1; i <= 31; i++) {
    items.push({
      id: "hn:" + i,
      title: "Hello world item " + i,
      source: "hn",
      level: "normal",
      score: i,
    });
  }
  const out = normalListForPage(items);
  assert.equal(out.length, 30);
  assert.equal(out[0].id, "hn:31");
  assert.equal(out[29].id, "hn:2");
  assert.equal(out.some((x) => x.id === "hn:1"), false);
});

test("breaking items are unaffected by entertainment filter and cap", () => {
  const items = [
    { id: "weibo:show", title: "某明星演唱会", source: "weibo", level: "breaking", score: 2 },
    { id: "hn:break", title: "Hello world breaking", source: "hn", level: "breaking", score: 9 },
  ];
  const br = breakingListForPage(items);
  assert.deepEqual(br.map((x) => x.id), ["hn:break", "weibo:show"]);
  const normal = normalListForPage(items);
  assert.equal(normal.length, 0);
});

test("classify behavior unchanged for entertainment titles", () => {
  const a = classify({ title: "某明星演唱会", source: "weibo" });
  assert.equal(a.level, "normal");
  const b = classify({ title: "你好星期六", source: "weibo" });
  assert.equal(b.level, "normal");
});

test("app.js uses normalListForPage and cap 30", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(js, /function normalListForPage/);
  assert.match(js, /function breakingListForPage/);
  assert.match(js, /\.slice\(0, 30\)/);
  assert.match(js, /ENT_DISPLAY_RE/);
  assert.match(js, /const normal = normalListForPage\(items\)/);
  assert.match(js, /const breaking = breakingListForPage\(items\)/);
});
