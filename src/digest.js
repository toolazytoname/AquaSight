import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArchive } from "./archive.js";
import { buildDigestFromItems, digestOnce } from "./pipeline.js";
import { loadFileStore } from "./store/file.js";
import { sourceFamily } from "./catalog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVE = join(ROOT, "data", "archive.json");
const OUT = join(ROOT, "data", "digest.json");
const WEB_OUT = join(ROOT, "web", "digest.json");
const STORE = join(ROOT, "data", "app-store.json");
const PAGE_URL = process.env.SITE_URL || "https://toolazytoname.github.io/AquaSight/";

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
    let items = await store.listEvents();
    if (!items.length) {
      const archive = await loadArchive(ARCHIVE);
      items = archive.items;
    }
    const result = await digestOnce({
      store,
      items,
      dryRun,
      pageUrl: PAGE_URL,
    });
    await writeDigest(result.digest);
    const digest = result.digest;
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
