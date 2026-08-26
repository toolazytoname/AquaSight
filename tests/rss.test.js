import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRss, parseAtom, stripHtml } from "../src/rss.js";
import { sourceFamily, TECH_SOURCES, WORLD_SOURCES } from "../src/classify.js";

test("parseRss extracts title url and stripped summary", () => {
  const xml =
    "<rss><channel>" +
    "<item><title>甲</title><link>https://example.com/a</link>" +
    "<pubDate>Mon, 24 Aug 2026 08:00:00 GMT</pubDate>" +
    "<description><![CDATA[<p>摘要一二三</p>]]></description></item>" +
    "<item><title>无链</title></item>" +
    "</channel></rss>";
  const items = parseRss(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "甲");
  assert.equal(items[0].url, "https://example.com/a");
  assert.equal(items[0].summary, "摘要一二三");
  assert.equal(items[0].publishedAt, "2026-08-24T08:00:00.000Z");
});

test("stripHtml clips tags", () => {
  assert.equal(stripHtml("<p>你好 <strong>世界</strong></p>"), "你好 世界");
});

test("ithome qbitai v2ex techcrunch verge openai are tech; bbc wallstreetcn are world", () => {
  assert.equal(sourceFamily("ithome"), "tech");
  assert.equal(sourceFamily("qbitai"), "tech");
  assert.equal(sourceFamily("v2ex"), "tech");
  assert.equal(sourceFamily("techcrunch"), "tech");
  assert.equal(sourceFamily("verge"), "tech");
  assert.equal(sourceFamily("openai"), "tech");
  assert.ok(TECH_SOURCES.has("ithome"));
  assert.ok(WORLD_SOURCES.has("wallstreetcn"));
  assert.ok(WORLD_SOURCES.has("bbc"));
  assert.equal(sourceFamily("wallstreetcn"), "world");
  assert.equal(sourceFamily("bbc"), "world");
});

test("parseAtom uses link href and summary", () => {
  const xml =
    '<feed><entry><title type="html"><![CDATA[Verge甲]]></title>' +
    '<link rel="alternate" href="https://www.theverge.com/a" />' +
    '<summary type="html"><![CDATA[<p>摘要甲</p>]]></summary></entry></feed>';
  const items = parseAtom(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Verge甲");
  assert.equal(items[0].url, "https://www.theverge.com/a");
  assert.equal(items[0].summary, "摘要甲");
});
