import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(root, "web");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};

async function seedStore() {
  const store = createMemoryStore();
  await store.putEvent({
    id: "evt:read",
    title: "OpenAI launches GPT-5 API",
    titleZh: "OpenAI 发布 GPT-5 接口",
    overviewZh: "官方发布，API 现已可用。",
    facts: ["API 可用", "面向开发者"],
    impact: "开发者可接入。",
    evidence: ["官方博客"],
    uncertainty: ["具体配额未公布"],
    attribution: [{ claim: "企业自报、尚未独立验证", source: "openai" }],
    source: "openai",
    category: "tech",
    value: 0.9,
    subject: "openai",
    url: "https://openai.com/gpt5",
    publishedAt: "2026-09-02T10:00:00.000Z",
    sources: [
      { source: "openai", url: "https://openai.com/gpt5", title: "OpenAI launches GPT-5 API" },
      { source: "openai", url: "https://openai.com/gpt5", title: "duplicate" },
    ],
  });
  await store.putEvent({
    id: "evt:long",
    title: "A very long 36kr article",
    source: "36kr",
    category: "business",
    summary: "字".repeat(4000),
    url: "https://36kr.com/p/1",
    publishedAt: "2026-09-02T11:00:00.000Z",
  });
  return store;
}

async function launchChromium() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    throw new Error(
      "playwright is required for browser tests. Run: npm ci && npx playwright install chromium --with-deps\n" +
        (e && e.message ? e.message : e)
    );
  }
  try {
    return await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });
  } catch (e) {
    throw new Error(
      "Chromium is required for browser tests. Run: npx playwright install chromium --with-deps\n" +
        (e && e.message ? e.message : e)
    );
  }
}

async function startStaticSite(opts = {}) {
  const extra = opts.extra || {};
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = url.pathname;
    if (path === "/") path = "/index.html";
    const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
    if (path.startsWith("/api/")) {
      res.writeHead(404, { ...headers, "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
      return;
    }
    const override = typeof extra[path] === "function" ? extra[path]() : extra[path];
    if (override) {
      res.writeHead(200, { ...headers, "content-type": override.type || "text/plain; charset=utf-8" });
      res.end(override.body);
      return;
    }
    try {
      const file = join(WEB, path.replace(/^\//, ""));
      if (!file.startsWith(WEB)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      const data = await readFile(file);
      res.writeHead(200, { ...headers, "content-type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  return { server, port, base: "http://127.0.0.1:" + port };
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("browser reading flow: featured, detail, search, favorite", async () => {
  const store = await seedStore();
  const { server, port } = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + port;
  try {
    const html = await (await fetch(base + "/")).text();
    assert.match(html, /精选/);
    assert.match(html, /收藏/);
    const css = await fetch(base + "/style.css");
    assert.equal(css.ok, true);
    const list = await (await fetch(base + "/api/v1/events?view=featured")).json();
    assert.equal(list.apiVersion, "v1");
    assert.ok(list.items.some((it) => it.id === "evt:read"));
    const detail = await (await fetch(base + "/api/v1/events/evt:read")).json();
    assert.match(detail.item.titleZh, /GPT-5/);
    assert.ok(Array.isArray(detail.item.facts));
    assert.equal(detail.item.impact, "开发者可接入。");
    assert.ok(detail.item.attribution.some((a) => /企业自报/.test(a.claim)));
    const searched = await (await fetch(base + "/api/v1/events?q=GPT-5")).json();
    assert.ok(searched.items.length >= 1);
    const fav = await fetch(base + "/api/v1/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: "evt:read" }),
    });
    assert.equal(fav.ok, true);
    const saved = await (await fetch(base + "/api/v1/favorites")).json();
    assert.equal(saved.items.length, 1);
  } finally {
    await closeServer(server);
  }
});

test("clicking a card opens detail and hides the feed", async () => {
  const browser = await launchChromium();
  const store = await seedStore();
  const { server, port } = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + port;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + "/#/featured", { waitUntil: "networkidle" });
    await page.waitForSelector(".card a.title");
    const firstBox = await page.locator(".card").first().evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });
    assert.ok(firstBox.top < 340, "first card should start near the top, got " + firstBox.top);
    assert.ok(firstBox.height < 420, "card should not be full article height, got " + firstBox.height);
    await page.locator(".card a.title").first().click();
    await page.waitForSelector("#detail:not([hidden])");
    const listHidden = await page.locator("#list").evaluate((el) => {
      const cs = getComputedStyle(el);
      return el.hidden === true && cs.display === "none";
    });
    assert.equal(listHidden, true);
    const detailTop = await page.locator("#detail").evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(detailTop < 200, "detail should be on screen, got " + detailTop);
    assert.match(await page.locator("#detail").innerText(), /OpenAI|36氪|原文摘录|暂无摘要|GPT-5/);
    await page.locator(".more-tools > summary").click();
    await page.locator("#settings-btn").click({ timeout: 5000 });
    await page.waitForSelector("#settings:not([hidden])");
    const settingsBox = await page.locator(".settings-card").evaluate((el) => el.getBoundingClientRect());
    assert.ok(settingsBox.top < 400 && settingsBox.height > 80);
    await page.locator("#settings-close").click();
    const settingsHidden = await page.locator("#settings").evaluate((el) => el.hidden);
    assert.equal(settingsHidden, true);
  } finally {
    await browser.close();
    await closeServer(server);
  }
});

test("390px bottom nav can open featured, latest, digest, and saved", async () => {
  const browser = await launchChromium();
  const store = await seedStore();
  const { server, port } = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + port;
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + "/#/featured", { waitUntil: "networkidle" });
    await page.waitForSelector(".bottom-nav");
    const navDisplay = await page.locator(".nav").evaluate((el) => getComputedStyle(el).display);
    const bottomDisplay = await page.locator(".bottom-nav").evaluate((el) => getComputedStyle(el).display);
    assert.equal(navDisplay, "none");
    assert.equal(bottomDisplay, "flex");
    for (const view of ["featured", "latest", "digest", "saved"]) {
      const tab = page.locator('.bottom-nav a[data-view="' + view + '"]');
      assert.equal(await tab.isVisible(), true, view + " tab should be visible");
      await tab.click();
      await page.waitForFunction((v) => {
        const el = document.querySelector('.bottom-nav a[data-view="' + v + '"]');
        return location.hash === "#/" + v && el && el.getAttribute("aria-current") === "page";
      }, view);
    }
  } finally {
    await browser.close();
    await closeServer(server);
  }
});

test("fresh page can open a notify event url from the static snapshot", async () => {
  const snapshot = {
    apiVersion: "v1",
    items: [
      {
        id: "evt:notify-cold",
        titleZh: "冷开通知标题",
        overviewZh: "来自新闻快照的概述。",
        source: "36kr",
        category: "tech",
        url: "https://36kr.com/p/cold",
        publishedAt: "2026-09-02T10:00:00.000Z",
      },
    ],
  };
  const { server, base } = await startStaticSite({
    extra: {
      "/events.json": { type: "application/json", body: JSON.stringify(snapshot) },
    },
  });
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + "/#/event/" + encodeURIComponent("evt:notify-cold"), {
      waitUntil: "networkidle",
    });
    await page.waitForSelector("#detail:not([hidden])");
    const text = await page.locator("#detail").innerText();
    assert.match(text, /冷开通知标题/);
    assert.equal(text.includes("事件不存在或未登录"), false);
  } finally {
    await browser.close();
    await closeServer(server);
  }
});

test("service worker replaces an old shell cache with the new version", async () => {
  const indexHtml = await readFile(join(WEB, "index.html"), "utf8");
  const oldIndex = indexHtml.replace("<body>", "<body><!-- OLD_SHELL_MARKER -->");
  const oldSw = [
    'const SHELL = "aquasight-shell-v3";',
    'const PRIVATE = "aquasight-private-v3";',
    "self.addEventListener('install', (event) => {",
    "  event.waitUntil(",
    "    caches.open(SHELL).then((cache) => cache.addAll(['./', './index.html', './style.css', './app.js', './rules.js'])).then(() => self.skipWaiting())",
    "  );",
    "});",
    "self.addEventListener('activate', (event) => {",
    "  event.waitUntil(",
    "    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== PRIVATE).map((k) => caches.delete(k)))).then(() => self.clients.claim())",
    "  );",
    "});",
    "self.addEventListener('fetch', (event) => {",
    "  event.respondWith(caches.match(event.request).then((hit) => hit || fetch(event.request)));",
    "});",
  ].join("\n");
  let mode = "old";
  const { server, base } = await startStaticSite({
    extra: {
      "/sw.js": () =>
        mode === "old"
          ? { type: "text/javascript; charset=utf-8", body: oldSw }
          : null,
      "/index.html": () =>
        mode === "old"
          ? { type: "text/html; charset=utf-8", body: oldIndex }
          : null,
    },
  });
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 20000 });
    const keysOld = await page.evaluate(() => caches.keys());
    assert.ok(keysOld.includes("aquasight-shell-v3"), "old shell cache missing: " + keysOld.join(","));
    assert.match(await page.content(), /OLD_SHELL_MARKER/);
    mode = "new";
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) throw new Error("no service worker registration");
      const changed = new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
      await reg.update();
      await Promise.race([changed, new Promise((resolve) => setTimeout(resolve, 8000))]);
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => navigator.serviceWorker.controller, { timeout: 20000 });
    const keysNew = await page.evaluate(() => caches.keys());
    assert.ok(keysNew.includes("aquasight-shell-v4"), "new shell cache missing: " + keysNew.join(","));
    assert.equal(keysNew.includes("aquasight-shell-v3"), false);
    assert.equal((await page.content()).includes("OLD_SHELL_MARKER"), false);
  } finally {
    await browser.close();
    await closeServer(server);
  }
});
