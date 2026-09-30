import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";
import { resetPassword } from "../src/auth.js";
import { chromium } from "playwright";

// 真实本地 handler + 内存存储的浏览器测试：认证、cookie、收藏全部走真
// 接口；验证码用“预置 OTP 行 + 真 request-code（重发窗口内不覆盖）”的
// 方式获得确定性测试码——不是生产后门，也不是全程 mock。不发真实邮件。

const SHOTS = "/tmp/aquasight-polish-web";
const TEST_PASSWORD = "correct-horse-battery-13";
const SHORT_PASSWORD = "short";
const codeHash = (code) => createHash("sha256").update("test-pepper:" + code).digest("hex");

/// 预置一个已知验证码行（sentAt=now：真实 request-code 在重发窗口内会
/// 保留该行并如实返回 delivery=sent，验证码不会被覆盖）。
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

/// 通过真实 resetPassword 直接种一个已知密码的账户（仅测试 env 固定码）。
async function seedAccount(store, email, password) {
  const code = "813426";
  await plantCode(store, email, code);
  const result = await resetPassword(store, { email, code, password, ip: "127.0.0.1", userAgent: "seed" }, {});
  assert.equal(result.ok, true);
  return result;
}

async function withServer(store, fn, envOverrides = {}) {
  const saved = {};
  for (const key of Object.keys(envOverrides)) { saved[key] = process.env[key]; process.env[key] = envOverrides[key]; }
  const server = await startServer({ store, port: 0 });
  try {
    await fn("http://127.0.0.1:" + server.port);
  } finally {
    await new Promise((resolve) => server.server.close(resolve));
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

async function shot(page, name) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: SHOTS + "/" + name + ".png", fullPage: false });
}

/// 统一入口：工具栏「设置」→ 账户区「登录」，桌面/移动布局都可用。
/// 显式落在 #/featured：站点默认首页已是订阅阅读（#/reader），登录流程
/// 测试关注的是账户功能而非默认视图。
async function openLogin(page, base) {
  await page.goto(base + "/#/featured");
  await page.locator(".tools [data-action='settings']").click();
  await page.locator("#modal [data-action='login']").click();
  await page.locator("#login-form").waitFor();
}

test("password login: focus, show/hide, wrong then right, logout, re-login", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "hello@example.com";
  await seedAccount(store, email, TEST_PASSWORD);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await openLogin(page, base);
      // 焦点与结构：邮箱自动聚焦，密码为 current-password，弹窗内聚焦。
      assert.equal(await page.evaluate(() => document.activeElement?.id), "login-email");
      assert.equal(await page.getAttribute("#login-password", "autocomplete"), "current-password");
      assert.equal(await page.getAttribute("#login-email", "autocomplete"), "username");
      await shot(page, "login-default-mobile-light");

      // 显示/隐藏密码。
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator('[data-pw-for="login-password"]').click();
      assert.equal(await page.getAttribute("#login-password", "type"), "text");
      await page.locator('[data-pw-for="login-password"]').click();
      assert.equal(await page.getAttribute("#login-password", "type"), "password");

      // 错密码：401 → 明确报错，停留在弹窗。
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill("definitely-wrong-pass");
      await page.locator("#login-do").click();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /邮箱或密码不正确/);
      assert.equal(await page.locator("#login-form").count(), 1, "stays on password step");
      await shot(page, "login-error-mobile-light");

      // 正确密码：登录成功，账户标签更新，HttpOnly cookie（不输出值）。
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("#login-do").click();
      await page.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("hello@"));
      const cookies = await context.cookies(base);
      const session = cookies.find((c) => c.name === "aqs_session");
      assert.ok(session && session.httpOnly, "HttpOnly session cookie set");

      // 密码/邮箱不得进入 localStorage。
      const stored = await page.evaluate(() => JSON.stringify(localStorage));
      assert.ok(!stored.includes(TEST_PASSWORD), "password must not persist in localStorage");

      // 退出（真实 POST）→ 回到游客；再登录一次。
      await page.locator(".tools [data-action='settings']").click();
      await page.locator("#modal [data-action='login']").click();
      await page.locator("#modal [data-action='logout']").click();
      await page.waitForFunction(() => (document.getElementById("account-label")?.textContent || "").includes("登录"));
      await openLogin(page, base);
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("#login-do").click();
      await page.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("hello@"));
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("register flow: real request-code, wrong code rejected, weak password blocked, account created", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "newbie@example.com";
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      // 预置验证码 + 让真实 request-code 在窗口内保留该行。
      const code = "415523";
      await plantCode(store, email, code);

      await openLogin(page, base);
      await page.locator('[data-action="login-register"]').click();
      await page.locator("#code-email-form").waitFor();
      assert.match(await page.textContent("#modal"), /注册/);
      await page.locator("#login-email").fill(email);
      // 先挂监听再点击，避免响应先到的竞态。
      const sentPromise = page.waitForResponse((r) => r.url().endsWith("/api/v1/auth/request-code") && r.ok());
      await page.locator("#login-send").click();
      // 真 request-code POST 成功后才进入码+密码页。
      const sent = await sentPromise;
      assert.equal(sent.request().method(), "POST");
      await page.locator("#code-password-form").waitFor();
      await shot(page, "register-verify-mobile-light");
      assert.match(await page.textContent(".login-email-chip"), new RegExp(email.replace(".", "\\.")));
      assert.equal(await page.getAttribute("#login-new-password", "autocomplete"), "new-password");
      assert.equal(await page.getAttribute("#login-code", "autocomplete"), "one-time-code");
      assert.match(await page.textContent("#resend-countdown"), /重新发送（\d+ 秒）/);
      // 提交按钮在补全前保持禁用。
      assert.equal(await page.isDisabled("#login-verify"), true);

      // 弱密码：客户端即拦（不消耗验证码尝试次数）。
      await page.locator("#login-code").fill(code);
      await page.locator("#login-new-password").fill(SHORT_PASSWORD);
      await page.locator("#login-new-password2").fill(SHORT_PASSWORD);
      assert.equal(await page.isDisabled("#login-verify"), true, "short password must keep submit disabled");
      // 两次不一致同样禁用。
      await page.locator("#login-new-password").fill(TEST_PASSWORD);
      await page.locator("#login-new-password2").fill(TEST_PASSWORD + "x");
      assert.equal(await page.isDisabled("#login-verify"), true);

      // 错验证码：真实 401 → 报错可重试。
      await page.locator("#login-code").fill("000000");
      await page.locator("#login-new-password2").fill(TEST_PASSWORD);
      await page.locator("#login-verify").click();
      await page.waitForFunction(() => !document.getElementById("code-error")?.hidden);
      assert.match(await page.textContent("#code-error"), /验证码无效或已过期/);

      // 更换邮箱 → 回第一步且邮箱保留；再走回来（不重发，直接进码页需重
      // 新发送；这里验证返回行为本身）。
      await page.locator("#login-change-email").click();
      await page.locator("#code-email-form").waitFor();
      assert.equal(await page.inputValue("#login-email"), email);

      // 完整注册成功：重发 → 码页 → 正确码 + 新密码。
      await page.locator("#login-send").click();
      await page.locator("#code-password-form").waitFor();
      await page.locator("#login-code").fill(code);
      await page.locator("#login-new-password").fill(TEST_PASSWORD);
      await page.locator("#login-new-password2").fill(TEST_PASSWORD);
      await page.locator("#login-verify").click();
      await page.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("newbie@"));
      const user = await store.getUserByEmail(email);
      assert.ok(user, "account row created via real handlers");
      const stored = await page.evaluate(() => JSON.stringify(localStorage));
      assert.ok(!stored.includes(TEST_PASSWORD) && !stored.includes(code), "no secrets in localStorage");
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("forgot password: reset existing account, old password stops working, new one logs in", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "reset@example.com";
  await seedAccount(store, email, TEST_PASSWORD);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      const newPassword = "brand-new-passphrase-42";

      await openLogin(page, base);
      await page.locator('[data-action="login-reset"]').click();
      await page.locator("#code-email-form").waitFor();
      assert.match(await page.textContent("#modal"), /找回密码|首次设置/);
      const code = "998211";
      await plantCode(store, email, code);
      await page.locator("#login-email").fill(email);
      await page.locator("#login-send").click();
      await page.locator("#code-password-form").waitFor();
      await page.locator("#login-code").fill(code);
      await page.locator("#login-new-password").fill(newPassword);
      await page.locator("#login-new-password2").fill(newPassword);
      await page.locator("#login-verify").click();
      await page.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("reset@"));

      // 退出后：旧密码失败，新密码成功。
      await page.locator(".tools [data-action='settings']").click();
      await page.locator("#modal [data-action='login']").click();
      await page.locator("#modal [data-action='logout']").click();
      await page.waitForFunction(() => (document.getElementById("account-label")?.textContent || "").includes("登录"));
      await openLogin(page, base);
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("#login-do").click();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /邮箱或密码不正确/);
      await shot(page, "login-error-desktop-dark");
      await page.locator("#login-password").fill(newPassword);
      await page.locator("#login-do").click();
      await page.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("reset@"));
      assert.deepEqual(errors, []);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("mail unavailable and request failure keep the flow on the email step", async () => {
  // 1) delivery=unavailable：OTP 模式 + log driver → 服务端如实返回不可用。
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));
      await openLogin(page, base);
      await page.locator('[data-action="login-register"]').click();
      await page.locator("#login-email").fill("unavail@example.com");
      await page.locator("#login-send").click();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /邮件服务暂时不可用/);
      assert.equal(await page.locator("#login-code").count(), 0, "must NOT advance to code step");
      assert.equal(await page.isDisabled("#login-send"), false, "retry enabled");
      await context.close();
      assert.deepEqual(errors, []);
    } finally { await browser.close(); }
  }, { AUTH_MODE: "otp", MAIL_DRIVER: "log" });

  // 2) 请求失败（网络错误注入）：报错并停留第一步。
  const store2 = createMemoryStore(); store2.authPepper = "test-pepper";
  await withServer(store2, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.route("**/api/v1/auth/request-code", (route) => route.abort("connectionreset"));
      await openLogin(page, base);
      await page.locator('[data-action="login-register"]').click();
      await page.locator("#login-email").fill("broken@example.com");
      await page.locator("#login-send").click();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /发不出验证码/);
      assert.equal(await page.locator("#login-code").count(), 0);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("login from #/reader-settings returns to the subscription page", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "route@example.com";
  await seedAccount(store, email, TEST_PASSWORD);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/reader-settings");
      await page.locator("#list [data-action='login']").click();
      await page.locator("#login-form").waitFor();
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("#login-do").click();
      await page.locator("#reader-root").waitFor();
      assert.ok(page.url().endsWith("#/reader-settings"), "returns to subscription route");
      await shot(page, "subscription-after-login-mobile-light");
      await context.close();
    } finally { await browser.close(); }
  });
});

test("favorites sync across two independent browser contexts for the same account", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "sync@example.com";
  await seedAccount(store, email, TEST_PASSWORD);
  await store.putEvent({
    id: "evt:sync-story",
    title: "Sync story",
    titleZh: "同步故事",
    url: "https://example.com/sync",
    source: "hn",
    category: "tech",
    level: "normal",
    value: 0.8,
    score: 8,
    publishedAt: new Date(Date.now() - 3600_000).toISOString(),
  });
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      // Context A：登录并收藏第一条。
      const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", serviceWorkers: "block" });
      const a = await ctxA.newPage();
      await openLogin(a, base);
      await a.locator("#login-email").fill(email);
      await a.locator("#login-password").fill(TEST_PASSWORD);
      await a.locator("#login-do").click();
      await a.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("sync@"));
      const favPosted = a.waitForResponse((r) => r.url().endsWith("/api/v1/favorites") && r.request().method() === "POST" && r.ok());
      await a.locator('button[data-act="save"]').first().click();
      await favPosted;
      await ctxA.close();

      // Context B：独立环境，同账户密码登录 → 收藏页看到同一条。
      const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", serviceWorkers: "block" });
      const b = await ctxB.newPage();
      await openLogin(b, base);
      await b.locator("#login-email").fill(email);
      await b.locator("#login-password").fill(TEST_PASSWORD);
      await b.locator("#login-do").click();
      await b.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("sync@"));
      await b.goto(base + "/#/saved");
      await b.waitForFunction(() => (document.querySelector("#list")?.textContent || "").includes("同步故事"));
      await shot(b, "saved-sync-desktop-dark");
      await ctxB.close();
    } finally { await browser.close(); }
  });
});

test("closing and Escape wipe password/code inputs; reopened dialog starts empty", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedAccount(store, "wipe@example.com", TEST_PASSWORD);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await openLogin(page, base);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("[data-close]").click();
      await page.waitForFunction(() => !document.querySelector("#modal")?.open);
      // 关闭后：表单 DOM 被移除，文档里没有任何密码残留。
      assert.equal(await page.locator("#login-password").count(), 0);
      assert.equal(await page.evaluate(() => document.querySelector("#modal")?.innerHTML.includes("password")), false, "no password inputs left in DOM");

      // 原生 Escape 同样清空。
      await openLogin(page, base);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("#modal")?.open);
      assert.equal(await page.locator("#login-password").count(), 0);

      // 重开：密码为空。
      await openLogin(page, base);
      assert.equal(await page.inputValue("#login-password"), "");
      await context.close();
    } finally { await browser.close(); }
  });
});

test("pending login locks inputs, mode switch, close and Escape; failure restores", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedAccount(store, "gate@example.com", TEST_PASSWORD);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      let first = true;
      await page.route("**/api/v1/auth/login", async (route) => {
        if (first) { first = false; await gate; }
        return route.continue();
      });

      await openLogin(page, base);
      await page.locator("#login-email").fill("gate@example.com");
      await page.locator("#login-password").fill("whatever-wrong-1");
      await page.locator("#login-do").click();
      await page.waitForFunction(() => document.getElementById("login-do")?.textContent.includes("登录中"));

      // pending 期间：输入、模式切换、关闭按钮全部锁定；Escape 不能关。
      assert.equal(await page.isDisabled("#login-email"), true);
      assert.equal(await page.isDisabled("#login-password"), true);
      assert.equal(await page.isDisabled('[data-action="login-register"]'), true);
      assert.equal(await page.isDisabled('[data-action="login-reset"]'), true);
      assert.equal(await page.isDisabled("[data-close]"), true);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => document.querySelector("#modal")?.open), true, "Escape must not close during pending");

      // 释放为失败（真实 401 invalid-credentials）：恢复可编辑 + 明确报错。
      release();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /邮箱或密码不正确/);
      assert.equal(await page.isDisabled("#login-email"), false);
      assert.equal(await page.isDisabled('[data-action="login-register"]'), false);
      assert.equal(await page.isDisabled("[data-close]"), false);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("invalid email never sends; legacy unauthorized 401 gets a service-level message", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  await seedAccount(store, "legacy@example.com", TEST_PASSWORD);
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();

      // 注册第一步：非法邮箱被 validity 拦下，不发出请求。
      await openLogin(page, base);
      await page.locator('[data-action="login-register"]').click();
      let requested = false;
      await page.route("**/api/v1/auth/request-code", (route) => { requested = true; return route.continue(); });
      await page.locator("#login-email").fill("foo");
      await page.locator("#login-send").click();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /有效的邮箱地址/);
      assert.equal(requested, false, "no request for invalid email");
      assert.equal(await page.locator("#code-password-form").count(), 0);

      // 旧端点 401 unauthorized：不是“密码错”，提示服务待更新。
      await page.unrouteAll({ behavior: "wait" });
      await page.route("**/api/v1/auth/login", (route) =>
        route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"unauthorized","apiVersion":"v1"}' }));
      await page.locator("[data-close]").click();
      await page.locator(".tools [data-action='settings']").click();
      await page.locator("#modal [data-action='login']").click();
      await page.locator("#login-form").waitFor();
      await page.locator("#login-email").fill("legacy@example.com");
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("#login-do").click();
      await page.waitForFunction(() => !document.getElementById("login-error")?.hidden);
      assert.match(await page.textContent("#login-error"), /暂时不可用/);
      assert.doesNotMatch(await page.textContent("#login-error"), /邮箱或密码不正确/);
      await context.close();
    } finally { await browser.close(); }
  });
});

test("fresh email registers with a real randomly-generated code (only the mail transport is faked)", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "fresh-code@example.com";
  await withServer(store, async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark", serviceWorkers: "block" });
      const page = await context.newPage();
      const errors = []; page.on("pageerror", (e) => errors.push(e.message));

      // 仅拦截 Resend 传输：request-code/verify/cookie/store 全部真实。
      const sent = [];
      const realFetch = globalThis.fetch;
      const { RESEND_ENDPOINT } = await import("../src/mail.js");
      globalThis.fetch = async (input, init) => {
        const url = String(input && input.url ? input.url : input);
        if (url === RESEND_ENDPOINT) {
          const body = JSON.parse(String(init?.body || "{}"));
          sent.push(body);
          return new Response(JSON.stringify({ id: "fake-send" }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return realFetch(input, init);
      };
      try {
        await openLogin(page, base);
        await page.locator('[data-action="login-register"]').click();
        await page.locator("#login-email").fill(email);
        await page.locator("#login-send").click();
        await page.locator("#code-password-form").waitFor({ timeout: 15000 });
        // 从投递的邮件 HTML 中解析随机验证码（不打印）。
        assert.equal(sent.length, 1, "exactly one mail delivery attempt");
        const html = sent[0].html || "";
        const match = /<strong>(\d{6})<\/strong>/.exec(html);
        assert.ok(match, "code present in delivered mail html");
        const code = match[1];

        await page.locator("#login-code").fill(code);
        await page.locator("#login-new-password").fill(TEST_PASSWORD);
        await page.locator("#login-new-password2").fill(TEST_PASSWORD);
        await page.locator("#login-verify").click();
        await page.waitForFunction(() => document.getElementById("account-label")?.textContent?.includes("fresh-code@"));
        const user = await store.getUserByEmail(email);
        assert.ok(user, "account created from real random code");
        const stored = await page.evaluate(() => JSON.stringify(localStorage));
        assert.ok(!stored.includes(TEST_PASSWORD) && !stored.includes(code));
        assert.deepEqual(errors, []);
      } finally {
        globalThis.fetch = realFetch;
      }
      await context.close();
    } finally { await browser.close(); }
  }, { MAIL_DRIVER: "resend", MAIL_API_KEY: "test-only-key" });
});

test("subscription-page login enables immediate favorite sync and logout clears account data", async () => {
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "subscription-login@example.com";
  await seedAccount(store, email, TEST_PASSWORD);
  await store.putEvent({ id: "subscription-save", title: "同步回归", source: "openai", url: "https://openai.com/", publishedAt: new Date().toISOString() });
  await withServer(store, async base => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const page = await context.newPage();
      await page.goto(base + "/#/reader-settings");
      await page.locator('.tools [data-action="settings"]').click();
      await page.locator('#modal [data-action="login"]').click();
      await page.locator("#login-email").fill(email);
      await page.locator("#login-password").fill(TEST_PASSWORD);
      await page.locator("#login-do").click();
      await page.waitForFunction(() => !document.querySelector("#login-form"));
      await page.goto(base + "/#/event/subscription-save");
      const saved = page.waitForResponse(r => r.url().endsWith("/api/v1/favorites") && r.request().method() === "POST" && r.ok());
      await page.locator('[data-act="save"][data-id="subscription-save"]:visible').click();
      await saved;
      const remote = await (await context.request.get(base + "/api/v1/favorites")).json();
      assert.ok(remote.items.some(item => item.id === "subscription-save"));
      await page.goto(base + "/#/saved");
      const removed = page.waitForResponse(r => r.url().endsWith("/api/v1/favorites/subscription-save") && r.request().method() === "DELETE" && r.ok());
      await page.locator('[data-act="save"][data-id="subscription-save"]:visible').click();
      await removed;
      assert.deepEqual((await (await context.request.get(base + "/api/v1/favorites")).json()).items, []);
      // Seed a local account item again to verify logout isolation too.
      await page.goto(base + "/#/event/subscription-save");
      const resaved = page.waitForResponse(r => r.url().endsWith("/api/v1/favorites") && r.request().method() === "POST" && r.ok());
      await page.locator('[data-act="save"][data-id="subscription-save"]:visible').click();
      await resaved;
      await page.locator('.tools [data-action="settings"]').click();
      await page.locator('#modal [data-action="login"]').click();
      await page.locator('#modal [data-action="logout"]').click();
      await page.waitForFunction(() => document.querySelector("#account-label")?.textContent.includes("登录"));
      const local = await page.evaluate(() => JSON.parse(localStorage.getItem("aquasight-saved")));
      assert.deepEqual(local.items, {});
      assert.deepEqual(local.pending, {});
      assert.equal((await context.request.get(base + "/api/v1/favorites")).status(), 401);
    } finally { await browser.close(); }
  }, { AUTH_MODE: "otp", MAIL_DRIVER: "log" });
});
