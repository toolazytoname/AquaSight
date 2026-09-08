import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("layout guards long titles, 44px targets, 390 and 1440 breakpoints", async () => {
  const css = await readFile(join(root, "web/style.css"), "utf8");
  const html = await readFile(join(root, "web/index.html"), "utf8");
  assert.match(css, /--touch: 44px/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-width: 1440px/);
  assert.match(css, /max-width: 860px/);
  assert.match(css, /bottom-nav/);
  const mobile = css.split("@media (max-width: 860px)")[1].split("@media")[0];
  assert.match(mobile, /\.nav \{ display: none; \}/);
  assert.match(mobile, /\.bottom-nav \{ display: flex; \}/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /精选/);
  assert.match(html, /口味校准/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /line-clamp: 3/);
  assert.match(css, /settings-panel/);
  assert.match(html, /清除本机缓存/);
  assert.match(html, /settings-close/);
  assert.match(html, /id="settings-btn"/);
  assert.equal(html.includes("more-tools"), false);
});
