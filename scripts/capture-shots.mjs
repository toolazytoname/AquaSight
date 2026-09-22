// Re-capture implementation screenshots for design comparison.
// Usage: node scripts/capture-shots.mjs [names...]  (default: the fixed views)
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.js";
import { createMemoryStore } from "../src/store/memory.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(root, "web");
const OUT = join(root, "docs", "design", "shots-impl");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
};

const hoursAgoIso = (h) => new Date(Date.now() - h * 3600000).toISOString();
const daysAgoIso = (d) => new Date(Date.now() - d * 86400000).toISOString();

async function seedStore() {
  const store = createMemoryStore();
  const mk = (id, over = {}) =>
    store.putEvent({
      id,
      title: over.title || "Item " + id,
      source: over.source || "hn",
      category: over.category || "tech",
      url: "https://example.com/" + id,
      publishedAt: over.publishedAt || hoursAgoIso(2),
      ...over,
    });
  await mk("evt:lead", {
    title: "Anthropic 发布 Claude 5，长上下文与工具调用全面升级",
    titleZh: "Anthropic 发布 Claude 5，长上下文与工具调用全面升级",
    overviewZh: "新模型在推理、编码与多步工具调用上全面超越上一代，上下文窗口扩展到 200 万 token，并面向 API 用户开放。",
    source: "anthropic",
    category: "tech",
    value: 0.95,
    aiState: "ready",
    publishedAt: hoursAgoIso(3),
    sources: [
      { source: "anthropic", url: "https://anthropic.com/news/claude-5", title: "Claude 5 announcement" },
      { source: "techcrunch", url: "https://techcrunch.com/2026/claude-5", title: "Anthropic launches Claude 5" },
      { source: "theverge", url: "https://theverge.com/claude-5", title: "Claude 5 is here" },
    ],
    facts: ["上下文窗口扩展至 200 万 token", "工具调用成功率提升 40%", "API 价格与上一代持平"],
    impact: "多步 Agent 工作流的可用性显著提高，编码场景收益最大。",
    uncertainty: ["第三方基准尚未复现官方数字"],
    attribution: [{ claim: "性能数字为企业自报", source: "anthropic" }],
  });
  await mk("evt:two", {
    title: "欧盟《AI 法案》高影响条款正式生效",
    titleZh: "欧盟《AI 法案》高影响条款正式生效",
    overviewZh: "通用大模型的透明度义务开始执行，未合规模型面临最高全球营业额 3% 的罚款。",
    source: "reuters",
    category: "world",
    publishedAt: hoursAgoIso(5),
    sources: [
      { source: "reuters", url: "https://reuters.com/ai-act", title: "EU AI Act high-impact rules take effect" },
      { source: "ft", url: "https://ft.com/ai-act-live", title: "Brussels switches on AI Act" },
    ],
  });
  await mk("evt:three", {
    title: "台积电 1nm 试产良率提前达标",
    titleZh: "台积电 1nm 试产良率提前达标",
    overviewZh: "良率爬坡快于内部计划，2027 年量产时点可能提前一到两个季度。",
    source: "ft",
    category: "business",
    publishedAt: hoursAgoIso(8),
    aiState: "queued",
    sources: [{ source: "ft", url: "https://ft.com/tsmc-1nm", title: "TSMC 1nm yield beats plan" }],
  });
  await mk("evt:four", {
    title: "SpaceX 第八代星舰完成全链路回收",
    titleZh: "SpaceX 第八代星舰完成全链路回收",
    overviewZh: "一二级均成功回落发射场，首次实现完全复用的全流程演示。",
    source: "theverge",
    category: "tech",
    publishedAt: daysAgoIso(1),
    sources: [{ source: "theverge", url: "https://theverge.com/starship-8", title: "Starship booster and ship both caught" }],
  });
  await mk("evt:five", {
    title: "美联储暗示年内还有两次降息",
    titleZh: "美联储暗示年内还有两次降息",
    overviewZh: "点阵图中位数显示年内合计 50 个基点的下调空间，市场定价转向 9 月落地。",
    source: "wsj",
    category: "business",
    publishedAt: daysAgoIso(1) ,
    sources: [{ source: "wsj", url: "https://wsj.com/fed-two-cuts", title: "Fed signals two more cuts this year" }],
  });
  const date = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  await store.putSnapshot("digest:" + date, {
    date,
    summary: "AI 竞争进入交付阶段：新模型密集上线，监管同步收紧，硬件产能与资本开支成为胜负手。今天重点关注三条主线。",
    items: [
      { eventId: "evt:lead" },
      { eventId: "evt:three" },
      { eventId: "evt:two" },
      { eventId: "evt:four" },
      { eventId: "evt:five" },
    ],
  });
  return store;
}

async function launchChromium() {
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
}

const server = await startServer({ store: await seedStore(), port: 0 });
await mkdir(OUT, { recursive: true });
const base = "http://127.0.0.1:" + server.port;

const browser = await launchChromium();
const wanted = process.argv.slice(2);
const shots = {
  "desktop-featured": async (page) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForSelector(".story");
  },
  "mobile-settings": async (page) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/", { waitUntil: "networkidle" });
    await page.waitForSelector(".story");
    await page.click('.tools button[data-action="settings"]');
    await page.waitForFunction(() => document.getElementById("modal")?.open);
  },
};

for (const name of wanted.length ? wanted : Object.keys(shots)) {
  if (!shots[name]) { console.log("skip (no recipe):", name); continue; }
  const ctx = await browser.newContext({ locale: "zh-CN", timezoneId: "America/New_York" });
  const page = await ctx.newPage();
  await shots[name](page);
  await page.screenshot({ path: join(OUT, name + ".png"), fullPage: false });
  await ctx.close();
  console.log("captured", name);
}

await browser.close();
await new Promise((r) => server.server.close(r));
