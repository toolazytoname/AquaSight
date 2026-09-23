// Production acceptance assertions against live DOM. Read-only.
const BASE = (process.argv[2] || "https://quack.weichao.ren").replace(/\/+$/, "");
const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const out = [];
const ok = (name, pass, detail = "") => out.push({ name, pass, detail });

// Mobile 390px — header layout, lead gate, meta content
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: "zh-CN", timezoneId: "America/Los_Angeles" });
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".story", { timeout: 20000 });

  const meta = (await page.textContent("#meta")).trim();
  ok("meta shows only 更新于", /^更新于/.test(meta) && !/AI 已整理/.test(meta), meta);

  const boxes = await page.evaluate(() => {
    const meta = document.getElementById("meta").getBoundingClientRect();
    const sub = document.getElementById("view-subtitle").getBoundingClientRect();
    return { metaBottom: Math.round(sub.bottom), metaTop: Math.round(meta.top), metaLeft: Math.round(meta.left), subLeft: Math.round(sub.left) };
  });
  ok("mobile: timestamp on its own row", boxes.metaTop >= boxes.metaBottom - 2, JSON.stringify(boxes));

  const lead = await page.evaluate(() => {
    const el = document.querySelector(".story.lead");
    if (!el) return { present: false };
    const label = el.querySelector(".lead-label")?.textContent || "";
    const title = el.querySelector("h2")?.textContent || "";
    const hasZh = /[\u4e00-\u9fff]/.test(title);
    const width = el.querySelector("h2")?.getBoundingClientRect().width || 0;
    return { present: true, label, title: title.slice(0, 30), hasZh };
  });
  ok("lead present and Chinese", lead.present === true && lead.label === "今日关注" && lead.hasZh, JSON.stringify(lead));

  const mediaPhrase = await page.evaluate(() => document.body.textContent.includes("家媒体报道"));
  ok("media count uses outlet wording", mediaPhrase);
  const sparkles = await page.evaluate(() => document.body.textContent.includes("✨"));
  ok("no sparkle decoration", !sparkles);

  // Digest under a non-Beijing device timezone: date line must still be Beijing.
  await page.goto(BASE + "/#/digest", { waitUntil: "networkidle" });
  await page.waitForSelector(".edition", { timeout: 20000 });
  const dateLine = (await page.textContent(".edition-top")).trim();
  const beijing = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric", weekday: "short" }).format(new Date());
  const expect = beijing.replace(/周|星期/g, "");
  ok("digest date line matches Beijing calendar", dateLine.includes(expect.slice(0, -1)) || dateLine.includes(expect), dateLine + " vs " + beijing);
  const sumLabel = await page.evaluate(() => {
    const el = document.querySelector(".edition-intro .ai-mark");
    return el ? el.textContent : "";
  });
  ok("digest summary label plain 综述", sumLabel === "综述", sumLabel);

  // Settings: internal detail folded into 状态详情
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.click('.tools button[data-action="settings"]');
  await page.waitForFunction(() => document.getElementById("modal")?.open);
  const hasStatus = await page.evaluate(() => {
    const d = document.querySelector(".status-details");
    if (!d) return { present: false };
    return { present: true, text: d.textContent.slice(0, 120) };
  });
  ok("settings hides internals behind 状态详情", hasStatus.present, JSON.stringify(hasStatus));
  await page.close();
}

// Desktop 1440 — lead + layout
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Shanghai" });
  await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".story", { timeout: 20000 });
  const leadTitle = await page.evaluate(() => {
    const h2 = document.querySelector(".story.lead h2");
    return h2 ? h2.textContent : "";
  });
  ok("desktop lead exists", Boolean(leadTitle), leadTitle.slice(0, 30));
  await page.close();
}
await browser.close();

let failed = 0;
for (const r of out) {
  console.log((r.pass ? "PASS" : "FAIL") + " | " + r.name + (r.detail ? " | " + r.detail : ""));
  if (!r.pass) failed++;
}
console.log(failed ? failed + " checks failed" : "all live checks passed");
process.exit(failed ? 1 : 0);
