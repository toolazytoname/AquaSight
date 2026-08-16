import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchGitHub } from "../src/sources/github.js";
import { fetchHN } from "../src/sources/hn.js";
import { fetchWeibo, fetchBaidu, fetchToutiao } from "../src/sources/hot.js";
import { fetch36kr } from "../src/sources/kr36.js";
import { fetchIthome } from "../src/sources/ithome.js";
import { fetchQbitai } from "../src/sources/qbitai.js";
import { fetchV2ex } from "../src/sources/v2ex.js";
import { fetchWallstreetcn } from "../src/sources/wallstreetcn.js";

function jsonRes(obj) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    text: async () => JSON.stringify(obj),
  };
}

function textRes(text, contentType = "application/rss+xml") {
  return {
    ok: true,
    status: 200,
    headers: { get: () => contentType },
    text: async () => text,
  };
}

async function withFetch(handler, fn) {
  const orig = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, opts) => {
    urls.push(String(url));
    return handler(String(url), opts);
  };
  try {
    const result = await fn();
    return { result, urls };
  } finally {
    globalThis.fetch = orig;
  }
}

test("github description becomes summary; missing omits field", async () => {
  const { result, urls } = await withFetch(
    () =>
      jsonRes({
        items: [
          {
            full_name: "foo/bar",
            html_url: "https://github.com/foo/bar",
            description: "A cool repo",
          },
          {
            full_name: "foo/empty",
            html_url: "https://github.com/foo/empty",
            description: "  ",
          },
        ],
      }),
    fetchGitHub
  );
  assert.equal(result[0].summary, "A cool repo");
  assert.equal("summary" in result[1], false);
  assert.ok(urls.every((u) => u.startsWith("https://api.github.com/")));
  assert.ok(urls.every((u) => !u.includes("github.com/foo/bar")));
});

test("hn story_text becomes summary when present", async () => {
  const { result, urls } = await withFetch(
    () =>
      jsonRes({
        hits: [
          {
            objectID: "1",
            title: "Show HN: hello",
            url: "https://example.com",
            story_text: "A short pitch",
          },
          { objectID: "2", title: "Ask HN: no body", url: "https://example.com/2" },
        ],
      }),
    fetchHN
  );
  assert.equal(result[0].summary, "A short pitch");
  assert.equal("summary" in result[1], false);
  assert.ok(urls.every((u) => u.includes("hn.algolia.com")));
});

test("36kr RSS description stripped and clipped to 120", async () => {
  const long = "摘".repeat(200);
  const rss =
    "<rss><channel>" +
    "<item><title>DeepSeek 开源</title><link>https://36kr.com/p/1</link>" +
    "<description><![CDATA[<p>" +
    long +
    "</p>]]></description></item>" +
    "<item><title>无摘要</title><link>https://36kr.com/p/2</link></item>" +
    "</channel></rss>";
  const { result, urls } = await withFetch(() => textRes(rss), fetch36kr);
  assert.equal(result[0].summary, "摘".repeat(120));
  assert.equal("summary" in result[1], false);
  assert.ok(urls.every((u) => /36kr\.com\/feed/.test(u)));
  assert.ok(urls.every((u) => !u.includes("36kr.com/p/")));
});

test("baidu desc/hotDesc becomes summary", async () => {
  const { result } = await withFetch(
    () =>
      jsonRes({
        data: {
          cards: [
            {
              content: [
                {
                  word: "热搜甲",
                  rawUrl: "https://www.baidu.com/s?wd=a",
                  index: 0,
                  desc: "百度摘要",
                },
                {
                  word: "热搜乙",
                  url: "https://www.baidu.com/s?wd=b",
                  index: 1,
                  hotDesc: "热点说明",
                },
                {
                  word: "热搜丙",
                  rawUrl: "https://www.baidu.com/s?wd=c",
                  index: 2,
                },
              ],
            },
          ],
        },
      }),
    fetchBaidu
  );
  assert.equal(result[0].summary, "百度摘要");
  assert.equal(result[1].summary, "热点说明");
  assert.equal("summary" in result[2], false);
});

test("weibo never has summary field", async () => {
  const { result, urls } = await withFetch(
    () =>
      jsonRes({
        data: {
          realtime: [
            { word: "胖东来", realpos: 1, desc: "不该出现" },
            { word: "你好星期六", rank: 1 },
          ],
        },
      }),
    fetchWeibo
  );
  assert.equal(result.length, 2);
  for (const it of result) {
    assert.equal("summary" in it, false);
  }
  assert.ok(urls.every((u) => u.includes("weibo.com/ajax/side/hotSearch")));
});

test("toutiao Title/Url become items; empty throws", async () => {
  const { result, urls } = await withFetch(
    () =>
      jsonRes({
        data: [
          {
            Title: "头条热搜甲",
            Url: "https://www.toutiao.com/trending/1",
            ClusterIdStr: "1",
          },
        ],
      }),
    fetchToutiao
  );
  assert.equal(result[0].source, "toutiao");
  assert.equal(result[0].title, "头条热搜甲");
  assert.ok(urls.every((u) => u.includes("toutiao.com/hot-event/hot-board")));
});

test("toutiao failure throws for that source only", async () => {
  await assert.rejects(
    () =>
      withFetch(() => {
        throw new Error("HTTP 403");
      }, fetchToutiao),
    /HTTP 403/
  );
});

test("ithome rss title/link/summary", async () => {
  const rss =
    "<rss><channel><item>" +
    "<title>IT之家甲</title>" +
    "<description>&lt;p&gt;摘要甲&lt;/p&gt;</description>" +
    "<link>https://www.ithome.com/0/1.htm</link>" +
    "</item></channel></rss>";
  const { result, urls } = await withFetch(() => textRes(rss, "text/xml"), fetchIthome);
  assert.equal(result[0].source, "ithome");
  assert.equal(result[0].title, "IT之家甲");
  assert.equal(result[0].summary, "摘要甲");
  assert.ok(urls.every((u) => u.includes("ithome.com/rss")));
});

test("qbitai rss title/link", async () => {
  const rss =
    "<rss><channel><item>" +
    "<title>量子位甲</title>" +
    "<link>https://www.qbitai.com/p/1</link>" +
    "<description><![CDATA[短摘]]></description>" +
    "</item></channel></rss>";
  const { result, urls } = await withFetch(
    () => textRes(rss),
    fetchQbitai
  );
  assert.equal(result[0].source, "qbitai");
  assert.equal(result[0].title, "量子位甲");
  assert.ok(urls.every((u) => u.includes("qbitai.com/feed")));
});

test("v2ex hot.json title/url/summary; no rsshub", async () => {
  const { result, urls } = await withFetch(
    () =>
      jsonRes([
        {
          id: 1,
          title: "V2EX甲",
          url: "https://www.v2ex.com/t/1",
          content: "<p>正文摘要</p>",
        },
      ]),
    fetchV2ex
  );
  assert.equal(result[0].source, "v2ex");
  assert.equal(result[0].title, "V2EX甲");
  assert.equal(result[0].summary, "正文摘要");
  assert.ok(urls.every((u) => u.includes("v2ex.com/api/topics/hot.json")));
  assert.ok(urls.every((u) => !/rsshub|tenapi|alapi/i.test(u)));
});

test("wallstreetcn lives title/uri/content_text", async () => {
  const { result, urls } = await withFetch(
    () =>
      jsonRes({
        code: 20000,
        data: {
          items: [
            {
              id: 9,
              title: "见闻甲",
              uri: "https://wallstreetcn.com/livenews/9",
              content_text: "快讯正文",
            },
          ],
        },
      }),
    fetchWallstreetcn
  );
  assert.equal(result[0].source, "wallstreetcn");
  assert.equal(result[0].title, "见闻甲");
  assert.equal(result[0].summary, "快讯正文");
  assert.ok(urls.every((u) => u.includes("api-one-wscn.awtmt.com")));
  assert.ok(urls.every((u) => !/rsshub|tenapi|alapi/i.test(u)));
});

test("ithome empty throws", async () => {
  await assert.rejects(
    () => withFetch(() => textRes("<rss><channel></channel></rss>"), fetchIthome),
    /rss empty/
  );
});
