import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("index.html has no embedded sample news", async () => {
  const html = await readFile(join(root, "web/index.html"), "utf8");
  assert.equal(html.includes("fallback-events"), false);
  assert.equal(html.includes("胖东来"), false);
  assert.equal(html.includes("DeepSeek R1"), false);
});

test("app.js uses Beijing timezone, score, and chips", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(js, /Asia\/Shanghai/);
  assert.match(js, /item\.score/);
  assert.match(js, /class="chip"/);
});
