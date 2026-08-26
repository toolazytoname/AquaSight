import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { memberIdsOf } from "./cluster.js";

const KEEP_MS = 36 * 60 * 60 * 1000;

export async function loadArchive(path) {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    const items = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw)
        ? raw
        : [];
    return { items };
  } catch {
    return { items: [] };
  }
}

function earlierIso(a, b) {
  const ta = Date.parse(a || "");
  const tb = Date.parse(b || "");
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? b : "";
  if (!Number.isFinite(tb)) return a;
  return ta <= tb ? a : b;
}

function sameCard(prev, incoming) {
  if (prev.id && incoming.id && prev.id === incoming.id) return true;
  const a = new Set(memberIdsOf(prev));
  for (const m of memberIdsOf(incoming)) {
    if (m && a.has(m)) return true;
  }
  return false;
}

export function mergeArchive(existing, incoming, now = new Date()) {
  const nowMs = now.getTime();
  const items = [...(existing || [])].filter((it) => it && it.id);

  for (const it of incoming || []) {
    if (!it || !it.id) continue;
    const idx = items.findIndex((prev) => sameCard(prev, it));
    if (idx === -1) {
      items.push({
        ...it,
        archivedAt: it.archivedAt || now.toISOString(),
        seenAt: it.seenAt,
        publishedAt: it.publishedAt,
        memberIds: memberIdsOf(it),
      });
      continue;
    }
    const prev = items[idx];
    items[idx] = {
      ...it,
      id: prev.id,
      archivedAt: prev.archivedAt || now.toISOString(),
      seenAt: earlierIso(prev.seenAt, it.seenAt) || prev.seenAt,
      publishedAt:
        earlierIso(prev.publishedAt, it.publishedAt) || prev.publishedAt,
      memberIds: [...new Set([...memberIdsOf(prev), ...memberIdsOf(it)])],
    };
  }

  return {
    items: items.filter((it) => {
      const t = Date.parse(it.archivedAt || "");
      if (!Number.isFinite(t)) return true;
      return nowMs - t <= KEEP_MS;
    }),
  };
}

export async function saveArchive(path, archive) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(archive, null, 2) + "\n", "utf8");
}
