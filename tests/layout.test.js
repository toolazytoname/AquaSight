import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("layout guards long titles, 44px targets, 390 and 1440 breakpoints", async () => {
  const css = await readFile(join(root, "web/style.css"), "utf8");
  const html = await readFile(join(root, "web/index.html"), "utf8");
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-width: 1184px/);
  assert.match(css, /max-width: 600px/);
  assert.match(css, /min-width: 1440px/);
  assert.match(css, /bottom-nav/);
  const mobile = css.split("@media (max-width: 600px)")[1].split("@media")[0];
  assert.match(mobile, /\.sidebar \{ display: none; \}/);
  assert.match(mobile, /\.bottom-nav \{ display: flex;/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /min-height: 47px/); // topic tabs keep a generous touch target
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /精选/);
  assert.match(js, /口味校准/);
  assert.match(css, /\[hidden\] \{ display: none !important; \}/);
  assert.match(css, /line-clamp: 2/);
  assert.match(css, /\.dialog::backdrop/);
  assert.match(js, /清除缓存/);
  assert.match(js, /重置本机收藏和偏好/);
  assert.match(html, /id="modal"/);
  assert.match(html, /data-action="settings"/);
  assert.equal(html.includes("more-tools"), false);
});
