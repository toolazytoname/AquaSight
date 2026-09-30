import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";
import { resetPassword } from "../src/auth.js";
import { chromium } from "playwright";

// 真实本地 handler + 内存存储的订阅阅读器浏览器测试：登录/订阅/阅读流/
// 详情全走真接口；与原生 reader API 的行为逐项对照。

const codeHash = (code) => createHash("sha256").update("test-pepper:" + code).digest("hex");

async function plantCode(store, email, code) {
  await store.putOtp({
    email,
    codeHash: codeHash(code),
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
    attempts: 0,
    sentAt: new Date().toISOString(),
    ip: "127.0.0.1",
  });
}

async function seedAccount(store, email, password) {
  const code = "813426";
  await plantCode(store, email, code);
  const result = await resetPassword(store, { email, code, password, ip: "127.0.0.1", userAgent: "seed" }, {});
  assert.equal(result.ok, true);
  return result;
}

function readerEvent(it, overrides = {}) {
  return {
    ...it,
    id: it.id,
    title: it.title,
    source: it.source,
    category: it.category || "tech",
    url: it.url,
    publishedAt: it.publishedAt || new Date(Date.now() - 3600_000).toISOString(),
    ...overrides,
  };
}

/// 事件集覆盖订阅语义的关键面：github/openai 基础来源、bbc 扩展来源、
/// hidden 排除、非 http 原文链接排除、带凭据链接排除、repo 观测排序。
async function seedEvents(store) {
  const base = Date.now() - 2 * 3600_000;
  const specs = [
    { id: "r-github-1", title: "GitHub project one", source: "github", url: "https://github.com/one", githubRepo: { fullName: "octo/one", observedAt: new Date(base + 1800_000).toISOString(), stars: 120, language: "Rust" } },
    { id: "r-github-2", title: "GitHub project two", source: "github", url: "https://github.com/two", githubRepo: { observedAt: new Date(base + 3600_000).toISOString() } },
    { id: "r-openai-1", title: "OpenAI update", source: "openai", url: "https://openai.com/blog/x" },
    { id: "r-bbc-1", title: "BBC world story", source: "bbc", url: "https://bbc.com/story" },
    { id: "r-hidden-1", title: "Hidden item", source: "github", url: "https://github.com/hidden", category: "hidden" },
    { id: "r-unsafe-1", title: "Unsafe link item", source: "github", url: "javascript:void(0)" },
    { id: "r-cred-1", title: "Credentialed link", source: "openai", url: "https://user:pass@example.com/x" },
  ];
  for (const s of specs) await store.putEvent(readerEvent(s));
  return specs;
}

async function withServer(store, fn) {
  const server = await startServer({ store, port: 0 });
  try {
    await fn("http://127.0.0.1:" + server.port, server);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
}

const listedIds = (page) =>
  page.evaluate(() => [...document.querySelectorAll("#list .story")].map((el) => el.getAttribute("data-id")));

test("reader web: default root is reader with onboarding; explicit nav for 阅读/订阅/开源", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/");
      // 默认首页 = 阅读（与 iOS 对齐），游客未选择来源 → 引导空态。
      await page.waitForSelector(".reader-onboarding");
      assert.match(page.url(), /#\/reader$/);
      assert.equal(await page.locator('.nav a[data-view="reader"]').textContent(), "阅读");
      assert.equal(await page.locator('.nav a[data-view="reader-settings"]').textContent(), "订阅");
      assert.ok(await page.locator('.nav a[data-view="opensource"]').count(), "opensource stays discoverable");
      // 一键 GitHub 起步（显式选择，无静默默认）→ 订阅流立即加载。
      const readerReq = page.waitForRequest((r) => r.url().includes("/api/v1/events") && r.url().includes("view=reader"));
      await page.locator("[data-action='reader-start']").click();
      const req = await readerReq;
      assert.match(req.url(), /sources=github/);
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      const ids = await listedIds(page);
      assert.ok(ids.includes("r-github-1") && ids.includes("r-github-2"));
      assert.ok(!ids.includes("r-bbc-1") && !ids.includes("r-hidden-1") && !ids.includes("r-unsafe-1"));
      // 与原生 reader API 的 ID 集合一致。
      const api = await page.evaluate(async () => {
        const res = await fetch("/api/v1/events?view=reader&sources=github&limit=50");
        return res.json();
      });
      assert.equal(api.reader, true);
      assert.deepEqual(api.items.map((it) => it.id), ids);
      // 选择持久化：刷新后仍是订阅流（不再出现引导）。
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      assert.equal(await page.locator(".reader-onboarding").count(), 0);
      // GitHub 元数据保留展示。
      const metaCount = await page.locator(".reader-story .repo-meta").count();
      assert.ok(metaCount > 0, "repo metadata should render on reader cards");
      assert.ok((await page.locator(".reader-story .repo-meta").first().textContent()).includes("Rust"));
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("reader web: guest settings persist locally; detail uses reader=1 and survives reload", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/reader-settings");
      await page.locator('[data-reader-source][value="openai"]').check();
      await page.locator("#reader-save").click();
      await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已保存"));
      assert.equal(await page.locator("#reader-more").count(), 0, "guest must not see the extended toggle");
      await page.goto(base + "/#/reader");
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      const ids = await listedIds(page);
      assert.deepEqual(ids, ["r-openai-1"]); // openai 基础来源；凭据链接被安全规则排除
      // 详情：URL 显式携带 reader=1，刷新后仍走订阅详情。
      const detailReq = page.waitForRequest((r) => r.url().includes("/api/v1/events/r-openai-1"));
      await page.locator('#list a[href*="r-openai-1"]').first().click();
      const req = await detailReq;
      assert.match(req.url(), /[?&]reader=1/);
      assert.match(req.url(), /[?&]sources=openai/);
      await page.waitForSelector("#detail h1");
      assert.ok(page.url().includes("?reader=1"));
      const reReq = page.waitForRequest((r) => r.url().includes("/api/v1/events/r-openai-1"));
      await page.reload();
      await page.waitForSelector("#detail h1");
      const req2 = await reReq;
      assert.match(req2.url(), /[?&]reader=1/, "reload keeps reader context");
      // 普通发现链接（无 reader=1）不受订阅上下文影响。
      await page.goto(base + "/#/featured");
      await page.waitForSelector("#list .story");
      assert.equal(await page.locator("#list .reader-story").count(), 0);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("reader web: old backend without reader:true shows explicit error, never the public feed", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/");
      await page.locator("[data-action='reader-start']").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      // 模拟旧生产后端：view=reader 命中 featured 数据（无 reader:true）。
      await page.route("**/api/v1/events?**view=reader**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [{ id: "x", title: "旧数据" }], cursor: null }) })
      );
      await page.locator('#refresh-btn, [data-action="refresh"]').first().click();
      await page.waitForFunction(() => (document.querySelector("#list")?.textContent || "").includes("订阅阅读暂时不可用"));
      const text = await page.locator("#list").textContent();
      assert.ok(!text.includes("旧数据"), "must not render non-reader payload");
      // 网络故障也不允许落入全站公开快照。
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.route("**/api/v1/events?**view=reader**", (route) => route.abort());
      await page.locator("#retry-btn, [data-action='refresh']").first().click().catch(() => {});
      await page.waitForFunction(() => (document.querySelector("#list")?.textContent || "").includes("暂时读不到"));
      assert.equal(await page.locator("#list .story").count(), 0, "no public-feed fallback in reader");
      await context.close();
    } finally { await browser.close(); }
  });
});

test("reader web: password login default (账号（邮箱）), account sources apply, extended gating, logout isolation", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  const email = "reader@example.com";
  const account = await seedAccount(store, email, "correct-horse-battery-13");
  // 账户订阅：github + 扩展 bbc，但 moreSourcesEnabled=false → bbc 必须被过滤。
  await store.setReaderPrefs({ selectedSources: ["github", "bbc"], moreSourcesEnabled: false, configured: true }, { userId: account.user.id });
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      // 密码登录为默认表单，标签为 账号（邮箱）；日常登录不发验证码。
      let codeCalls = 0;
      page.on("request", (r) => { if (r.url().includes("/auth/request-code")) codeCalls++; });
      await page.goto(base + "/#/reader");
      await page.locator('.side-footer [data-action="login"], .bottom-nav ~ * [data-action="login"]').first().isVisible().catch(() => {});
      await page.evaluate(() => document.getElementById("account-btn").click());
      await page.locator("#login-form").waitFor();
      assert.equal(await page.locator('label[for="login-email"]').textContent(), "账号（邮箱）");
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill("correct-horse-battery-13");
      await page.locator("#login-do").click();
      await page.waitForFunction(() => (document.getElementById("account-label")?.textContent || "").includes("reader@"));
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      // 账户订阅生效；扩展来源在未开启「更多」时被过滤（与原生门控一致）。
      const ids = await listedIds(page);
      assert.ok(ids.includes("r-github-1"));
      assert.ok(!ids.includes("r-bbc-1"), "extended source must be gated while moreSourcesEnabled=false");
      const api = await page.evaluate(async () => (await (await fetch("/api/v1/events?view=reader&limit=50")).json()));
      assert.deepEqual(api.items.map((it) => it.id), ids, "web feed must match the native reader API");
      assert.equal(codeCalls, 0, "daily password login must not send OTP codes");
      // 订阅页保存（去掉 github、开启更多并选 bbc）→ 返回阅读即更新。
      await page.goto(base + "/#/reader-settings");
      await page.locator('[data-reader-source][value="github"]').uncheck();
      await page.locator("#reader-more").check();
      await page.locator('[data-reader-source][value="bbc"]').check();
      await page.locator("#reader-save").click();
      await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已保存"));
      const prefs = (await store.getPrefs({ userId: account.user.id })).reader;
      assert.equal(prefs.moreSourcesEnabled, true);
      assert.ok(prefs.selectedSources.includes("bbc"));
      await page.goto(base + "/#/reader");
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      const afterIds = await listedIds(page);
      assert.ok(afterIds.includes("r-bbc-1"));
      assert.ok(!afterIds.includes("r-github-1"));
      // 登出隔离：回到游客选择（本测试上下文的游客未选择 → 引导），账户条目不残留。
      await page.evaluate(() => document.getElementById("account-btn").click());
      await page.locator('#modal [data-action="logout"]').click();
      await page.waitForFunction(() => (document.getElementById("account-label")?.textContent || "").includes("登录以同步"));
      await page.waitForSelector(".reader-onboarding");
      assert.equal(await page.locator("#list .reader-story").count(), 0);
      // 游客重新选择 github 后，账户时期的 bbc 条目不得出现。
      await page.locator("[data-action='reader-start']").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      const guestIds = await listedIds(page);
      assert.ok(guestIds.every((id) => id.startsWith("r-github")));
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("reader web: existing cookie boots straight into the account feed even with slow settings", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  const email = "boot@example.com";
  const account = await seedAccount(store, email, "correct-horse-battery-13");
  await store.setReaderPrefs({ selectedSources: ["openai"], moreSourcesEnabled: false, configured: true }, { userId: account.user.id });
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
      await context.addCookies([{ name: "aqs_session", value: account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      // /reader/settings 延迟 2.5s：冷启动必须等订阅就绪再渲染，不得先闪
      // 引导空态然后永不刷新。
      await page.route("**/api/v1/reader/settings", async (route) => {
        if (route.request().method() === "GET") {
          await new Promise((r) => setTimeout(r, 2500));
        }
        await route.continue();
      });
      await page.goto(base + "/#/reader");
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1, null, { timeout: 15000 });
      assert.equal(await page.locator(".reader-onboarding").count(), 0, "no false onboarding while settings load");
      const ids = await listedIds(page);
      assert.deepEqual(ids, ["r-openai-1"]);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("reader web: reader detail refuses authoritative 404 without local revival", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/");
      await page.locator("[data-action='reader-start']").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 2);
      // 打开一个真实订阅详情后，把该事件从服务端删除 → 404 是权威拒绝，
      // 不得用本机列表副本复活。
      await page.locator('#list a[href*="r-github-1"]').first().click();
      await page.waitForSelector("#detail h1");
      // 服务端删除该事件后，直接深链它的 reader 详情：404 是权威拒绝，
      // 不得用本机列表副本复活。
      await store.tables.events.delete("r-github-1");
      await store.tables.events.delete("r-github-2");
      await page.evaluate(() => { location.hash = "#/event/r-github-2?reader=1"; });
      await page.waitForFunction(() => (document.querySelector("#detail")?.textContent || "").includes("暂时打不开") || (document.querySelector("#detail")?.textContent || "").includes("找不到"));
      assert.equal(await page.locator("#detail h1").count(), 0, "no revived content on authoritative 404");
      await context.close();
    } finally { await browser.close(); }
  });
});
