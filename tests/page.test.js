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
  assert.match(html, /精选/);
  assert.match(html, /type="module"/);
});

test("app.js uses Beijing timezone and does not print raw scores", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(js, /Asia\/Shanghai/);
  assert.equal(/item\.score/.test(js), false);
  assert.match(js, /class="chip"/);
});

test("touch targets and theme exist in css", async () => {
  const css = await readFile(join(root, "web/style.css"), "utf8");
  assert.match(css, /--touch: 44px/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /sans-serif/);
});
