import { test } from "node:test";
import assert from "node:assert/strict";
import { createBudget, DAILY_CANDIDATE_CAP, cacheKey, MONTHLY_CNY, RESERVE_CNY } from "../src/budget.js";
import { enrichOne, validateEnrichment, fallbackEnrichment } from "../src/enrich.js";

test("concurrent reserves cannot exceed daily budget", async () => {
  const b = createBudget({}, new Date("2026-09-07T00:00:00Z"));
  const tasks = [];
  for (let i = 0; i < 200; i++) {
    tasks.push(
      b.reserve({ cny: 0.03, now: new Date("2026-09-07T00:00:00Z") }).then(
        (r) => ({ ok: true, r }),
        (e) => ({ ok: false, code: e.code })
      )
    );
  }
  const results = await Promise.all(tasks);
  const ok = results.filter((x) => x.ok);
  const fail = results.filter((x) => !x.ok);
  assert.ok(ok.length <= DAILY_CANDIDATE_CAP);
  assert.ok(fail.length >= 1);
  assert.ok(fail.every((f) => f.code === "BUDGET_CANDIDATES" || f.code === "BUDGET_DAY"));
});

test("invalid model output degrades", async () => {
  const bad = validateEnrichment({ titleZh: "甲" });
  assert.equal(bad.ok, false);
  const item = { title: "OpenAI launches GPT-5", summary: "" };
  const fake = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: "not json" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
  });
  const budget = createBudget({}, new Date("2026-09-07T00:00:00Z"));
  const out = await enrichOne(item, {
    apiKey: "test",
    fetchImpl: fake,
    budget,
    cache: {},
  });
  assert.equal(out.insufficient, true);
  assert.equal(out.degraded, true);
});

test("cache hits skip a second call", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                category: "tech",
                entities: [],
                titleZh: "OpenAI 发布 GPT-5",
                overviewZh: "官方发布。",
                facts: ["API 可用"],
                impact: "高",
                evidence: ["标题"],
                uncertainty: [],
                attribution: [],
                insufficient: false,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 20 },
      }),
    };
  };
  const budget = createBudget({}, new Date("2026-09-07T00:00:00Z"));
  const cache = {};
  const item = { title: "OpenAI launches GPT-5", summary: "GA today", url: "https://openai.com/a" };
  const a = await enrichOne(item, { apiKey: "k", fetchImpl: fake, budget, cache });
  const b = await enrichOne(item, { apiKey: "k", fetchImpl: fake, budget, cache });
  assert.equal(calls, 1);
  assert.equal(b.cached, true);
  assert.equal(a.titleZh, "OpenAI 发布 GPT-5");
  assert.ok(cacheKey(item.title));
});

test("fallback does not invent facts from the title", () => {
  const fb = fallbackEnrichment({ title: "OpenAI launches GPT-5 and it will replace all jobs" });
  assert.equal(fb.facts.length, 0);
  assert.equal(fb.insufficient, true);
});
