import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArchive } from "./archive.js";
import { buildDigestFromItems, digestOnce } from "./pipeline.js";
import { loadFileStore } from "./store/file.js";
import { sourceFamily } from "./catalog.js";
import { loadRemotePrefs } from "./remote.js";
import { defaultSiteUrl } from "./bark.js";
import { summarizeDigest } from "./enrich.js";
import { validateDigestSummary } from "./digest-check.js";
import { createBudget } from "./budget.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = join(ROOT, "data", "archive.json");
const OUT = join(ROOT, "data", "digest.json");
const WEB_OUT = join(ROOT, "web", "digest.json");
const STORE = join(ROOT, "data", "app-store.json");

export function bucketSource(source) {
  const f = sourceFamily(source);
  if (f === "tech") return "tech";
  if (f === "clue" || f === "hot") return "hot";
  if (f === "business") return "business";
  return "other";
}

export function buildDigest(items, now = new Date()) {
  const digest = buildDigestFromItems(items, { now });
  return {
    ...digest,
    hot: digest.business,
    other: digest.public,
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

export { digestOnce };

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
if (once) {
  (async () => {
    const store = await loadFileStore(STORE);
    const remotePrefs = await loadRemotePrefs().catch(() => null);
    if (remotePrefs) await store.setPrefs(remotePrefs);
    let items = await store.listEvents();
    if (!items.length) {
      const archive = await loadArchive(ARCHIVE);
      items = archive.items;
    }
    const result = await digestOnce({
      store,
      items,
      dryRun,
      pageUrl: defaultSiteUrl(),
      refreshPrefs: () => loadRemotePrefs(),
    });
    await writeDigest(result.digest);
    const digest = result.digest;
    if (!dryRun && !digest.aiSummary) {
      const now = new Date();
      try {
        const budget = createBudget(await store.getBudget(), now, {
          persist: (snap) => store.setBudget(snap),
        });
        const pool = [...(digest.tech || []), ...(digest.business || []), ...(digest.public || [])];
        const summ = await summarizeDigest(pool, { budget, now });
        if (summ && summ.text) {
          // Grounding gate: a number/unit/entity the sources cannot back up
          // (the 350亿→3500亿 class of error) means no summary, not a caveat.
          const verdict = validateDigestSummary(summ.text, pool);
          if (!verdict.ok) {
            console.log(
              "digest ai summary rejected (" + verdict.reason + "):",
              JSON.stringify(verdict.checked)
            );
          } else {
            digest.aiSummary = { text: summ.text, at: now.toISOString() };
            // Persist into the store snapshot too: collect reposts
            // snapshot "digest:<date>" with every ingest, and a summary that
            // only lives in data/digest.json gets clobbered one round later.
            await store.putSnapshot("digest:" + digest.date, digest);
            await writeDigest(digest);
          }
        } else {
          console.log("digest ai summary skipped:", (summ && summ.reason) || "unknown");
        }
      } catch (e) {
        // summary is an add-on; the digest still ships without it
        console.log("digest ai summary failed:", (e && e.message) || e);
      }
    }
    const bark = result.bark;
    console.log(
      JSON.stringify(
        {
          date: digest.date,
          tech: (digest.tech || []).length,
          business: (digest.business || []).length,
          public: (digest.public || []).length,
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
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
