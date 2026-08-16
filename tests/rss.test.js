import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRss, stripHtml } from "../src/rss.js";
import { sourceFamily, TECH_SOURCES, WORLD_SOURCES } from "../src/classify.js";

test("parseRss extracts title url and stripped summary", () => {
  const xml =
    "<rss><channel>" +
    "<item><title>甲</title><link>https://example.com/a</link>" +
    "<description><![CDATA[<p>摘要一二三</p>]]></description></item>" +
    "<item><title>无链</title></item>" +
    "</channel></rss>";
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "甲");
  assert.equal(items[0].url, "https://example.com/a");
  assert.equal(items[0].summary, "摘要一二三");
});

test("stripHtml clips tags", () => {
  assert.equal(stripHtml("<p>你好 <strong>世界</strong></p>"), "你好 世界");
});

test("ithome qbitai v2ex are tech; wallstreetcn is world set not family yet", () => {
  assert.equal(sourceFamily("ithome"), "tech");
  assert.equal(sourceFamily("qbitai"), "tech");
  assert.equal(sourceFamily("v2ex"), "tech");
  assert.ok(TECH_SOURCES.has("ithome"));
  assert.ok(WORLD_SOURCES.has("wallstreetcn"));
  assert.equal(sourceFamily("wallstreetcn"), "other");
});
