import { pushBreaking, pushDigest, alreadySent, postBark } from "./bark.js";
import { readFile, writeFile } from "node:fs/promises";
import { normalizePrefs } from "./prefs.js";
import { beijingParts, beijingYmd, isSilentHour } from "./time.js";

export const SOURCE_OUTAGE_MIN = 5;
export const SOURCE_STREAK_MIN = 3;

function readMarker(path) {
  return readFile(path, "utf8")
    .then((raw) => JSON.parse(raw))
    .catch(() => null);
}

/**
 * Two outage channels in one push: a broad round where many sources failed at
 * once, and per-source consecutive-failure streaks (a source quietly dead for
 * days is invisible to the round threshold). Daily per-source dedup via marker.
 */
export async function notifySourceOutage(errors, opts = {}) {
  const list = (errors || []).filter((e) => e && e.source);
  const streakMin = opts.streakMin ?? SOURCE_STREAK_MIN;
  const health = opts.health || [];
  const streakRows = health
    .filter((h) => h && h.source && (Number(h.failStreak) || 0) >= streakMin)
    .sort((a, b) => (Number(b.failStreak) || 0) - (Number(a.failStreak) || 0));
  const roundHit = list.length >= (opts.min ?? SOURCE_OUTAGE_MIN);
  const streakHit = streakRows.length > 0;
  if (!roundHit && !streakHit) {
    return { sent: false, reason: "below-min", count: list.length, streaks: streakRows.length };
  }
  const key = opts.key || process.env.BARK_KEY;
  if (!key) {
    return { sent: false, reason: "no-key", count: list.length, streaks: streakRows.length };
  }
  const today = beijingYmd(opts.now || new Date());
  let marker = null;
  if (opts.markerPath) marker = await readMarker(opts.markerPath);
  const alreadyAlerted = new Set(marker?.date === today ? marker.sources || [] : []);
  const alertedToday = marker?.date === today;
  const freshStreaks = streakRows.filter((h) => !alreadyAlerted.has(h.source));
  // One push per day: the day's first alert may carry the round cause; later
  // pushes only cover streak sources that crossed the threshold since.
  if (alertedToday && freshStreaks.length === 0) {
    return { sent: false, reason: "deduped", count: list.length, streaks: streakRows.length };
  }
  const lines = [];
  if (roundHit && !alertedToday) {
    lines.push(list.map((e) => e.source).join("、") + " 共 " + list.length + " 个源本轮失败");
  }
  for (const h of freshStreaks) {
    alreadyAlerted.add(h.source);
    lines.push(h.source + " 已连续 " + h.failStreak + " 轮失败");
  }
  if (!lines.length) {
    return { sent: false, reason: "deduped", count: list.length, streaks: streakRows.length };
  }
  const res = await postBark(
    key,
    {
      title: "鸭先知：源抓取异常",
      body: lines.join("；") + "，请检查采集。",
      group: "aquasight",
    },
    { fetchImpl: opts.fetchImpl }
  );
  if (res && res.ok && opts.markerPath) {
    await writeFile(
      opts.markerPath,
      JSON.stringify({ date: today, sources: [...alreadyAlerted] }, null, 2) + "\n",
      "utf8"
    );
  }
  return {
    sent: Boolean(res && res.ok),
    count: list.length,
    streaks: streakRows.length,
  };
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
