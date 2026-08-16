import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cluster } from "./cluster.js";
import { applyTitleZh, applySummaryZh } from "./translate.js";
import { loadArchive, mergeArchive, saveArchive } from "./archive.js";
import { pushBreaking } from "./bark.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetch36kr } from "./sources/kr36.js";
import { fetchWeibo, fetchBaidu, fetchToutiao } from "./sources/hot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");
const WEB_OUT = join(ROOT, "web", "events.json");
const SENT = join(ROOT, "data", "sent.json");
const TITLE_ZH = join(ROOT, "data", "title-zh.json");
const ARCHIVE = join(ROOT, "data", "archive.json");

const SOURCES = [
  ["hn", fetchHN],
  ["github", fetchGitHub],
  ["36kr", fetch36kr],
  ["weibo", fetchWeibo],
  ["baidu", fetchBaidu],
  ["toutiao", fetchToutiao],
];

async function decorateCards(raw, opts = {}) {
  const translateOpts = {
    fetchImpl: opts.fetchImpl,
    cache: opts.cache,
    cachePath: Object.prototype.hasOwnProperty.call(opts, "cache")
      ? opts.cachePath
      : TITLE_ZH,
  };
  let items = cluster(raw || []);
  items = await applyTitleZh(items, translateOpts);
  items = await applySummaryZh(items, translateOpts);
  return items;
}

export async function collectOnce(opts = {}) {
  const sourceErrors = [];
  const raw = [];

  const settled = await Promise.allSettled(
    SOURCES.map(async ([name, fn]) => ({ name, items: await fn() }))
  );
  for (let i = 0; i < settled.length; i++) {
    const name = SOURCES[i][0];
    const result = settled[i];
    if (result.status === "rejected") {
      const e = result.reason;
      sourceErrors.push({
        source: name,
        message: e && e.message ? e.message : String(e),
      });
      continue;
    }
    const items = result.value.items;
    if (!items.length) {
      sourceErrors.push({ source: name, message: "empty" });
      continue;
    }
    raw.push(...items);
  }

  const items = await decorateCards(raw, opts);

  const payload = {
    updatedAt: new Date().toISOString(),
    items,
    sourceErrors,
  };

  const json = JSON.stringify(payload, null, 2) + "\n";
  await mkdir(dirname(OUT), { recursive: true });
  await mkdir(dirname(WEB_OUT), { recursive: true });
  await writeFile(OUT, json, "utf8");
  await writeFile(WEB_OUT, json, "utf8");
  const prev = await loadArchive(ARCHIVE);
  await saveArchive(ARCHIVE, mergeArchive(prev.items, items));
  return payload;
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return "";
  return process.argv[i + 1];
}

async function loadFixture(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  return Array.isArray(raw.items) ? raw : { items: raw, sourceErrors: [] };
}

function publicItem(it) {
  return {
    id: it.id,
    title: it.title,
    titleZh: it.titleZh,
    summary: it.summary,
    summaryZh: it.summaryZh,
    level: it.level,
    reason: it.reason,
    score: it.score,
    source: it.source,
    sources: it.sources,
  };
}

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
const fixture = argValue("--fixture");

if (once || fixture) {
  const run = async () => {
    let payload;
    if (fixture) {
      const loaded = await loadFixture(fixture);
      payload = {
        ...loaded,
        items: await decorateCards(loaded.items || []),
      };
    } else {
      payload = await collectOnce();
    }
    const bark = await pushBreaking(payload.items, {
      dryRun,
      sentPath: SENT,
    });
    const by = {};
    for (const it of payload.items || []) by[it.source] = (by[it.source] || 0) + 1;
    console.log(
      JSON.stringify(
        {
          updatedAt: payload.updatedAt || null,
          counts: by,
          itemCount: (payload.items || []).length,
          sourceErrors: payload.sourceErrors || [],
          items: (payload.items || []).map(publicItem),
          bark: {
            dryRun: bark.dryRun,
            hasKey: bark.hasKey,
            attempted: bark.attempted,
            skipped: bark.skipped,
            freshIds: bark.freshIds,
            requestCount: bark.requests.length,
          },
        },
        null,
        2
      )
    );
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

export { decorateCards };
