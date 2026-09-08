import { stripHtml } from "./html.js";
import { memberIdsOf } from "./identity.js";
import { beijingParts, isSilentHour } from "./time.js";

const GROUP = "鸭先知";
const TITLE_PREFIX = "[破圈] ";
const MAX_SENT = 400;
const MAX_PER_ROUND = 3;
const MAX_RETRIES = 2;
const TIMEOUT_MS = 12000;

export function barkEndpoint(key) {
  return "https://api.day.app/" + key;
}

export function buildPayload(event) {
  const titleText = String(event.titleZh || event.title || "").slice(0, 80);
  const bodyRaw = String(
    event.overviewZh ||
      event.summaryZh ||
      event.summary ||
      event.titleZh ||
      event.title ||
      ""
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
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data.ids)) return { ids: data.ids, unknown: data.unknown || [] };
    return { ids: [], unknown: [] };
  } catch {
    return { ids: [], unknown: [] };
  }
}

export async function saveSent(path, ids, unknown = []) {
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(path), { recursive: true });
  const trimmed = ids.slice(-MAX_SENT);
  await writeFile(
    path,
    JSON.stringify({ ids: trimmed, unknown: unknown.slice(-MAX_SENT) }, null, 2) +
      "\n",
    "utf8"
  );
}

export function sentKeysOf(event) {
  const keys = [];
  if (event?.id) keys.push(event.id);
  for (const m of memberIdsOf(event)) keys.push(m);
  return keys;
}

export function alreadySent(event, sentSet) {
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

function sleep(ms, impl) {
  const wait = impl || ((n) => new Promise((r) => setTimeout(r, n)));
  return wait(ms);
}

export function interpretBarkResponse(res, body) {
  const status = Number(res && res.status);
  const httpOk = status >= 200 && status < 300;
  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = { raw: body };
    }
  }
  const code = parsed && typeof parsed === "object" ? Number(parsed.code) : NaN;
  const bizOk =
    (Number.isFinite(code) && (code === 200 || code === 0)) ||
    (parsed && parsed.message === "success");
  if (httpOk && (bizOk || parsed == null)) {
    if (parsed && Number.isFinite(code) && !bizOk) {
      return { ok: false, retryable: false, kind: "biz", status, body: parsed };
    }
    if (parsed && Number.isFinite(code) && bizOk) {
      return { ok: true, retryable: false, kind: "sent", status, body: parsed };
    }
    if (httpOk && parsed == null) {
      return { ok: true, retryable: false, kind: "sent", status, body: parsed };
    }
  }
  if (status >= 500 || status === 429) {
    return { ok: false, retryable: true, kind: "http", status, body: parsed };
  }
  if (status >= 400) {
    return { ok: false, retryable: false, kind: "http", status, body: parsed };
  }
  return { ok: false, retryable: true, kind: "http", status, body: parsed };
}

export async function postBark(key, payload, opts = {}) {
  const fetchImpl = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(barkEndpoint(key), {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    if (res && res.ok === true && typeof res.json !== "function" && typeof res.text !== "function") {
      return { ok: true, retryable: false, kind: "sent", status: res.status || 200, body: null };
    }
    let body = null;
    if (res) {
      if (typeof res.json === "function") {
        try {
          body = await res.json();
        } catch {
          body = typeof res.text === "function" ? await res.text() : null;
        }
      } else if (typeof res.text === "function") {
        body = await res.text();
      }
    }
    if (res && res.ok === true && (body == null || body === "")) {
      return { ok: true, retryable: false, kind: "sent", status: res.status || 200, body };
    }
    return interpretBarkResponse(res || { status: 0 }, body);
  } catch (e) {
    const name = e && e.name;
    const aborted = name === "AbortError" || /timeout|aborted/i.test(String(e && e.message));
    return {
      ok: false,
      retryable: true,
      kind: aborted ? "unknown" : "network",
      status: 0,
      error: e && e.message ? e.message : String(e),
    };
  } finally {
    clearTimeout(t);
  }
}

async function sendWithRetry(key, payload, opts = {}) {
  let last = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    last = await postBark(key, payload, opts);
    if (last.ok) return last;
    if (last.kind === "unknown") return last;
    if (!last.retryable) return last;
    if (attempt < MAX_RETRIES) await sleep(150 * (attempt + 1), opts.sleepImpl);
  }
  return last;
}

function uniqueById(events) {
  const seen = new Set();
  const out = [];
  for (const e of events || []) {
    if (!e || !e.id) continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

function valueOf(e) {
  if (Number.isFinite(e.value)) return e.value;
  if (Number.isFinite(e.score)) return e.score;
  return 0;
}

export async function pushBreaking(events, opts = {}) {
  const {
    key = process.env.BARK_KEY,
    dryRun = false,
    sentPath,
    fetchImpl = fetch,
    sentStore,
    now = new Date(),
    prefs = { instantNotifyEnabled: true, instantMaxPerDay: MAX_PER_ROUND },
  } = opts;

  const loaded = sentStore
    ? { ids: sentStore.ids || [], unknown: sentStore.unknown || [] }
    : sentPath
      ? await loadSent(sentPath)
      : { ids: [], unknown: [] };
  const unknown = [...(loaded.unknown || [])];
  const blocked = new Set(loaded.ids);
  for (const row of unknown) {
    if (typeof row === "string") blocked.add(row);
    else if (row && row.id) {
      blocked.add(row.id);
      for (const k of row.keys || []) blocked.add(k);
    }
  }

  const breaking = uniqueById(
    (events || []).filter(
      (e) => e && (e.level === "breaking" || e.notifyEligible) && e.category !== "hidden"
    )
  );
  const ranked = [...breaking].sort((a, b) => valueOf(b) - valueOf(a));
  const fresh = ranked.filter((e) => e.id && !alreadySent(e, blocked));

  const instantOn = prefs.instantNotifyEnabled !== false;
  const cap = Number.isFinite(prefs.instantMaxPerDay)
    ? prefs.instantMaxPerDay
    : MAX_PER_ROUND;
  const day = beijingParts(now).ymd;
  const sentToday = (loaded.ids || []).filter((id) =>
    String(id).startsWith("day:" + day + ":")
  ).length;
  const remaining = Math.max(0, cap - sentToday);
  const take = instantOn ? fresh.slice(0, Math.min(MAX_PER_ROUND, remaining)) : [];

  const requests = [];
  const sentNow = [];
  const failed = [];
  const unknownNow = [];

  if (!dryRun && key && take.length) {
    for (const ev of take) {
      const payload = buildPayload(ev);
      const result = await sendWithRetry(key, payload, {
        fetchImpl,
        sleepImpl: opts.sleepImpl,
        timeoutMs: opts.timeoutMs,
      });
      const row = { id: ev.id, payload, ...result };
      requests.push(row);
      if (result.ok) {
        sentNow.push(ev);
        for (const k of sentKeysOf(ev)) blocked.add(k);
        blocked.add("day:" + day + ":" + ev.id);
      } else if (result.kind === "unknown") {
        unknownNow.push({
          id: ev.id,
          keys: sentKeysOf(ev),
          at: new Date(now).toISOString(),
          error: result.error,
        });
        for (const k of sentKeysOf(ev)) blocked.add(k);
      } else {
        failed.push(row);
      }
    }
  }

  const nextIds = loaded.ids.concat(
    sentNow.flatMap((e) => [...sentKeysOf(e), "day:" + beijingParts(now).ymd + ":" + e.id])
  );
  const nextUnknown = unknown.concat(unknownNow);
  if (sentStore) {
    sentStore.ids = nextIds.slice(-MAX_SENT);
    sentStore.unknown = nextUnknown.slice(-MAX_SENT);
  }
  if (sentPath && !dryRun && key) {
    await saveSent(sentPath, nextIds, nextUnknown);
  }

  return {
    considered: breaking.length,
    attempted: dryRun || !key ? 0 : take.length,
    skipped: breaking.length - take.length,
    sent: sentNow.map((e) => e.id),
    failed: failed.map((f) => f.id),
    unknown: unknownNow,
    dryRun,
    hasKey: Boolean(key),
    requests,
    freshIds: take.map((e) => e.id),
    silent: isSilentHour(now, prefs.silentStart, prefs.silentEnd),
  };
}

export function beijingYmd(now = new Date()) {
  const p = beijingParts(now);
  return { month: p.month, day: p.day };
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
  const tech = digest && (digest.tech || digest.items?.filter((i) => i.category === "tech"));
  const business =
    digest && (digest.business || digest.items?.filter((i) => i.category === "business"));
  const pub =
    digest && (digest.public || digest.items?.filter((i) => i.category === "public"));
  const body = [
    block("科技", tech),
    block("商业", business),
    block("公共", pub),
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
  const result = await sendWithRetry(key, payload, {
    fetchImpl,
    sleepImpl: opts.sleepImpl,
    timeoutMs: opts.timeoutMs,
  });
  return {
    dryRun: false,
    hasKey: true,
    attempted: 1,
    ok: result.ok,
    status: result.kind,
    payload,
    result,
  };
}
