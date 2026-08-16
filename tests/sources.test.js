import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchGitHub } from "../src/sources/github.js";
import { fetchHN } from "../src/sources/hn.js";
import { fetchWeibo, fetchBaidu } from "../src/sources/hot.js";
import { fetch36kr } from "../src/sources/kr36.js";

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
