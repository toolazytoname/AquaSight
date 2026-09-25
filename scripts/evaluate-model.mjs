import { readFile, writeFile } from "node:fs/promises";
import { enrichOne } from "../src/enrich.js";
import { createBudget, resolvePricing } from "../src/budget.js";

// Uses the same BYOK environment and production enrichment code; never sends notifications.
const [input, output] = process.argv.slice(2);
if (!input || !output || !process.env.XAI_API_KEY) throw new Error("Provide input/output paths and BYOK environment");
const data = JSON.parse(await readFile(input, "utf8"));
const entries = (data.digest || data).items;
const budget = createBudget({}, new Date(), { pricing: resolvePricing() });
const rows = [];
const requests = [];
const start = Date.now();
for (const item of entries.slice(0, Number(process.env.EVAL_LIMIT || 8))) {
  const begin = Date.now();
  const result = await enrichOne(item, {
    budget,
    fetchImpl: async (...args) => {
      const response = await fetch(...args);
      requests.push({ status: response.status });
      return response;
    },
  });
  const row = {
    id: item.id, source: item.source, title: item.title,
    valid: !result.degraded, ready: !result.degraded && !result.insufficient,
    reason: result.fallbackReason, ms: Date.now() - begin,
    titleZh: result.titleZh, overviewZh: result.overviewZh, facts: result.facts,
    model: result.model, usage: result.usage,
  };
  rows.push(row);
  console.log(JSON.stringify({ sample: rows.length, valid: row.valid, ready: row.ready, ms: row.ms, reason: row.reason, titleZh: row.titleZh }));
  await writeFile(output, JSON.stringify({ endpoint: process.env.XAI_BASE_URL, model: process.env.XAI_MODEL, elapsedMs: Date.now() - start, budget: budget.snapshot(), requests, rows }, null, 2));
}
