import { pushBreaking, pushDigest, alreadySent, postBark } from "./bark.js";
import { readFile, writeFile } from "node:fs/promises";
import { normalizePrefs } from "./prefs.js";
import { beijingParts, beijingYmd, isSilentHour } from "./time.js";

export const SOURCE_OUTAGE_MIN = 5;

export async function notifySourceOutage(errors, opts = {}) {
  const list = (errors || []).filter((e) => e && e.source);
  if (list.length < (opts.min ?? SOURCE_OUTAGE_MIN)) {
    return { sent: false, reason: "below-min", count: list.length };
  }
  const key = opts.key || process.env.BARK_KEY;
  if (!key) return { sent: false, reason: "no-key", count: list.length };
  const today = beijingYmd(opts.now || new Date());
  if (opts.markerPath) {
    let marker = null;
    try {
      marker = JSON.parse(await readFile(opts.markerPath, "utf8"));
    } catch {
      marker = null;
    }
    if (marker && marker.date === today) {
      return { sent: false, reason: "deduped", count: list.length };
    }
  }
  const names = list.map((e) => e.source).join("、");
  const res = await postBark(
    key,
    {
      title: "鸭先知：多个源抓取失败",
      body: names + " 共 " + list.length + " 个源本轮失败，请检查采集。",
      group: "aquasight",
    },
    { fetchImpl: opts.fetchImpl }
  );
  if (res && res.ok && opts.markerPath) {
    await writeFile(
      opts.markerPath,
      JSON.stringify({ date: today, sources: list.map((e) => e.source) }, null, 2) + "\n",
      "utf8"
    );
  }
  return { sent: Boolean(res && res.ok), count: list.length };
}

export function instantAllowed(prefs, sentIds, now = new Date()) {
  const p = normalizePrefs(prefs);
  if (!p.instantNotifyEnabled) return { ok: false, reason: "shadow-disabled" };
  if (isSilentHour(now, p.silentStart, p.silentEnd)) {
    return { ok: false, reason: "silent-hours" };
  }
  const day = beijingParts(now).ymd;
  const prefix = "day:" + day + ":";
  const sentToday = (sentIds || []).filter((id) => String(id).startsWith(prefix)).length;
  if (sentToday >= p.instantMaxPerDay) return { ok: false, reason: "daily-cap" };
  return { ok: true, remaining: p.instantMaxPerDay - sentToday };
}

export async function notifyInstant(events, opts = {}) {
  const prefs = normalizePrefs(opts.prefs);
  const sentIds = opts.sentIds || opts.sentStore?.ids || [];
  const gate = instantAllowed(prefs, sentIds, opts.now);
  if (!gate.ok) {
    return {
      attempted: 0,
      skipped: (events || []).length,
      reason: gate.reason,
      dryRun: Boolean(opts.dryRun),
      hasKey: Boolean(opts.key || process.env.BARK_KEY),
      requests: [],
      freshIds: [],
    };
  }
  return pushBreaking(events, { ...opts, prefs });
}

export async function notifyDigest(digest, opts = {}) {
  const prefs = normalizePrefs(opts.prefs);
  if (!prefs.digestEnabled) {
    return { attempted: 0, reason: "digest-disabled", dryRun: Boolean(opts.dryRun) };
  }
  return pushDigest(digest, opts);
}

export { alreadySent, beijingYmd };
