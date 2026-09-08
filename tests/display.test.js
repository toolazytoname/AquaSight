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
