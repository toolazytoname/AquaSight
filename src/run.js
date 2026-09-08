import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectOnce, decorateCards, allSourcesFailed, maybeCatchUpDigest } from "./pipeline.js";
import { loadArchive, mergeArchive, saveArchive } from "./archive.js";
import { loadFileStore } from "./store/file.js";
import { publicItem } from "./compat.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "events.json");
const WEB_OUT = join(ROOT, "web", "events.json");
const SENT = join(ROOT, "data", "sent.json");
const ARCHIVE = join(ROOT, "data", "archive.json");
const STORE = join(ROOT, "data", "app-store.json");

export { decorateCards, collectOnce };

export async function loadRemotePrefs(opts = {}) {
  const ingestUrl = opts.ingestUrl || process.env.INGEST_URL || "";
  const token = opts.token || process.env.INGEST_TOKEN || "";
  const base =
    opts.apiBase ||
    process.env.API_BASE_URL ||
    String(ingestUrl).replace(/\/api\/v1\/ingest\/?$/, "");
  if (!base || !token) return null;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(String(base).replace(/\/$/, "") + "/api/v1/settings", {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  if (!res || !res.ok) return null;
  const data = await res.json();
  return data.prefs || null;
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

async function writeEvents(payload) {
  const json = JSON.stringify(payload, null, 2) + "\n";
  await mkdir(dirname(OUT), { recursive: true });
  await mkdir(dirname(WEB_OUT), { recursive: true });
  await writeFile(OUT, json, "utf8");
  await writeFile(WEB_OUT, json, "utf8");
}

const once = process.argv.includes("--once");
const dryRun = process.argv.includes("--dry-run");
const fixture = argValue("--fixture");

if (once || fixture) {
  const run = async () => {
    const store = await loadFileStore(STORE);
    let payload;
    if (fixture) {
      const loaded = await loadFixture(fixture);
      const items = await decorateCards(loaded.items || [], {
        store,
        enrich: false,
      });
      payload = {
        apiVersion: "v1",
        updatedAt: new Date().toISOString(),
        snapshotAt: new Date().toISOString(),
        items,
        sourceErrors: loaded.sourceErrors || [],
      };
    } else {
      const remotePrefs = await loadRemotePrefs().catch(() => null);
      if (remotePrefs) await store.setPrefs(remotePrefs);
      payload = await collectOnce({
        store,
        dryRun,
        sentPath: SENT,
        skipNotify: dryRun,
        prefs: remotePrefs || undefined,
      });
      if (!dryRun) {
        await maybeCatchUpDigest(store, { dryRun, key: process.env.BARK_KEY }).catch(() => {});
      }
    }
    const publicPayload = {
      ...payload,
      items: (payload.items || []).map(publicItem),
    };
    await writeEvents(publicPayload);
    const prev = await loadArchive(ARCHIVE);
    await saveArchive(ARCHIVE, mergeArchive(prev.items, payload.items));
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
          bark: payload.bark || null,
          diagnostics: payload.diagnostics || null,
        },
        null,
        2
      )
    );
    if (!fixture && allSourcesFailed(payload)) process.exit(1);
  };
  run().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
