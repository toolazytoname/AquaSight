/** Beijing clock and event time fields. No network. */

export const TZ_MS = 8 * 3600 * 1000;

export function toMs(value) {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : NaN;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const t = Date.parse(String(value || ""));
  return Number.isFinite(t) ? t : NaN;
}

export function toIso(value) {
  const t = toMs(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : "";
}

export function beijingParts(now = new Date()) {
  const t = toMs(now);
  const d = new Date((Number.isFinite(t) ? t : Date.now()) + TZ_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    ymd:
      d.getUTCFullYear() +
      "-" +
      String(d.getUTCMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getUTCDate()).padStart(2, "0"),
  };
}

export function beijingYmd(now = new Date()) {
  return beijingParts(now).ymd;
}

export function beijingDayKey(isoOrDate) {
  const t = toMs(isoOrDate);
  if (!Number.isFinite(t)) return "";
  return beijingYmd(t);
}

export function isSilentHour(now = new Date(), start = "23:00", end = "08:00") {
  const p = beijingParts(now);
  const cur = p.hour * 60 + p.minute;
  const [sh, sm] = String(start || "23:00").split(":").map(Number);
  const [eh, em] = String(end || "08:00").split(":").map(Number);
  const a = (sh || 0) * 60 + (sm || 0);
  const b = (eh || 0) * 60 + (em || 0);
  if (a === b) return false;
  if (a < b) return cur >= a && cur < b;
  return cur >= a || cur < b;
}

export function ageHours(isoOrDate, now = Date.now()) {
  const t = toMs(isoOrDate);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (toMs(now) - t) / 3600000);
}

export function earlierIso(a, b) {
  const ta = toMs(a);
  const tb = toMs(b);
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? toIso(b) : "";
  if (!Number.isFinite(tb)) return toIso(a);
  return ta <= tb ? toIso(a) : toIso(b);
}

export function laterIso(a, b) {
  const ta = toMs(a);
  const tb = toMs(b);
  if (!Number.isFinite(ta)) return Number.isFinite(tb) ? toIso(b) : "";
  if (!Number.isFinite(tb)) return toIso(a);
  return ta >= tb ? toIso(a) : toIso(b);
}

const YEAR_RE = /(19|20)\d{2}年(?:\d{1,2}月(?:\d{1,2}日)?)?/;
const ISO_DATE_RE = /(19|20)\d{2}-\d{1,2}-\d{1,2}/;
const YEARS_AGO_RE = /(\d{1,2})\s*年前|十年前/;
const REVIEW_RE = /回顾|周年|那年|历史上的今天|on this day|years ago|throwback/i;

export function parseTitleTime(title, now = new Date()) {
  const s = String(title || "");
  const nowMs = toMs(now) || Date.now();
  const retrospective = REVIEW_RE.test(s) || YEARS_AGO_RE.test(s);
  let occurredAt = "";
  const ago = s.match(YEARS_AGO_RE);
  if (ago) {
    const n = ago[0].includes("十") ? 10 : Number(ago[1]);
    if (Number.isFinite(n) && n > 0) {
      const d = new Date(nowMs);
      d.setUTCFullYear(d.getUTCFullYear() - n);
      occurredAt = d.toISOString();
    }
  }
  if (!occurredAt) {
    const y = s.match(YEAR_RE);
    if (y) {
      const nums = y[0].match(/\d+/g) || [];
      const year = Number(nums[0]);
      const month = Number(nums[1] || 1);
      const day = Number(nums[2] || 1);
      if (year >= 1900) {
        occurredAt = new Date(Date.UTC(year, month - 1, day)).toISOString();
      }
    }
  }
  if (!occurredAt) {
    const iso = s.match(ISO_DATE_RE);
    if (iso) {
      const t = Date.parse(iso[0] + "T00:00:00Z");
      if (Number.isFinite(t)) occurredAt = new Date(t).toISOString();
    }
  }
  return { occurredAt, retrospective };
}

export function eventDayKey(item, now = new Date()) {
  const t =
    toMs(item?.occurredAt) ||
    toMs(item?.publishedAt) ||
    toMs(item?.firstSeenAt) ||
    toMs(item?.seenAt);
  if (Number.isFinite(t)) return beijingDayKey(t);
  return beijingYmd(now);
}
