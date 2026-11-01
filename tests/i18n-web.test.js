import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";

// Bilingual web UI: non-Chinese browsers default to English, Chinese browsers
// get Chinese, the in-settings switch persists (localStorage only) and
// re-renders without touching data. English readers see original titles and
// summaries; Chinese AI-generated analysis is not shown to them.

async function seedEvents(store) {
  await store.putEvent({
    id: "i18n-1",
    title: "Original English headline",
    titleZh: "中文标题",
    summary: "Original English summary of the story.",
    overviewZh: "这是中文 AI 概述。",
    facts: ["中文事实要点"],
    impact: "中文潜在影响分析",
    uncertainty: [],
    source: "github",
    category: "tech",
    url: "https://github.com/example/repo",
    githubRepo: { fullName: "example/repo", description: "Original repo description", stars: 10, observedAt: new Date().toISOString() },
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  });
}

async function withServer(store, fn) {
  const server = await startServer({ store, port: 0 });
  try {
    await fn("http://127.0.0.1:" + server.port, server);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
  }
}

test("i18n web: English browser gets the English UI and original content", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(base + "/#/reader");
      await page.waitForSelector("#view-title");
      // Default language for a non-Chinese browser is English (data-driven,
      // not whole-page text replacement).
      assert.equal(await page.locator(".nav a[data-view='reader']").textContent(), "Reading");
      assert.equal(await page.locator(".nav a[data-view='saved']").textContent(), "Saved");
      assert.equal(await page.locator(".nav a[data-view='reader-settings']").textContent(), "Subscriptions");
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      assert.equal(await page.locator(".brand-english").evaluate(el => el.hidden), true);
      assert.match(await page.title(), /Reading/);
      // Onboarding invites in English, then subscribe via the starter button.
      await page.waitForSelector(".reader-onboarding");
      assert.match(await page.locator(".reader-onboarding h2").textContent(), /Start with what you care about/);
      await page.locator("[data-action='reader-start']").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      // English readers see the ORIGINAL title, not the Chinese one.
      assert.match(await page.locator("#list h2").first().textContent(), /Original English headline/);
      assert.equal((await page.locator("#list h2").first().textContent()).includes("中文标题"), false);
      // Detail: original summary leads; Chinese AI facts/impact are absent.
      await page.locator("#list h2 a").first().click();
      await page.waitForSelector("#detail h1");
      assert.match(await page.locator("#detail h1").textContent(), /Original English headline/);
      const detailText = await page.locator("#detail").innerText();
      assert.match(detailText, /Original English summary of the story\./);
      assert.equal(detailText.includes("中文事实要点"), false, "Chinese AI facts must not be shown to English readers");
      assert.equal(detailText.includes("中文潜在影响分析"), false, "Chinese AI impact must not be shown to English readers");
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("i18n web: Chinese browser keeps the Chinese UI", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/reader");
      await page.waitForSelector("#view-title");
      assert.equal(await page.locator(".nav a[data-view='reader']").textContent(), "阅读");
      assert.equal(await page.evaluate(() => document.documentElement.lang), "zh-CN");
      assert.equal(await page.locator(".brand-english").evaluate(el => el.hidden), false);
      await page.locator("[data-action='reader-start']").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      assert.match(await page.locator("#list h2").first().textContent(), /中文标题/);
      // Chinese detail keeps the AI sections.
      await page.locator("#list h2 a").first().click();
      await page.waitForSelector("#detail h1");
      const detailText = await page.locator("#detail").innerText();
      assert.match(detailText, /中文事实要点/);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("i18n web: settings switch persists locally, re-renders, and never touches data", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/reader");
      await page.waitForSelector("#view-title");
      await page.locator("[data-action='reader-start']").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      // Switch language from the settings dialog.
      await page.locator(".tools [data-action='settings']").click();
      await page.waitForSelector("#theme-select");
      await page.locator("[data-action='language-en']").click();
      // The open dialog and the active page re-render in English.
      await page.waitForFunction(() => document.querySelector(".nav a[data-view='reader']")?.textContent === "Reading");
      assert.equal(await page.evaluate(() => document.documentElement.lang), "en");
      assert.equal(await page.evaluate(() => localStorage.getItem("aquasight-language")), "en");
      // The dialog itself re-rendered in English (still open with theme select).
      assert.ok(await page.locator("#theme-select").count(), "settings dialog re-opened after language switch");
      await page.keyboard.press("Escape");
      // Feed rows re-rendered in English with the original title.
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      assert.match(await page.locator("#list h2").first().textContent(), /Original English headline/);
      // The preference survives reload; the saved guest selection survives too
      // (language switching must not reset subscriptions or saved data).
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll("#list .reader-story").length >= 1);
      assert.equal(await page.locator(".nav a[data-view='reader']").textContent(), "Reading");
      assert.match(await page.locator("#list h2").first().textContent(), /Original English headline/);
      // Switch back to Chinese from settings.
      await page.locator(".tools [data-action='settings']").click();
      await page.waitForSelector("#theme-select");
      await page.locator("[data-action='language-zh']").click();
      await page.waitForFunction(() => document.querySelector(".nav a[data-view='reader']")?.textContent === "阅读");
      assert.equal(await page.evaluate(() => localStorage.getItem("aquasight-language")), "zh");
      await context.close();
    } finally { await browser.close(); }
  });
});

test("i18n web: favorites and personal title/note survive language switches", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/saved");
      await page.waitForSelector("#view-title");
      // Save a personal link with a custom title, then add a custom note.
      await page.locator("[data-action='add-link']").first().click();
      await page.fill("#add-url", "https://example.com/i18n-keep");
      await page.fill("#add-title", "自定义标题保留检查");
      await page.locator("#add-form button[type=submit]").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .library-card").length >= 1);
      await page.locator(".library-more summary").first().click();
      await page.locator("[data-action='edit-meta']").first().click();
      await page.fill("#edit-note", "语言切换不应改动个人备注");
      await page.locator("#edit-meta-form button[type=submit]").click();
      await page.waitForFunction(() => document.querySelectorAll("#list .library-card").length >= 1);

      // Switch the UI language (zh → en) from settings; the saved item and
      // its user-authored title/note must be untouched (local data only).
      await page.locator(".tools [data-action='settings']").click();
      await page.waitForSelector("#theme-select");
      await page.locator("[data-action='language-en']").click();
      await page.waitForFunction(() => document.querySelector(".nav a[data-view='saved']")?.textContent.trim().startsWith("Saved"));
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelectorAll("#list .library-card").length >= 1);
      assert.match(await page.locator("#list h2").first().textContent(), /自定义标题保留检查/);
      // Personal note still editable and intact via the edit path.
      await page.locator(".library-more summary").first().click();
      await page.locator("[data-action='edit-meta']").first().click();
      assert.equal(await page.inputValue("#edit-note"), "语言切换不应改动个人备注");
      await page.keyboard.press("Escape");

      // And back to Chinese: same data, Chinese UI again.
      await page.locator(".tools [data-action='settings']").click();
      await page.waitForSelector("#theme-select");
      await page.locator("[data-action='language-zh']").click();
      await page.waitForFunction(() => document.querySelector(".nav a[data-view='saved']")?.textContent.trim().startsWith("收藏"));
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.querySelectorAll("#list .library-card").length >= 1);
      assert.match(await page.locator("#list h2").first().textContent(), /自定义标题保留检查/);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("i18n web: English login and reset errors are shown in English (local mock mail)", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedEvents(store);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ locale: "en-US", viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      // Local mock: bad credentials and an invalid code never touch real mail.
          await page.route("**/api/v1/auth/login", async (route) => {
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid-credentials" }) });
      });
      await page.route("**/api/v1/auth/password-reset", async (route) => {
        await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "invalid-code" }) });
      });
      await page.route("**/api/v1/auth/request-code", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, delivery: "email", retryAfterSec: 60 }) });
      });
      await page.goto(base + "/#/reader");
      await page.waitForSelector("#view-title");

      // Password login failure is reported in English.
      await page.locator(".tools [data-action='settings']").click();
      await page.locator("dialog[open] [data-action='login']").click();
      await page.waitForSelector("#login-email");
      await page.fill("#login-email", "reader@example.com");
      await page.fill("#login-password", "Reader-test-2026!");
      await page.locator("#login-do").click();
      await page.waitForFunction(() => !document.getElementById("login-error").hidden);
      assert.match(await page.locator("#login-error").textContent(), /Incorrect email or password\./);

      // Reset flow: code step renders in English, invalid code gets an
      // English error from the local mock (no real email involved).
      await page.locator("[data-action='login-reset']").click();
      await page.waitForSelector("#login-email");
      await page.fill("#login-email", "reader@example.com");
      await page.locator("#login-send").click();
      await page.waitForSelector("#login-code");
      assert.match(await page.locator("label[for='login-code']").textContent(), /6-digit verification code/);
      await page.fill("#login-code", "000000");
      await page.fill("#login-new-password", "Reader-test-2027!");
      await page.fill("#login-new-password2", "Reader-test-2027!");
      await page.waitForFunction(() => !document.getElementById("login-verify").disabled);
      await page.locator("#login-verify").click();
      await page.waitForFunction(() => !document.getElementById("code-error").hidden);
      assert.match(await page.locator("#code-error").textContent(), /The code is invalid or expired\./);
      await context.close();
    } finally { await browser.close(); }
  });
});
