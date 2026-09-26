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

const NOW = new Date();

function repoEvent() {
  return {
    id: "evt:repo",
    title: "owner/repotool",
    source: "github-maintained",
    category: "tech",
    url: "https://github.com/owner/repotool",
    firstSeenAt: NOW.toISOString(),
    summary: "A useful tool",
    githubRepo: {
      fullName: "owner/repotool",
      description: "A useful tool for people",
      language: "Rust",
      stars: 24500,
      pushedAt: "2026-09-20T10:00:00Z",
      growth: [
        { source: "github-trending-weekly", window: "week", stars: 1234 },
        { source: "github-trending", window: "day", stars: 120 },
      ],
      signals: [
        { source: "github-trending-weekly", signal: "本周 GitHub Trending +1234 star" },
        { source: "github-maintained", signal: "近 60 天有提交 · 24500 star" },
      ],
    },
  };
}

async function seedStore() {
  const store = createMemoryStore();
  await store.putEvent(repoEvent());
  await store.putEvent({
    id: "evt:plain",
    title: "普通新闻",
    source: "hn",
    category: "tech",
    url: "https://example.com/n",
    firstSeenAt: NOW.toISOString(),
  });
  return store;
}

async function launchChromium() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (e) {
    throw new Error("playwright is required: npx playwright install chromium\n" + (e && e.message));
  }
  return chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function startStaticSite(extra = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let path = url.pathname;
    if (path === "/") path = "/index.html";
    const headers = { "cache-control": "no-store" };
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
  return { server, base: "http://127.0.0.1:" + port };
}

test("opensource entry: browser shows repo metadata, detail, and favorite keeps it", async () => {
  const store = await seedStore();
  const { server, port } = await startServer({ store, port: 0 });
  const base = "http://127.0.0.1:" + port;
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + "/#/latest", { waitUntil: "networkidle" });
    await page.locator('.bottom-nav a[data-view="opensource"]').click();
    await page.waitForFunction(() => location.hash === "#/opensource");
    await page.waitForSelector(".story h2 a");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const listText = await page.locator("#list").innerText();
    // card shows language, stars and the weekly growth window (not "今日" for weekly)
    assert.match(listText, /Rust/);
    assert.match(listText, /★ 24500/);
    assert.match(listText, /本周 \+1234 star/);
    assert.match(listText, /今日 \+120 star/);
    // plain news must not appear in the project entry
    assert.equal(listText.includes("普通新闻"), false);

    await page.locator(".story h2 a").first().click();
    await page.waitForSelector("#detail:not([hidden])");
    const detailText = await page.locator("#detail").innerText();
    assert.match(detailText, /项目信息/);
    assert.match(detailText, /A useful tool for people/);
    assert.match(detailText, /语言 Rust/);
    assert.match(detailText, /本周 \+1234 star/);
    assert.match(detailText, /最近提交/);
    assert.match(detailText, /许可证 未知/); // no license in metadata → unknown, never invented
    assert.match(detailText, /入选信号/);
    assert.match(detailText, /近 60 天有提交/);

    // favorite keeps the metadata on the saved view
    await page.locator('#detail button[data-act="save"]').click();
    await page.waitForTimeout(400);
    await page.locator('.bottom-nav a[data-view="saved"]').click();
    await page.waitForFunction(() => location.hash === "#/saved");
    await page.waitForTimeout(400);
    const savedText = await page.locator("#list").innerText();
    assert.match(savedText, /owner\/repotool/);
    assert.match(savedText, /Rust/);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("aquasight-saved") || "{}"));
    assert.equal(stored.items?.["evt:repo"]?.githubRepo?.fullName, "owner/repotool");
  } finally {
    await browser.close();
    await closeServer(server);
  }
});

test("opensource entry works from the static events.json fallback", async () => {
  const snapshot = {
    apiVersion: "v1",
    snapshotAt: NOW.toISOString(),
    items: [repoEvent(), {
      id: "evt:plain",
      title: "普通新闻",
      source: "hn",
      category: "tech",
      url: "https://example.com/n",
      publishedAt: NOW.toISOString(),
    }],
  };
  const { server, base } = await startStaticSite({
    "/events.json": { type: "application/json", body: JSON.stringify(snapshot) },
  });
  const browser = await launchChromium();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + "/#/latest", { waitUntil: "networkidle" });
    await page.locator('.bottom-nav a[data-view="opensource"]').click();
    await page.waitForFunction(() => location.hash === "#/opensource");
    await page.waitForSelector(".story h2 a");
    const text = await page.locator("#list").innerText();
    assert.match(text, /owner\/repotool/);
    assert.match(text, /★ 24500/);
    assert.equal(text.includes("普通新闻"), false);
    await page.locator(".story h2 a").first().click();
    await page.waitForSelector("#detail:not([hidden])");
    assert.match(await page.locator("#detail").innerText(), /项目信息/);
  } finally {
    await browser.close();
    await closeServer(server);
  }
});
