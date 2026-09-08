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
  assert.match(html, /设置/);
  assert.match(html, /type="module"/);
});

test("app.js uses Beijing timezone and does not print raw scores", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.match(js, /Asia\/Shanghai/);
  assert.equal(/item\.score/.test(js), false);
  assert.match(js, /sourceLabel/);
  assert.match(js, /\/api\/v1\/digest/);
  assert.match(js, /visibleCards/);
  assert.match(js, /unread: state.unreadOnly/);
  assert.match(js, /navigator\.onLine/);
  assert.match(js, /state.view === "saved"/);
  assert.match(js, /\/api\/v1\/favorites/);
  assert.match(js, /X-AquaSight-Cache/);
  assert.match(js, /takeCacheFlag/);
  assert.match(js, /cardBody/);
  assert.match(js, /原文摘录/);
  assert.match(js, /暂无摘要/);
  assert.match(js, /settings-close/);
  assert.match(js, /findSnapshotEvent/);
  assert.match(js, /loadEventsJson/);
  assert.match(js, /applySnapshot/);
  assert.match(js, /blockedSources/);
  assert.match(js, /feed === "snapshot"/);
  assert.match(js, /markRead/);
  assert.match(js, /reset-data-btn/);
  assert.equal(js.includes("网络失败，正在显示本地缓存"), false);
});

test("service worker only caches GET responses", async () => {
  const js = await readFile(join(root, "web/sw.js"), "utf8");
  assert.match(js, /req\.method !== "GET"/);
  assert.match(js, /rules\.js/);
  assert.match(js, /X-AquaSight-Cache/);
  assert.match(js, /async function matchApi/);
  assert.match(js, /aquasight-shell-v7/);
  assert.equal(js.includes("aquasight-shell-v3"), false);
  assert.equal(js.includes("aquasight-shell-v4"), false);
  assert.equal(js.includes("aquasight-shell-v5"), false);
  const apiFn = js.split("async function matchApi")[1].split("function markCached")[0];
  assert.equal(apiFn.includes("ignoreSearch"), false);
  assert.equal(/cache\.put\(req/.test(js.split("method !== \"GET\"")[0]), false);
});

test("browser tests require an installable playwright instead of skipping", async () => {
  const js = await readFile(join(root, "tests/browser-flow.test.js"), "utf8");
  const pkg = await readFile(join(root, "package.json"), "utf8");
  const testYml = await readFile(join(root, ".github/workflows/test.yml"), "utf8");
  assert.equal(js.includes("t.skip"), false);
  assert.equal(js.includes("/home/lodge-admin"), false);
  assert.match(js, /import\("playwright"\)/);
  assert.match(pkg, /"playwright"/);
  assert.match(testYml, /playwright install chromium/);
});

test("touch targets and theme exist in css", async () => {
  const css = await readFile(join(root, "web/style.css"), "utf8");
  assert.match(css, /--touch: 44px/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /sans-serif/);
});
