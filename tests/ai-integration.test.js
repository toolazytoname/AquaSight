import { test } from "node:test";
import assert from "node:assert/strict";
import { enrichOne, enrichmentCacheKey, enrichItems, validateEnrichment } from "../src/enrich.js";
import { createBudget, resolvePricing } from "../src/budget.js";
import { prepareDigest } from "../src/digest-editor.js";
import { buildDigestPayload } from "../src/bark.js";
import { validateDigestStyle } from "../src/digest-check.js";

const settings = { apiKey: "test", baseUrl: "https://relay.test/v1", model: "free", usdPerMtokIn: 0, usdPerMtokOut: 0, maxOutputTokens: 2400 };
const value = { category: "tech", titleZh: "芯片公司发布新产品", overviewZh: "芯片公司宣布新产品。", entities: [], facts: ["芯片公司宣布新产品。"], impact: "", evidence: [], uncertainty: [], attribution: [], insufficient: false };
const response = (content = JSON.stringify(value)) => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 120, completion_tokens: 300 } }) });

test("a copied schema template is rejected even though it is valid Chinese JSON", () => {
  assert.equal(validateEnrichment({ ...value, titleZh: "中文标题" }).error, "placeholder");
  assert.equal(validateEnrichment({ ...value, facts: ["原文支持的事实，最多3条"] }).error, "placeholder");
  assert.equal(validateEnrichment(value).ok, true);
});

test("digest editor rejects sprawling or cut-off model summaries", () => {
  assert.equal(validateDigestStyle("微软发布新版 Copilot，整合聊天、编程和智能体能力。高通发布两款新芯片。"), true);
  assert.equal(validateDigestStyle("微软发布新版 Copilot。高通发布新芯片。Meta 推出新眼镜。另有更多消息。"), false);
  assert.equal(validateDigestStyle("微软发布新版 Copilot，整合聊天、编程和智能体能力"), false);
});

test("failed cache is retried, successful results clear stale failure flags", async () => {
  const item = { id: "x", title: "Chip company releases a new product", enrichInsufficient: true };
  const cache = { [enrichmentCacheKey(item, settings)]: { degraded: true, fallbackReason: "BUDGET_CANDIDATES" } };
  let calls = 0;
  const [edited] = await enrichItems([item], { ...settings, cache, fetchImpl: async () => { calls++; return response(); } });
  assert.equal(calls, 1);
  assert.equal(edited.aiState, "ready");
  assert.equal(edited.enrichInsufficient, false);
  await enrichOne(item, { ...settings, cache, fetchImpl: async () => { throw Error("cached result should be reused"); } });
  assert.notEqual(enrichmentCacheKey(item, settings), enrichmentCacheKey(item, { ...settings, model: "other" }));
  assert.notEqual(enrichmentCacheKey(item, settings), enrichmentCacheKey(item, { ...settings, baseUrl: "https://other.test/v1" }));
});

test("truncated output retries with more room and accounts for both calls", async () => {
  const budget = createBudget({}, new Date(), { pricing: resolvePricing(settings) });
  const limits = [];
  const result = await enrichOne({ title: "Chip company releases a new product" }, { ...settings, budget,
    fetchImpl: async (url, init) => {
      limits.push(JSON.parse(init.body).max_tokens);
      return response(limits.length === 1 ? '{"category":' : JSON.stringify(value));
    },
  });
  assert.deepEqual(limits, [2400, 4800]);
  assert.equal(result.degraded, undefined);
  assert.equal(budget.snapshot().dayInputTokens, 240);
  assert.equal(budget.snapshot().dayOutputTokens, 600);
});

test("429 is backed off once and is not cached as a success", async () => {
  const delays = [];
  let calls = 0;
  const cache = {};
  const result = await enrichOne({ title: "Chip company releases a new product" }, { ...settings, cache,
    sleepImpl: async (ms) => delays.push(ms),
    fetchImpl: async () => { calls++; return { ok: false, status: 429, headers: new Headers({ "retry-after": "3" }) }; },
  });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [3000]);
  assert.equal(result.fallbackReason, "http-429");
  assert.deepEqual(cache, {});
});

test("prepared digest shares Chinese items and validated summary with notification", async () => {
  const items = [1, 2, 3].map((n) => ({ id: String(n), title: "Chip company releases a new product", category: "tech" }));
  const digest = await prepareDigest({ date: "2026-09-25", items }, { ...settings, maxOutputTokens: 2400,
    fetchImpl: async (url, init) => {
      const request = JSON.parse(init.body);
      if (request.messages[0].content.startsWith("你是新闻编辑")) assert.equal(request.max_tokens, 4800);
      return response(request.messages[0].content.startsWith("你是新闻编辑") ? "芯片公司发布了新产品。" : JSON.stringify(value));
    },
  });
  assert.equal(digest.items.length, 3);
  assert.equal(digest.tech.length, 3);
  assert.equal(digest.aiSummary.text, "芯片公司发布了新产品。");
  const payload = buildDigestPayload(digest, "https://quack.weichao.ren");
  assert.ok(payload.body.startsWith(digest.aiSummary.text));
  assert.equal(payload.url, "https://quack.weichao.ren/#/digest");
  assert.equal(payload.title, "鸭先知 · 9月25日早报");
});

test("untranslated English is omitted when the model is unavailable", async () => {
  const digest = await prepareDigest({ items: [{ id: "1", category: "tech", title: "Untranslated article" }] }, {
    ...settings, fetchImpl: async () => ({ ok: false, status: 401 }),
  });
  assert.equal(digest.items.length, 0);
  assert.equal(digest.aiEditing.included, 0);
});
