import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFileStore } from "./file.js";
import { createMemoryStore } from "./memory.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const STORE = join(ROOT, "data", "app-store.json");
const SCHEMA = join(ROOT, "worker", "schema.sql");

export async function migrateLocal() {
  await mkdir(dirname(STORE), { recursive: true });
  const store = await loadFileStore(STORE);
  await store.persist();
  return store;
}

export function memoryFromDump(dump) {
  return createMemoryStore(dump);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateLocal().then(() => {
    console.log("local store ready:", STORE);
    console.log("D1 schema:", SCHEMA);
    console.log("Apply on Cloudflare: wrangler d1 execute aquasight --file=worker/schema.sql");
  });
}
