import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";
import { verifyCode, COOKIE } from "../src/auth.js";
import { chromium } from "playwright";

async function user(store, email) {
  const code = "520814";
  await store.putOtp({ email, codeHash: createHash("sha256").update("test-pepper:" + code).digest("hex"), expiresAt: new Date(Date.now() + 600000).toISOString(), attempts: 0 });
  const result = await verifyCode(store, { email, code }, {});
  assert.equal(result.ok, true);
  return result;
}

test("personal subscription UI saves, retains disabled choices and retries errors on mobile and desktop", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const account = await user(store, "subscriptions@example.com");
  const server = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + server.port;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, width, colorScheme] of [["mobile", 390, "light"], ["desktop-dark", 1280, "dark"]]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, serviceWorkers: "block" });
      await context.addCookies([{ name: COOKIE, value: account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
      const page = await context.newPage();
      const errors = []; page.on("pageerror", e => errors.push(e.message));
      await page.goto(base + "/#/reader-settings");
      const more = page.locator("#reader-more");
      await more.waitFor();
      assert.equal(await more.isChecked(), false);
      await page.locator('[data-reader-source][value="openai"]').check();
      await more.focus(); await more.press("Space");
      assert.equal(await page.evaluate(() => document.activeElement?.id), "reader-more");
      const bbc = page.locator('[data-reader-source][value="bbc"]');
      await bbc.check();
      let fail = true, releaseFailure;
      const failureGate = new Promise(resolve => { releaseFailure = resolve; });
      await page.route("**/api/v1/reader/settings", async route => {
        if (route.request().method() === "PUT" && fail) {
          await failureGate;
          return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
        }
        return route.continue();
      });
      try {
        await page.locator("#reader-save").click();
        assert.equal(await more.isDisabled(), true);
        assert.equal(await bbc.isDisabled(), true);
      } finally { releaseFailure(); }
      await page.waitForFunction(() => document.querySelector("#reader-error")?.textContent.includes("保存失败"));
      assert.equal(await bbc.isChecked(), true);
      fail = false;
      await page.locator("#reader-save").click();
      await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("已保存"));
      let prefs = (await store.getPrefs({ userId: account.user.id })).reader;
      assert.equal(prefs.moreSourcesEnabled, true);
      assert.ok(prefs.selectedSources.includes("bbc"));
      if (process.env.READER_SCREENSHOTS_DIR) {
        await mkdir(process.env.READER_SCREENSHOTS_DIR, { recursive: true });
        await page.screenshot({ path: process.env.READER_SCREENSHOTS_DIR + "/web-" + name + ".png", fullPage: true });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await more.uncheck();
      assert.equal(await bbc.isDisabled(), true);
      assert.equal(await bbc.isChecked(), true);
      const saved = page.waitForResponse(r => r.url().endsWith("/api/v1/reader/settings") && r.request().method() === "PUT" && r.ok());
      await page.locator("#reader-save").click(); await saved;
      prefs = (await store.getPrefs({ userId: account.user.id })).reader;
      assert.equal(prefs.moreSourcesEnabled, false);
      assert.ok(prefs.selectedSources.includes("bbc"));
      await page.reload(); await more.waitFor();
      assert.equal(await more.isChecked(), false);
      assert.equal(await page.locator('[data-reader-source][value="bbc"]').isChecked(), true);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.server.close(resolve)); }
});

test("subscription drafts stay with their owner through logout and another login", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const account = await user(store, "owner-a@example.com");
  const server = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + server.port;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
    await context.addCookies([{ name: COOKIE, value: account.token, url: base, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    await page.goto(base + "/#/reader-settings");
    await page.locator('[data-reader-source][value="openai"]').check();
    await page.locator('.tools [data-action="settings"]').click();
    await page.locator('#modal [data-action="login"]').click();
    await page.locator('#modal [data-action="logout"]').click();
    await page.waitForFunction(() => !document.querySelector("#modal")?.open);
    // 新 UI：注册入口 → 邮箱 → 真实 request-code（预置码在重发窗口内保留）
    // → 验证码 + 新密码（password-reset）→ 登录为 owner-b。
    const code = "621845", email = "owner-b@example.com";
    await store.putOtp({ email, codeHash: createHash("sha256").update("test-pepper:" + code).digest("hex"), expiresAt: new Date(Date.now() + 600000).toISOString(), attempts: 0, sentAt: new Date().toISOString() });
    await page.locator('#list [data-action="login"]').click();
    await page.locator('[data-action="login-register"]').click();
    await page.locator("#login-email").fill(email);
    await page.locator('#code-email-form button[type="submit"]').click();
    await page.locator("#login-code").fill(code);
    const testPassword = "temporary-test-pass-1";
    await page.locator("#login-new-password").fill(testPassword);
    await page.locator("#login-new-password2").fill(testPassword);
    await page.locator('#code-password-form button[type="submit"]').click();
    await page.locator("#reader-more").waitFor();
    assert.equal(await page.locator('[data-reader-source][value="openai"]').isChecked(), false);
    assert.equal(await page.locator("#reader-more").isChecked(), false);
    assert.ok(page.url().endsWith("#/reader-settings"));
  } finally { await browser.close(); await new Promise(resolve => server.server.close(resolve)); }
});
