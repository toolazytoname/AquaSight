import { test } from "node:test";
import assert from "node:assert/strict";
import { fetch36krArticles, fetch36krFlash } from "../src/sources/kr36.js";

function textRes(text) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/rss+xml" },
    text: async () => text,
  };
}

async function withFetch(handler, fn) {
  const orig = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return handler(String(url));
  };
  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = orig;
  }
}

const rss = (title, link) =>
  "<rss><channel><item><title>" + title + "</title><link>" + link + "</link></item></channel></rss>";

test("36kr articles and flash are collected separately", async () => {
  const articles = await withFetch(
    (url) => textRes(rss("长文", "https://36kr.com/p/1")),
    fetch36krArticles
  );
  const flash = await withFetch(
    (url) => textRes(rss("快讯", "https://36kr.com/newsflashes/1")),
    fetch36krFlash
  );
  assert.ok(articles.urls.every((u) => u.includes("/feed") && !u.includes("newsflash")));
  assert.ok(flash.urls.every((u) => u.includes("newsflash")));
  assert.equal(articles.result[0].source, "36kr");
  assert.equal(articles.result[0].role, "article");
  assert.equal(flash.result[0].source, "36kr-flash");
  assert.equal(flash.result[0].role, "flash");
});
