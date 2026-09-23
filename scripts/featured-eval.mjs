// Featured-feed quality snapshot. Read-only against a live site or local file.
// Usage:
//   node scripts/featured-eval.mjs [--base https://quack.weichao.ren] [--file data/events.json]
//                                  [--write docs/reviews] [--strict]
import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i === -1 || i + 1 >= process.argv.length ? "" : process.argv[i + 1];
}

async function loadFeed() {
  const file = argValue("--file");
  if (file) {
    const { readFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(join(ROOT, file), "utf8"));
    return raw;
  }
  const base = (argValue("--base") || process.env.SITE_URL || "https://quack.weichao.ren").replace(/\/+$/, "");
  const res = await fetch(base + "/api/v1/events?view=featured&limit=50");
  if (!res.ok) throw new Error("HTTP " + res.status + " " + base);
  const body = await res.json();
  const out = { items: body.items || [], base, snapshotAt: body.snapshotAt || body.updatedAt || "" };
  try {
    const dig = await (await fetch(base + "/api/v1/digest")).json();
    out.digest = dig.digest || dig;
  } catch {
    out.digest = null;
  }
  return out;
}

function pct(n, d) {
  return d ? Math.round((n / d) * 1000) / 10 : 0;
}

export function evaluate(items, extra = {}) {
  const list = items || [];
  const by = (fn) => list.filter(fn).length;
  const cats = {};
  const srcs = {};
  for (const it of list) {
    cats[it.category || "?"] = (cats[it.category || "?"] || 0) + 1;
    srcs[it.source || "?"] = (srcs[it.source || "?"] || 0) + 1;
  }
  const times = list
    .map((it) => Date.parse(it.publishedAt || it.firstSeenAt || it.seenAt || ""))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  const now = Date.now();
  const ai = {
    ready: by((it) => it.aiState === "ready"),
    queued: by((it) => it.aiState === "queued"),
    insufficient: by((it) => it.aiState === "insufficient"),
    failed: by((it) => it.aiState === "failed"),
    legacy: by((it) => !it.aiState),
  };
  return {
    evaluatedAt: new Date().toISOString(),
    ...extra,
    featuredCount: list.length,
    categoryMix: cats,
    sourceMix: Object.fromEntries(
      Object.entries(srcs).sort((a, b) => b[1] - a[1]).slice(0, 8)
    ),
    distinctSources: Object.keys(srcs).length,
    multiSourceEvents: by((it) => (it.sources || []).length >= 2),
    titleZh: by((it) => it.titleZh && it.titleZh !== it.title),
    overviewZh: by((it) => it.overviewZh || it.summaryZh),
    facts: by((it) => (it.facts || []).length > 0),
    ai,
    newestAgeHours: times.length ? Math.round(((now - times[0]) / 3600000) * 10) / 10 : null,
    oldestAgeHours: times.length ? Math.round(((now - times[times.length - 1]) / 3600000) * 10) / 10 : null,
    digestAiSummary: extra.digestAiSummary,
  };
}

function render(m) {
  const lines = [
    "featured=" + m.featuredCount,
    "category=" + JSON.stringify(m.categoryMix),
    "distinctSources=" + m.distinctSources,
    "multiSourceEvents=" + m.multiSourceEvents,
    "titleZh " + m.titleZh + "/" + m.featuredCount + " (" + pct(m.titleZh, m.featuredCount) + "%)",
    "overviewZh " + m.overviewZh + "/" + m.featuredCount + " (" + pct(m.overviewZh, m.featuredCount) + "%)",
    "facts " + m.facts + "/" + m.featuredCount + " (" + pct(m.facts, m.featuredCount) + "%)",
    "aiState=" + JSON.stringify(m.ai),
    "aiReadyRatio=" + pct(m.ai.ready, m.featuredCount) + "%",
    "newestAgeHours=" + m.newestAgeHours,
    "oldestAgeHours=" + m.oldestAgeHours,
    "digestAiSummary=" + (m.digestAiSummary ? "present" : "absent"),
  ];
  return lines.join("\n");
}

const feed = await loadFeed();
const digestHasSummary = Boolean(feed.digest?.aiSummary?.text);
const metrics = evaluate(feed.items, {
  base: feed.base || "file",
  snapshotAt: feed.snapshotAt || feed.snapshotat || "",
  digestAiSummary: digestHasSummary,
});
console.log(render(metrics));
if (argValue("--write")) {
  const dir = join(ROOT, argValue("--write"));
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
  const file = join(dir, "featured-eval-" + day + ".md");
  await mkdir(dirname(file), { recursive: true });
  await writeFile(
    file,
    "# 精选质量快照 " + day + "\n\nBase: `" + metrics.base + "`  \nsnapshotAt: `" + metrics.snapshotAt + "`\n\n```\n" +
      render(metrics) +
      "\n```\n\n来源分布：" +
      Object.entries(metrics.sourceMix).map(([s, n]) => s + "×" + n).join("、") +
      "\n",
    "utf8"
  );
  console.log("written", file);
}
if (process.argv.includes("--strict")) {
  const hardFail =
    metrics.featuredCount === 0 ||
    (metrics.newestAgeHours != null && metrics.newestAgeHours > 48);
  if (hardFail) {
    console.error("strict check failed: featured empty or stale beyond 48h");
    process.exit(1);
  }
}
