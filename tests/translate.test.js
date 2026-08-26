import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyTitleZh,
  applySummaryZh,
  isMostlyLatin,
  shouldSkipTranslate,
  cleanTranslateInput,
} from "../src/translate.js";

test("latin titles are detected", () => {
  assert.equal(isMostlyLatin("Show HN: a tiny CSS framework for forms"), true);
  assert.equal(isMostlyLatin("leftpad-utils: small string helpers"), true);
});

test("chinese titles are not latin", () => {
  assert.equal(isMostlyLatin("朱镕基去世"), false);
  assert.equal(isMostlyLatin("DeepSeek 时刻导致英伟达市值蒸发"), false);
});

test("mock translate sets titleZh on english items", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "展示 HN：小框架" } }),
    };
  };
  const items = await applyTitleZh(
    [
      {
        id: "hn:css",
        title: "Show HN: a tiny CSS framework for forms",
        source: "hn",
        level: "normal",
      },
      {
        id: "weibo:zhu",
        title: "朱镕基去世",
        source: "weibo",
        level: "breaking",
      },
    ],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].titleZh, "展示 HN：小框架");
  assert.equal(items[1].titleZh, undefined);
  assert.equal(calls, 1);
});

test("failed translate leaves titleZh unset", async () => {
  const fake = async () => {
    throw new Error("network");
  };
  const items = await applyTitleZh(
    [{ id: "hn:css", title: "Show HN: a tiny CSS framework for forms" }],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].titleZh, undefined);
});

test("cache skip second fetch", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "缓存命中" } }),
    };
  };
  const cache = {};
  const item = { id: "hn:css", title: "Show HN: a tiny CSS framework for forms" };
  await applyTitleZh([item], { fetchImpl: fake, cache });
  await applyTitleZh([item], { fetchImpl: fake, cache });
  assert.equal(calls, 1);
});

test("latin summary becomes summaryZh", async () => {
  const fake = async () => ({
    ok: true,
    json: async () => ({ responseData: { translatedText: "开源发布令英伟达下跌" } }),
  });
  const items = await applySummaryZh(
    [{ id: "hn:r1", title: "DeepSeek R1 发布", summary: "Open-source release sent NVIDIA shares lower." }],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].summaryZh, "开源发布令英伟达下跌");
});

test("failed summary translate leaves summaryZh empty", async () => {
  const fake = async () => {
    throw new Error("network");
  };
  const items = await applySummaryZh(
    [{ id: "hn:r1", title: "DeepSeek R1 发布", summary: "Open-source release sent NVIDIA shares lower." }],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].summaryZh, undefined);
});

test("chinese summary is not translated", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ responseData: { translatedText: "x" } }) };
  };
  const items = await applySummaryZh(
    [{ id: "36kr:a", title: "DeepSeek 开源", summary: "开源导致英伟达市值蒸发。" }],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].summaryZh, undefined);
  assert.equal(calls, 0);
});

test("title translate budget skips extra latin titles", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "译" + calls } }),
    };
  };
  const items = [];
  for (let i = 0; i < 16; i++) {
    items.push({ id: "hn:" + i, title: "Hello world title " + i });
  }
  const out = await applyTitleZh(items, { fetchImpl: fake, cache: {}, budget: 15 });
  assert.equal(calls, 15);
  assert.equal(out[14].titleZh, "译15");
  assert.equal(out[15].titleZh, undefined);
});

test("over-budget translate does not throw", async () => {
  const fake = async () => {
    throw new Error("should not be called");
  };
  const items = await applyTitleZh(
    [{ id: "hn:a", title: "Hello world title skip" }],
    { fetchImpl: fake, cache: {}, budget: 0 }
  );
  assert.equal(items[0].titleZh, undefined);
});

test("cache hit does not consume translate budget", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "新译" } }),
    };
  };
  const cache = { "Hello world title cached": "已缓存" };
  const out = await applyTitleZh(
    [
      { id: "hn:c", title: "Hello world title cached" },
      { id: "hn:n", title: "Hello world title newone" },
    ],
    { fetchImpl: fake, cache, budget: 1 }
  );
  assert.equal(calls, 1);
  assert.equal(out[0].titleZh, "已缓存");
  assert.equal(out[1].titleZh, "新译");
});

test("owner/repo names are not translated", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "不该出现" } }),
    };
  };
  const items = await applyTitleZh(
    [{ id: "github:x", title: "owner/BITCOIN-WALLET-CRACKER" }],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].titleZh, undefined);
  assert.equal(calls, 0);
  assert.equal(shouldSkipTranslate("owner/repo-name"), true);
});

test("html and urls are stripped before translate", () => {
  const cleaned = cleanTranslateInput(
    '<a href="https://xcancel.com/foo">https://xcancel.com/foo</a>'
  );
  assert.equal(cleaned, "");
});

test("titles then summaries share one budget of 15", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ responseData: { translatedText: "译" + calls } }),
    };
  };
  const budgetState = { remaining: 15 };
  const items = [];
  for (let i = 0; i < 16; i++) {
    items.push({
      id: "hn:" + i,
      title: "Hello world title " + i,
      summary: "Hello world summary extra " + i,
    });
  }
  const titled = await applyTitleZh(items, { fetchImpl: fake, cache: {}, budgetState });
  const out = await applySummaryZh(titled, { fetchImpl: fake, cache: {}, budgetState });
  assert.equal(calls, 15);
  assert.equal(titled[14].titleZh, "译15");
  assert.equal(titled[15].titleZh, undefined);
  assert.equal(out[0].summaryZh, undefined);
});
