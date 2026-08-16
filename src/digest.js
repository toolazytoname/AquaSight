import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArchive } from "./archive.js";
import { pushDigest } from "./bark.js";
import { sourceFamily } from "./classify.js";
import { sortByScore } from "./sort.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = join(ROOT, "data", "archive.json");
const OUT = join(ROOT, "data", "digest.json");
const WEB_OUT = join(ROOT, "web", "digest.json");
const PAGE_URL = "https://toolazytoname.github.io/AquaSight/";
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_EACH = 5;

export function bucketSource(source) {
  const f = sourceFamily(source);
  if (f === "tech") return "tech";
  if (f === "hot") return "hot";
  return "other";
}

export function buildDigest(items, now = new Date()) {
  const cutoff = now.getTime() - WINDOW_MS;
  const recent = (items || []).filter((it) => {
    const t = Date.parse(it.archivedAt || it.updatedAt || "");
    if (!Number.isFinite(t)) return true;
    return t >= cutoff;
  });
  const buckets = { tech: [], hot: [], other: [] };
  for (const it of recent) {
    const key = bucketSource(it.source);
    if (buckets[key].length >= MAX_EACH) continue;
    buckets[key].push({
      id: it.id,
      title: it.title,
      titleZh: it.titleZh,
      url: it.url,
      source: it.source,
      level: it.level,
      score: it.score,
    });
  }
  buckets.tech = sortByScore(buckets.tech);
  buckets.hot = sortByScore(buckets.hot);
  buckets.other = sortByScore(buckets.other);
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  const y = bj.getUTCFullYear();
  const m = String(bj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(bj.getUTCDate()).padStart(2, "0");
  return {
    date: y + "-" + m + "-" + d,
    generatedAt: now.toISOString(),
    tech: buckets.tech,
    hot: buckets.hot,
    other: buckets.other,
  };
}

export async function writeDigest(digest) {
  const json = JSON.stringify(digest, null, 2) + "\n";
  await mkdir(dirname(OUT), { recursive: true });
  await mkdir(dirname(WEB_OUT), { recursive: true });
  await writeFile(OUT, json, "utf8");
  await writeFile(WEB_OUT, json, "utf8");
  return digest;
}

export async function digestOnce(opts = {}) {
  const archive = await loadArchive(opts.archivePath || ARCHIVE);
  const digest = buildDigest(archive.items, opts.now);
  await writeDigest(digest);
  const bark = await pushDigest(digest, {
    dryRun: opts.dryRun,
    key: opts.key,
    fetchImpl: opts.fetchImpl,
    pageUrl: PAGE_URL,
  });
  return { digest, bark };
}

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
if (once) {
  digestOnce({ dryRun }).then(({ digest, bark }) => {
    console.log(
      JSON.stringify(
        {
          date: digest.date,
          tech: digest.tech.length,
          hot: digest.hot.length,
          other: digest.other.length,
          bark: {
            dryRun: bark.dryRun,
            hasKey: bark.hasKey,
            attempted: bark.attempted,
          },
        },
        null,
        2
      )
    );
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
