import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTitleZh, applySummaryZh, isMostlyLatin } from "../src/translate.js";

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

test("failed translate keeps english titleZh", async () => {
  const fake = async () => {
    throw new Error("network");
  };
  const items = await applyTitleZh(
    [{ id: "hn:css", title: "Show HN: a tiny CSS framework for forms" }],
    { fetchImpl: fake, cache: {} }
  );
  assert.equal(items[0].titleZh, "Show HN: a tiny CSS framework for forms");
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
