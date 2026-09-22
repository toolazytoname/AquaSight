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
  assert.match(js, /readingMarks/);
  assert.match(js, /status\/public/);
  assert.match(js, /findSnapshotEvent/);
  assert.match(js, /loadEventsJson/);
  assert.match(js, /applySnapshot/);
  assert.match(js, /blockedSources/);
  assert.match(js, /feed === "snapshot"/);
  assert.match(js, /markRead/);
  assert.match(js, /data-close/);
  assert.equal(js.includes("网络失败，正在显示本地缓存"), false);
});

test("app.js keeps auth off localStorage and purges caches on account change", async () => {
  const js = await readFile(join(root, "web/app.js"), "utf8");
  assert.equal(/setItem\("aquasight-token"/.test(js), false);
  assert.match(js, /removeItem\("aquasight-token"/);
  assert.match(js, /purgeUserCaches/);
  assert.match(js, /authEpoch/);
});

test("service worker splits public and credential-scoped caches", async () => {
  const js = await readFile(join(root, "web/sw.js"), "utf8");
  assert.match(js, /req\.method !== "GET"/);
  assert.match(js, /rules\.js/);
  assert.match(js, /X-AquaSight-Cache/);
  assert.match(js, /aquasight-shell-v17/);
  assert.equal(js.includes("aquasight-shell-v16"), false);
  assert.equal(js.includes("aquasight-shell-v3"), false);
  assert.equal(js.includes("aquasight-shell-v4"), false);
  assert.equal(js.includes("aquasight-shell-v5"), false);
  // personal endpoints are never cached: the branch returns before any cache use
  const personalBranch = js
    .split("if (PERSONAL_PATH_RE.test(url.pathname))")[1]
    .split("const cacheName = await cacheNameFor(req);")[0];
  assert.match(personalBranch, /503/);
  assert.equal(personalBranch.includes("cache.put"), false);
  // every cached API response is namespaced by credentials
  assert.match(js, /NEWS_PREFIX/);
  assert.match(js, /sha256Hex/);
  // API caching only happens inside handleApi, which the fetch listener calls
  // strictly after the GET gate
  const gated = js.split('req.method !== "GET"')[1];
  assert.match(gated, /handleApi\(req\)/);
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
  assert.match(css, /min-height: 44px/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /sans-serif/);
  assert.match(css, /prefers-reduced-motion/);
});
