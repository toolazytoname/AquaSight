import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "./classify.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetch36kr } from "./sources/kr36.js";
import { fetchHot } from "./sources/hot.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");

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

  const items = raw.map((ev) => {
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

  const payload = {
    updatedAt: new Date().toISOString(),
    items,
    sourceErrors,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  return payload;
}

const once = process.argv.includes("--once");
if (once) {
  collectOnce()
    .then((p) => {
      const by = {};
      for (const it of p.items) by[it.source] = (by[it.source] || 0) + 1;
      console.log(
        JSON.stringify(
          {
            updatedAt: p.updatedAt,
            counts: by,
            itemCount: p.items.length,
            sourceErrors: p.sourceErrors,
            out: OUT,
          },
          null,
          2
        )
      );
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
