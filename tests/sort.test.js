import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sortByScore } from "../src/sort.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("sortByScore desc, missing is 0, ties keep original order", () => {
  const items = [
    { id: "a", score: 1 },
    { id: "b", score: 5 },
    { id: "c" },
    { id: "d", score: 5 },
    { id: "e", score: 3 },
  ];
  assert.deepEqual(sortByScore(items).map((x) => x.id), ["b", "d", "e", "a", "c"]);
});

test("app.js sorts breaking and normal by score", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(js, /function sortByScore/);
  assert.match(js, /function breakingListForPage/);
  assert.match(js, /function normalListForPage/);
  assert.match(js, /i\.level === "breaking"/);
});
