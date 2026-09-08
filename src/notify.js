import { pushBreaking, pushDigest, alreadySent } from "./bark.js";
import { normalizePrefs } from "./prefs.js";
import { beijingParts, beijingYmd, isSilentHour } from "./time.js";

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
