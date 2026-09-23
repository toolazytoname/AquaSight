import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";
import { verifyCode, COOKIE } from "../src/auth.js";

const CODE = "520814";
const EMAIL = "reader@example.com";

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

test("logout: server failure keeps the session, retry succeeds, /me confirms", async () => {
  const store = createMemoryStore();
  store.authPepper = "test-pepper";
  await store.putEvent({
    id: "evt:one",
    title: "One story",
    source: "hn",
    category: "tech",
    url: "https://example.com/1",
    publishedAt: new Date().toISOString(),
  });
  await store.putOtp({
    email: EMAIL,
    codeHash: sha256("test-pepper:" + CODE),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    attempts: 0,
  });
  // Mint the session server-side with the same code path the verify endpoint
  // uses, then hand the browser the HttpOnly cookie directly.
  const verified = await verifyCode(store, { email: EMAIL, code: CODE }, {});
  assert.equal(verified.ok, true);

  const server = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + server.port;
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    server.server.close();
    return; // browser toolchain absent (matched by other suites when present)
  }
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      // page.route cannot see fetches proxied through the app's service
      // worker; block it for this flow so the 503 injection is honest.
      serviceWorkers: "block",
    });
    await context.addCookies([
      { name: COOKIE, value: verified.token, url: base, httpOnly: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForSelector(".story");

    // The session must be a real cookie session, not a bearer token.
    const meBefore = await page.evaluate(async () => {
      const r = await fetch("/api/v1/me", { credentials: "same-origin" });
      return { status: r.status, body: await r.json() };
    });
    assert.equal(meBefore.status, 200);
    assert.equal(meBefore.body.user.email, EMAIL);
    assert.equal(await page.evaluate(() => localStorage.getItem("aquasight-token")), null);

    // Open the account sheet.
    await page.click('.tools button[data-action="settings"]');
    await page.waitForFunction(() => document.getElementById("modal")?.open);
    await page.click('#modal [data-action="login"]');
    await page.waitForSelector('#modal [data-action="logout"]');

    // 1st attempt: the server refuses to revoke — no success may be shown.
    let failLogout = true;
    await page.route("**/api/v1/auth/logout", async (route) => {
      if (failLogout) return route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"unavailable"}' });
      return route.continue();
    });
    await page.click('#modal [data-action="logout"]');
    await page.waitForFunction(() => {
      const t = document.getElementById("toast");
      return t && !t.hidden && /退出未完成/.test(t.textContent);
    });
    await page.waitForFunction(() => {
      const e = document.getElementById("logout-error");
      return e && !e.hidden && /服务器撤销会话失败/.test(e.textContent);
    });
    assert.equal(await page.evaluate(() => document.getElementById("modal").open), true, "sheet stays open for retry");
    const meAfterFail = await page.evaluate(async () => (await fetch("/api/v1/me", { credentials: "same-origin" })).status);
    assert.equal(meAfterFail, 200, "session is intact after failed logout");

    // 2nd attempt: server healthy — success only after /me confirms no live session.
    failLogout = false;
    await page.click('#modal [data-action="logout"]');
    await page.waitForFunction(() => {
      const t = document.getElementById("toast");
      return t && !t.hidden && /已退出/.test(t.textContent);
    });
    await page.waitForFunction(() => !document.getElementById("modal").open);
    // Server truth: the session row is revoked and the browser cookie is gone.
    const { loadSession } = await import("../src/auth.js");
    assert.equal(await loadSession(store, verified.token), null, "session revoked server-side");
    const remaining = (await context.cookies(base)).filter((c) => c.name === COOKIE);
    assert.equal(remaining.length, 0, "HttpOnly cookie cleared by the logout response");
  } finally {
    await browser.close();
    server.server.close();
  }
});