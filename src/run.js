import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./classify.js";
import { applyTitleZh } from "./translate.js";
import { pushBreaking } from "./bark.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetch36kr } from "./sources/kr36.js";
import { fetchHot } from "./sources/hot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");
const WEB_OUT = join(ROOT, "web", "events.json");
const SENT = join(ROOT, "data", "sent.json");
const TITLE_ZH = join(ROOT, "data", "title-zh.json");

const SOURCES = [
  ["hn", fetchHN],
  ["github", fetchGitHub],
  ["36kr", fetch36kr],
  ["hot", fetchHot],
];

export async function collectOnce() {
  const sourceErrors = [];
  const raw = [];

  for (const [name, fn] of SOURCES) {
    try {
      const items = await fn();
      if (!items.length) {
        sourceErrors.push({ source: name, message: "empty" });
        continue;
      }
      raw.push(...items);
    } catch (e) {
      sourceErrors.push({
        source: name,
        message: e && e.message ? e.message : String(e),
      });
    }
  }

  let items = raw.map((ev) => {
    const { level, reason } = classify(ev, raw);
    const out = {
      id: ev.id,
      title: ev.title,
      url: ev.url,
      source: ev.source,
      level,
      reason,
    };
    if (Number.isFinite(ev.rank)) out.rank = ev.rank;
    return out;
  });
  items = await applyTitleZh(items, { cachePath: TITLE_ZH });

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

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
const fixture = argValue("--fixture");

if (once || fixture) {
  const run = async () => {
    let payload = fixture ? await loadFixture(fixture) : await collectOnce();
    if (fixture) {
      payload = {
        ...payload,
        items: await applyTitleZh(payload.items, { cachePath: TITLE_ZH }),
      };
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
