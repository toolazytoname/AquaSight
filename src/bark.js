import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const GROUP = "\u9e2d\u5148\u77e5";
const TITLE_PREFIX = "[\u7834\u5708] ";
const MAX_SENT = 300;
const MAX_PER_ROUND = 3;

export function barkEndpoint(key) {
  return "https://api.day.app/" + key;
}

export function buildPayload(event) {
  return {
    title: TITLE_PREFIX + String(event.title || "").slice(0, 80),
    body: String(event.reason || event.title || "").slice(0, 200),
    group: GROUP,
    level: "timeSensitive",
    sound: "minuet",
    url: event.url || "",
  };
}

export async function loadSent(path) {
  try {
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.ids) ? data.ids : [];
  } catch {
    return [];
  }
}

export async function saveSent(path, ids) {
  await mkdir(dirname(path), { recursive: true });
  const trimmed = ids.slice(-MAX_SENT);
  await writeFile(
    path,
    JSON.stringify({ ids: trimmed }, null, 2) + "\n",
    "utf8"
  );
}

export async function pushBreaking(events, opts = {}) {
  const {
    key = process.env.BARK_KEY,
    dryRun = false,
    sentPath,
    fetchImpl = fetch,
  } = opts;

  const sent = sentPath ? await loadSent(sentPath) : [];
  const sentSet = new Set(sent);
  const breaking = (events || []).filter((e) => e && e.level === "breaking");
  const fresh = breaking.filter((e) => e.id && !sentSet.has(e.id)).slice(0, MAX_PER_ROUND);

  const requests = [];
  if (!dryRun && key) {
    for (const ev of fresh) {
      const payload = buildPayload(ev);
      const res = await fetchImpl(barkEndpoint(key), {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
      });
      requests.push({ id: ev.id, ok: !!(res && res.ok), payload });
    }
  }

  const nextIds = sent.concat(fresh.map((e) => e.id));
  if (sentPath && !dryRun && key) {
    await saveSent(sentPath, nextIds);
  }

  return {
    considered: breaking.length,
    attempted: dryRun || !key ? 0 : fresh.length,
    skipped: breaking.length - fresh.length,
    dryRun,
    hasKey: Boolean(key),
    requests,
    freshIds: fresh.map((e) => e.id),
  };
}
