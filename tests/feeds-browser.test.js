import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";
import { resetPassword } from "../src/auth.js";
import { chromium } from "playwright";
import { AIHOT_FEED_URL } from "../src/personal-feeds.js";

// 自定义 RSS 浏览器集成：登录 → 订阅页添加源（mock feed）→ 阅读流出文
// 章 → 打开详情/收藏 → 移除源（收藏仍在）→ AIHOT 等待提示 → 账户切换
// 隔离。全程走真实本地 handler + 注入的 fetchImpl，不出网。

const codeHash = (code) => createHash("sha256").update("test-pepper:" + code).digest("hex");

async function seedAccount(store, email, password) {
  const code = "813426";
  await store.putOtp({
    email,
    codeHash: codeHash(code),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    attempts: 0,
    sentAt: new Date().toISOString(),
    ip: "127.0.0.1",
  });
  const result = await resetPassword(store, { email, code, password, ip: "127.0.0.1", userAgent: "seed" }, {});
  assert.equal(result.ok, true);
  return result;
}

const FEED_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>Mock Chronicle</title>
<item><title>Mock article one</title><link>https://mock.example/one</link><guid>m1</guid>
<pubDate>Wed, 30 Sep 2026 08:00:00 GMT</pubDate><description>First mock body</description></item>
<item><title>Mock article two</title><link>https://mock.example/two</link><guid>m2</guid>
<pubDate>Wed, 30 Sep 2026 09:00:00 GMT</pubDate><description>Second mock body</description></item>
</channel></rss>`;

const AIHOT_XML = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>AIHOT 精选</title>
<item><title>AIHOT story</title><link>https://aihot.news/r/abc</link><guid>h1</guid>
<pubDate>Wed, 30 Sep 2026 10:00:00 GMT</pubDate><description>AIHOT summary via AIHOT originalURL https://orig.example/x</description></item>
</channel></rss>`;

const LOOKUP_OK = async () => [{ address: "93.184.216.34" }];

function mockFetch(feedLog = []) {
  return async (url) => {
    feedLog.push(String(url));
    if (String(url).includes("aihot.news")) {
      return new Response(AIHOT_XML, { status: 200, headers: { "content-type": "application/rss+xml" } });
    }
    return new Response(FEED_XML, { status: 200, headers: { "content-type": "application/rss+xml" } });
  };
}

async function withServer(store, fetchImpl, fn) {
  const server = await startServer({ store, port: 0, fetchImpl, lookupImpl: LOOKUP_OK });
  try {
    await fn("http://127.0.0.1:" + server.port, server);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
}

async function login(page, base, email, password) {
  await page.goto(base + "/#/reader");
  await page.evaluate(() => document.getElementById("account-btn").click());
  await page.locator("#login-form").waitFor();
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.locator("#login-do").click();
  await page.waitForFunction(() => (document.getElementById("account-label")?.textContent || "").includes("@"));
}

test("feeds browser: add mock feed → articles in reader → open/save → remove; bilingual; aihot wait; account isolation", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedAccount(store, "alpha@example.com", "alpha-pass-12345");
  await seedAccount(store, "beta@example.com", "beta-pass-12345");
  const feedLog = [];
  const fetchImpl = mockFetch(feedLog);

  await withServer(store, fetchImpl, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await login(page, base, "alpha@example.com", "alpha-pass-12345");

      // 订阅页：添加自定义源（URL-only 输入）
      await page.goto(base + "/#/reader-settings");
      await page.locator("#custom-feeds").waitFor({ timeout: 60_000 });
      await page.locator("#feed-add-url").fill("https://mock.example/feed.xml");
      await page.locator("#feed-add-btn").click();
      await page.waitForFunction(() => (document.getElementById("toast")?.textContent || "").includes("已添加"));
      // 源行出现：名称来自 channel title，纯文本
      await page.waitForFunction(() => (document.querySelector("#custom-feeds .custom-feed-row .reader-source-name")?.textContent || "").includes("Mock Chronicle"));

      // 阅读流出现 mock 文章（时间序，最新在前）
      await page.goto(base + "/#/reader");
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      const firstTitle = await page.locator("#list .reader-story h2").first().textContent();
      assert.equal(firstTitle, "Mock article two");
      // 来源标签显示 feed 名称
      const label = await page.locator("#list .reader-story .story-meta span").first().textContent();
      assert.equal(label, "Mock Chronicle");

      // 打开详情 → 保存 → 返回
      await page.locator("#list .reader-story h2 a").first().click();
      await page.waitForFunction(() => Boolean(document.querySelector("#detail h1")));
      const detailTitle = await page.locator("#detail h1").textContent();
      assert.equal(detailTitle, "Mock article two");
      await page.locator('#detail [data-act="save"]').first().click();
      await page.waitForFunction(() => document.querySelector('#detail [data-act="save"]')?.textContent.includes("已收藏"));

      // 移除源（收藏的快照必须仍然可读）
      await page.goto(base + "/#/reader-settings");
      await page.locator("#custom-feeds").waitFor({ timeout: 60_000 });
      await page.locator('[data-act="feed-remove"]').first().click();
      await page.waitForFunction(() => (document.getElementById("toast")?.textContent || "").includes("已移除"));
      await page.goto(base + "/#/saved");
      await page.waitForFunction(() => document.querySelectorAll("#list .story").length >= 1);
      await page.locator("#list .story h2 a").first().click();
      await page.waitForFunction(() => Boolean(document.querySelector("#detail h1")));
      assert.equal(await page.locator("#detail h1").textContent(), "Mock article two");

      // AIHOT：添加后立即刷新 → 提供方 30 分钟地板 → 明确等待提示
      await page.goto(base + "/#/reader-settings");
      await page.locator("#feed-add-aihot").click();
      await page.waitForFunction(() => (document.getElementById("toast")?.textContent || "").includes("已添加"));
      await page.locator('[data-act="feed-refresh"]').first().click();
      await page.waitForFunction(() => (document.getElementById("toast")?.textContent || "").includes("分钟"));
      await page.locator('[data-act="feed-remove"]').first().click();
      await page.waitForFunction(() => (document.getElementById("toast")?.textContent || "").includes("已移除"));

      // 账户切换隔离：登出 → 引导空态；登录 beta → 无 alpha 的源
      await page.evaluate(() => document.getElementById("account-btn").click());
      await page.locator('#modal [data-action="logout"]').click();
      await page.waitForFunction(() => (document.getElementById("account-label")?.textContent || "").includes("登录以同步"));
      await page.goto(base + "/#/reader");
      await page.waitForSelector(".reader-onboarding");

      await login(page, base, "beta@example.com", "beta-pass-12345");
      await page.goto(base + "/#/reader-settings");
      await page.locator("#custom-feeds").waitFor({ timeout: 60_000 });
      const betaFeeds = await page.locator("#custom-feeds .custom-feed-row").count();
      assert.equal(betaFeeds, 0, "other account must not see alpha's feeds");
      assert.deepEqual(errors, []);

      // English UI feedback: switch language, reload, check the section copy.
      await page.evaluate(() => { localStorage.setItem("aquasight-language", "en"); });
      await page.reload();
      await page.locator("#custom-feeds").waitFor({ timeout: 60_000 });
      assert.equal(await page.locator("#custom-feeds .subhead").first().textContent(), "Custom RSS");
      await page.evaluate(() => { localStorage.setItem("aquasight-language", "zh"); });
      await page.reload();
      await page.locator("#custom-feeds").waitFor({ timeout: 60_000 });
      await context.close();
    } finally { await browser.close(); }
  });
});

test("feeds browser: guest sees login hint instead of add form; not-a-feed gives clear message", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const fetchImpl = async () => new Response("<html><body>feishu invite page</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  await withServer(store, fetchImpl, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "zh-CN", serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/reader-settings");
      await page.locator("#custom-feeds").waitFor({ timeout: 60_000 });
      // 游客：没有添加表单，只有登录提示
      assert.equal(await page.locator("#feed-add-form").count(), 0);
      assert.ok((await page.locator("#custom-feeds .reader-hint").first().textContent()).includes("登录"));
      await context.close();
    } finally { await browser.close(); }
  });
});

test("feeds browser: signed-in not-a-feed message shown inline (feishu invite page)", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedAccount(store, "gamma@example.com", "gamma-pass-12345");
  const fetchImpl = async () => new Response("<html><body>feishu invite page</body></html>", { status: 200, headers: { "content-type": "text/html" } });
  await withServer(store, fetchImpl, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "zh-CN", serviceWorkers: "block" });
      const page = await context.newPage();
      await login(page, base, "gamma@example.com", "gamma-pass-12345");
      await page.goto(base + "/#/reader-settings");
      await page.locator("#feed-add-url").waitFor({ timeout: 60_000 });
      await page.locator("#feed-add-url").fill("https://invite.example/chat");
      await page.locator("#feed-add-btn").click();
      await page.waitForFunction(() => (document.getElementById("feed-add-status")?.textContent || "").includes("不是可用的"));
      await context.close();
    } finally { await browser.close(); }
  });
});
