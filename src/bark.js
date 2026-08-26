import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { stripHtml } from "./rss.js";
import { memberIdsOf } from "./cluster.js";

const GROUP = "鸭先知";
const TITLE_PREFIX = "[破圈] ";
const MAX_SENT = 300;
const MAX_PER_ROUND = 3;

export function barkEndpoint(key) {
  return "https://api.day.app/" + key;
}

export function buildPayload(event) {
  const titleText = String(event.titleZh || event.title || "").slice(0, 80);
  const bodyRaw = String(
    event.summaryZh || event.summary || event.titleZh || event.title || ""
  );
  return {
    title: TITLE_PREFIX + titleText,
    body: stripHtml(bodyRaw).slice(0, 200),
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

export function sentKeysOf(event) {
  const keys = [];
  if (event?.id) keys.push(event.id);
  for (const m of memberIdsOf(event)) keys.push(m);
  return keys;
}

function alreadySent(event, sentSet) {
  for (const k of sentKeysOf(event)) {
    if (sentSet.has(k)) return true;
    if (String(k).includes("|")) {
      for (const part of String(k).split("|")) {
        if (part && sentSet.has(part)) return true;
      }
    }
  }
  for (const old of sentSet) {
    if (String(old).includes("|")) {
      const parts = String(old).split("|");
      for (const m of memberIdsOf(event)) {
        if (parts.includes(m)) return true;
      }
    }
  }
  return false;
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
  const fresh = breaking
    .filter((e) => e.id && !alreadySent(e, sentSet))
    .slice(0, MAX_PER_ROUND);

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

  const nextIds = sent.concat(fresh.flatMap((e) => sentKeysOf(e)));
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

export function beijingYmd(now = new Date()) {
  const bj = new Date(now.getTime() + 8 * 3600 * 1000);
  return { month: bj.getUTCMonth() + 1, day: bj.getUTCDate() };
}

export function buildDigestPayload(digest, pageUrl) {
  const { month, day } = beijingYmd();
  function block(label, arr) {
    const titles = (arr || [])
      .map((it) => it.titleZh || it.title)
      .filter(Boolean);
    if (!titles.length) return label + "\n（暂无）";
    return (
      label +
      "\n" +
      titles.map((title, i) => i + 1 + ". " + title).join("\n")
    );
  }
  const body = [
    block("科技", digest && digest.tech),
    block("热搜", digest && digest.hot),
    block("其它", digest && digest.other),
  ].join("\n\n");
  return {
    title: "鸭先知 · " + month + "月" + day + "日早报",
    body: body.slice(0, 1200),
    group: GROUP,
    level: "active",
    sound: "bell",
    url: pageUrl || "",
  };
}

export async function pushDigest(digest, opts = {}) {
  const {
    key = process.env.BARK_KEY,
    dryRun = false,
    fetchImpl = fetch,
    pageUrl,
  } = opts;
  const payload = buildDigestPayload(digest, pageUrl);
  if (dryRun || !key) {
    return { dryRun, hasKey: Boolean(key), attempted: 0, payload };
  }
  const res = await fetchImpl(barkEndpoint(key), {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return {
    dryRun: false,
    hasKey: true,
    attempted: 1,
    ok: !!(res && res.ok),
    payload,
  };
}
