import { readFile, writeFile } from "node:fs/promises";
import { enrichOne, summarizeDigest } from "../src/enrich.js";
import { validateDigestSummary } from "../src/digest-check.js";
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
const selected = entries.slice(0, Number(process.env.EVAL_LIMIT || 8));
const concurrency = Number(process.env.EVAL_CONCURRENCY || 1);
if (![1, 2].includes(concurrency)) throw new Error("EVAL_CONCURRENCY must be 1 or 2");
let next = 0;
let writes = Promise.resolve();
let summary;
const save = () => {
  writes = writes.then(() => writeFile(output, JSON.stringify({ endpoint: process.env.XAI_BASE_URL, model: process.env.XAI_MODEL, concurrency, elapsedMs: Date.now() - start, budget: budget.snapshot(), requests, rows, summary }, null, 2)));
  return writes;
};
async function work() {
while (next < selected.length) {
  const item = selected[next++];
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
  await save();
}
}
await Promise.all(Array.from({ length: concurrency }, work));
if (process.env.EVAL_DIGEST_SUMMARY === "1") {
  const pool = rows.filter((row) => row.valid).slice(0, 10).map((row) => ({ ...selected.find((it) => it.id === row.id), ...row }));
  const result = await summarizeDigest(pool, { budget });
  summary = { ...result, grounding: result.text ? validateDigestSummary(result.text, pool) : null };
  console.log(JSON.stringify({ summary: summary.text || summary.reason, grounding: summary.grounding?.ok }));
  await save();
}
