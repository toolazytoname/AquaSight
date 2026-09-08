import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBudget,
  DAILY_CANDIDATE_CAP,
  cacheKey,
  MONTHLY_CNY,
  RESERVE_CNY,
  estimateCny,
  resolvePricing,
} from "../src/budget.js";
import { enrichOne, resolveEnrichEndpoint, validateEnrichment, fallbackEnrichment } from "../src/enrich.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

test("enrich uses XAI_BASE_URL and XAI_MODEL", async () => {
  const prev = {
    key: process.env.XAI_API_KEY,
    base: process.env.XAI_BASE_URL,
    model: process.env.XAI_MODEL,
  };
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                category: "tech",
                entities: [],
                titleZh: "苹果发布会前瞻",
                overviewZh: "折叠屏和音频配件。",
                facts: ["9月9日发布"],
                impact: "消费电子",
                evidence: ["报道"],
                uncertainty: ["规格未公布"],
                attribution: [],
                insufficient: false,
              }),
            },
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 8 },
      }),
    };
  };
  try {
    process.env.XAI_API_KEY = "relay-key";
    process.env.XAI_BASE_URL = "https://relay.example/v1/";
    process.env.XAI_MODEL = "auto:fast";
    const ep = resolveEnrichEndpoint();
    assert.equal(ep.baseUrl, "https://relay.example/v1");
    assert.equal(ep.model, "auto:fast");
    const budget = createBudget({}, new Date("2026-09-07T00:00:00Z"));
    const out = await enrichOne(
      { title: "Apple launch", summary: "foldable", url: "https://example.com/a" },
      { fetchImpl: fake, budget }
    );
    assert.equal(calls[0].url, "https://relay.example/v1/chat/completions");
    assert.equal(calls[0].body.model, "auto:fast");
    assert.equal(out.titleZh, "苹果发布会前瞻");
  } finally {
    if (prev.key == null) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = prev.key;
    if (prev.base == null) delete process.env.XAI_BASE_URL;
    else process.env.XAI_BASE_URL = prev.base;
    if (prev.model == null) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = prev.model;
  }
});

test("collect workflow forwards relay endpoint secrets", async () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const yml = await readFile(join(root, ".github/workflows/collect.yml"), "utf8");
  assert.match(yml, /secrets\.XAI_API_KEY/);
  assert.match(yml, /secrets\.XAI_BASE_URL/);
  assert.match(yml, /secrets\.XAI_MODEL/);
  assert.match(yml, /secrets\.XAI_USD_PER_MTOK_IN/);
  assert.match(yml, /secrets\.XAI_USD_PER_MTOK_OUT/);
});

test("official grok pricing stays a hard budget", () => {
  const prev = { base: process.env.XAI_BASE_URL, model: process.env.XAI_MODEL, inn: process.env.XAI_USD_PER_MTOK_IN, out: process.env.XAI_USD_PER_MTOK_OUT };
  try {
    delete process.env.XAI_BASE_URL;
    delete process.env.XAI_MODEL;
    delete process.env.XAI_USD_PER_MTOK_IN;
    delete process.env.XAI_USD_PER_MTOK_OUT;
    const p = resolvePricing();
    assert.equal(p.hard, true);
    assert.equal(p.usdPerMtokIn, 3);
    assert.equal(p.usdPerMtokOut, 15);
    const b = createBudget({}, new Date("2026-09-07T00:00:00Z"), { pricing: p });
    assert.equal(b.snapshot().hard, true);
  } finally {
    if (prev.base == null) delete process.env.XAI_BASE_URL;
    else process.env.XAI_BASE_URL = prev.base;
    if (prev.model == null) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = prev.model;
    if (prev.inn == null) delete process.env.XAI_USD_PER_MTOK_IN;
    else process.env.XAI_USD_PER_MTOK_IN = prev.inn;
    if (prev.out == null) delete process.env.XAI_USD_PER_MTOK_OUT;
    else process.env.XAI_USD_PER_MTOK_OUT = prev.out;
  }
});

test("custom model without prices does not enforce a hard CNY cap", async () => {
  const prev = { base: process.env.XAI_BASE_URL, model: process.env.XAI_MODEL, inn: process.env.XAI_USD_PER_MTOK_IN, out: process.env.XAI_USD_PER_MTOK_OUT };
  try {
    process.env.XAI_BASE_URL = "https://relay.example/v1";
    process.env.XAI_MODEL = "auto:fast";
    delete process.env.XAI_USD_PER_MTOK_IN;
    delete process.env.XAI_USD_PER_MTOK_OUT;
    const p = resolvePricing();
    assert.equal(p.hard, false);
    const b = createBudget({}, new Date("2026-09-07T00:00:00Z"), { pricing: p });
    assert.equal(b.snapshot().hard, false);
    for (let i = 0; i < 80; i++) {
      await b.reserve({ cny: RESERVE_CNY, now: new Date("2026-09-07T00:00:00Z") });
    }
    assert.ok(b.snapshot().daySpent > 3.3);
  } finally {
    if (prev.base == null) delete process.env.XAI_BASE_URL;
    else process.env.XAI_BASE_URL = prev.base;
    if (prev.model == null) delete process.env.XAI_MODEL;
    else process.env.XAI_MODEL = prev.model;
    if (prev.inn == null) delete process.env.XAI_USD_PER_MTOK_IN;
    else process.env.XAI_USD_PER_MTOK_IN = prev.inn;
    if (prev.out == null) delete process.env.XAI_USD_PER_MTOK_OUT;
    else process.env.XAI_USD_PER_MTOK_OUT = prev.out;
  }
});

test("configured relay prices are used for reserve and settlement", () => {
  const p = resolvePricing({
    baseUrl: "https://relay.example/v1",
    model: "auto:fast",
    usdPerMtokIn: 0.2,
    usdPerMtokOut: 0.6,
  });
  assert.equal(p.hard, true);
  assert.equal(p.usdPerMtokIn, 0.2);
  assert.equal(estimateCny(1e6, 0, p), 1.44);
});
