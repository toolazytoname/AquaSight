import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const KEEP_MS = 36 * 60 * 60 * 1000;

export async function loadArchive(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const items = Array.isArray(raw.items) ? raw.items : Array.isArray(raw) ? raw : [];
    return { items };
  } catch {
    return { items: [] };
  }
}

export function mergeArchive(existing, incoming, now = new Date()) {
  const nowMs = now.getTime();
  const byId = new Map();
  for (const it of existing || []) {
    if (!it || !it.id) continue;
    byId.set(it.id, it);
  }
  for (const it of incoming || []) {
    if (!it || !it.id) continue;
    const prev = byId.get(it.id);
    byId.set(it.id, {
      ...it,
      archivedAt: prev && prev.archivedAt ? prev.archivedAt : now.toISOString(),
    });
  }
  const items = [...byId.values()].filter((it) => {
    const t = Date.parse(it.archivedAt || "");
    if (!Number.isFinite(t)) return true;
    return nowMs - t <= KEEP_MS;
  });
  return { items };
}

export async function saveArchive(path, archive) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(archive, null, 2) + "\n", "utf8");
}
