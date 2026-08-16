import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decorateCards } from "../src/run.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("fixture cards merge, score, and skip pangdonglai breaking", async () => {
  const raw = JSON.parse(
    await readFile(join(root, "tests/fixtures/cards.json"), "utf8")
  );
  const fake = async () => ({
    ok: true,
    json: async () => ({
      responseData: { translatedText: "开源发布令英伟达股价下跌。" },
    }),
  });
  const cards = await decorateCards(raw.items, { fetchImpl: fake, cache: {} });
  const ds = cards.find((c) => (c.sources || []).length === 2);
  assert.ok(ds);
  assert.equal(ds.level, "breaking");
  assert.equal(typeof ds.score, "number");
  assert.ok(ds.sources.some((s) => s.source === "hn"));
  assert.ok(ds.sources.some((s) => s.source === "36kr"));
  assert.equal(ds.summaryZh, "开源发布令英伟达股价下跌。");

  const pdl = cards.find((c) => c.title === "胖东来");
  assert.ok(pdl);
  assert.equal(pdl.level, "normal");
});
