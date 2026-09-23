// Production screenshots with real content. Read-only.
// Usage: node scripts/capture-live.mjs [base-url]
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "design", "shots-acceptance");
const BASE = (process.argv[2] || "https://quack.weichao.ren").replace(/\/+$/, "");

const SHOTS = {
  "desktop-featured": { viewport: { width: 1440, height: 900 }, goto: "/", wait: ".story" },
  "desktop-digest": { viewport: { width: 1440, height: 900 }, goto: "/#/digest", wait: ".edition" },
  "desktop-latest": { viewport: { width: 1440, height: 900 }, goto: "/#/latest", wait: ".date-section, .story" },
  "mobile-featured": { viewport: { width: 390, height: 844 }, goto: "/", wait: ".story" },
  "mobile-digest": { viewport: { width: 390, height: 844 }, goto: "/#/digest", wait: ".edition" },
  "mobile-latest": { viewport: { width: 390, height: 844 }, goto: "/#/latest", wait: ".date-section, .story" },
  "mobile-settings": {
    viewport: { width: 390, height: 844 },
    goto: "/",
    wait: ".story",
    then: async (page) => {
      await page.click('.tools button[data-action="settings"]');
      await page.waitForFunction(() => document.getElementById("modal")?.open);
      await page.click(".status-details summary").catch(() => {});
    },
  },
  "mobile-detail": {
    viewport: { width: 390, height: 844 },
    goto: "/",
    wait: ".story h2 a",
    then: async (page) => {
      await page.click(".story h2 a");
      await page.waitForSelector("#detail h1");
    },
  },
};

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
await mkdir(OUT, { recursive: true });
for (const [name, shot] of Object.entries(SHOTS)) {
  const page = await browser.newPage({ viewport: shot.viewport, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await page.goto(BASE + shot.goto, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(shot.wait, { timeout: 20000 });
  if (shot.then) await shot.then(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, name + ".png") });
  await page.close();
  console.log("captured", name);
}
await browser.close();
