import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decorateCards } from "../src/run.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("fixture cards keep pangdonglai out of breaking and assign event ids", async () => {
  const raw = JSON.parse(
    await readFile(join(root, "tests/fixtures/cards.json"), "utf8")
  );
  const cards = await decorateCards(raw.items, { enrich: false });
  assert.ok(cards.length >= 3);
  const ids = cards.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => String(id).startsWith("evt:")));
  const pdl = cards.find((c) => c.title === "胖东来");
  assert.ok(pdl);
  assert.equal(pdl.level, "normal");
  const zhu = cards.find((c) => c.title.includes("去世"));
  if (zhu) assert.notEqual(zhu.level, "breaking");
});
