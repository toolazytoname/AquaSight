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
    { id: "weibo:award", title: "金鹰奖提名名单", source: "weibo", level: "normal", score: 6 },
    { id: "weibo:drop", title: "杨幂掉提", source: "weibo", level: "normal", score: 5 },
    { id: "weibo:drama", title: "双世宠妃男女主现状", source: "weibo", level: "normal", score: 4 },
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

test("app.js imports list helpers from rules.js", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(js, /from "\.\/rules\.js"/);
  assert.match(js, /normalListForPage/);
  assert.match(js, /breakingListForPage/);
  assert.match(js, /const normal = normalListForPage\(items\)/);
  assert.match(js, /const breaking = breakingListForPage\(items\)/);
});

test("normal list quotas mix families instead of filling with HN", () => {
  const items = [];
  for (let i = 1; i <= 20; i++) {
    items.push({
      id: "hn:" + i,
      title: "Hello HN " + i,
      source: "hn",
      level: "normal",
      score: 4,
    });
  }
  for (let i = 1; i <= 20; i++) {
    items.push({
      id: "github:" + i,
      title: "owner/repo" + i,
      source: "github",
      level: "normal",
      score: 4,
    });
  }
  for (let i = 1; i <= 8; i++) {
    items.push({
      id: "ithome:" + i,
      title: "IT之家条目" + i,
      source: "ithome",
      level: "normal",
      score: 4,
    });
  }
  for (let i = 1; i <= 8; i++) {
    items.push({
      id: "weibo:" + i,
      title: "社会新闻" + i,
      source: "weibo",
      level: "normal",
      score: 4,
    });
  }
  for (let i = 1; i <= 8; i++) {
    items.push({
      id: "bbc:" + i,
      title: "World news " + i,
      source: "bbc",
      level: "normal",
      score: 4,
    });
  }
  const out = normalListForPage(items);
  assert.equal(out.length, 30);
  const fam = { tech: 0, hot: 0, other: 0 };
  for (const it of out) {
    if (it.source === "weibo") fam.hot += 1;
    else if (it.source === "bbc") fam.other += 1;
    else fam.tech += 1;
  }
  assert.ok(fam.hot >= 8, "hot quota");
  assert.ok(fam.other >= 8, "world quota");
  assert.ok(fam.tech >= 12, "tech quota");
  assert.ok(out.some((x) => x.source === "ithome"));
  assert.ok(out.filter((x) => x.source === "hn").length < 20);
});
