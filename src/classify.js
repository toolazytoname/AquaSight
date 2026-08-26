/** Classify heuristics. No network. No rank-based breaking. */

import {
  HOT_SOURCES,
  TECH_SOURCES,
  WORLD_SOURCES,
  VETO_RE,
  ENT_DISPLAY_RE,
  sourceFamily,
} from "../web/rules.js";

export {
  HOT_SOURCES,
  TECH_SOURCES,
  WORLD_SOURCES,
  VETO_RE,
  ENT_DISPLAY_RE,
  sourceFamily,
};

export const LAB_RE =
  /DeepSeek|OpenAI|英伟达|NVIDIA|华为|Kimi|\bK3\b|Qwen|Claude|GPT|Gemini/i;
export const STRONG_RE = /发布|开源|击退|吊打|市值|崩|突破|超越/;
export const DISASTER_RE = /空难|地震|宣战|开战|崩盘|遇难/;
export const DEATH_RE = /去世|逝世|病逝/;
export const DEATH_VETO_RE =
  /奶奶|儿子|女儿|夫妇|乞丐|老人|女子|男子|男友|女友|子女|家属|情侣|前女友|前男友/;
export const PUBLIC_ROLE_RE =
  /总设计师|院士|主席|总理|总统|创始人|教授|议员|大使|书记|部长/;
export const NOTABLE_DEATH_RE =
  /[\u4e00-\u9fff]{2,4}(因病)?(去世|逝世|病逝)\s*$/;

/** Kept for callers that still import the old name. Disaster only; death is separate. */
export const HARD_IMPACT_RE = DISASTER_RE;

export function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

export function isDisasterTitle(title) {
  return DISASTER_RE.test(title || "");
}

export function isNotableDeathTitle(title) {
  const t = title || "";
  if (!DEATH_RE.test(t)) return false;
  if (DEATH_VETO_RE.test(t)) return false;
  if (PUBLIC_ROLE_RE.test(t)) return true;
  return NOTABLE_DEATH_RE.test(t);
}

export function namedFamilies(members) {
  const families = new Set();
  for (const m of members || []) {
    const f = sourceFamily(m?.source);
    if (f !== "other") families.add(f);
  }
  return families;
}

export function heatOf(members) {
  const s = new Set();
  for (const m of members || []) {
    const src = String(m?.source || "").toLowerCase();
    if (src) s.add(src);
  }
  return Math.min(s.size, 5);
}

export function decayOf(members, now = Date.now()) {
  let best = NaN;
  for (const m of members || []) {
    const t = Date.parse(m?.publishedAt || m?.seenAt || "");
    if (Number.isFinite(t) && (!Number.isFinite(best) || t > best)) best = t;
  }
  const ageH = (now - (Number.isFinite(best) ? best : now)) / 3600000;
  if (ageH <= 6) return 1;
  if (ageH <= 24) return 0.6;
  if (ageH <= 72) return 0.3;
  return 0.1;
}

export function isDeathBreaking(members) {
  const list = members || [];
  const titles = list.map((m) => m?.title || "");
  if (!titles.some((t) => DEATH_RE.test(t))) return false;
  const usable = titles.filter((t) => DEATH_RE.test(t) && !DEATH_VETO_RE.test(t));
  if (!usable.length) return false;
  if (heatOf(list) >= 2) return true;
  return usable.some(isNotableDeathTitle);
}

export function classifyMembers(members, now = Date.now()) {
  const list = (members || []).filter(Boolean);
  const titles = list.map((m) => m?.title || "");
  const familyCount = namedFamilies(list).size;
  const heat = heatOf(list);
  const decay = decayOf(list, now);
  const disaster = titles.some(isDisasterTitle);
  const veto = titles.some((t) => VETO_RE.test(t));

  if (veto && !disaster) {
    return { level: "normal", reason: "veto entertainment unless hard impact" };
  }
  if (disaster) {
    return { level: "breaking", reason: "hard impact keyword" };
  }
  if (isDeathBreaking(list)) {
    return { level: "breaking", reason: "notable death" };
  }
  if (titles.some((t) => LAB_RE.test(t) && STRONG_RE.test(t)) && decay >= 0.6) {
    return { level: "breaking", reason: "lab + strong event" };
  }
  if (familyCount >= 2 && heat >= 3 && decay >= 0.6) {
    return { level: "breaking", reason: "cross-family heat" };
  }
  return { level: "normal", reason: "no breaking rule matched" };
}

/**
 * @param {{ title?: string, source?: string, rank?: number }} event
 * @param {Array<{ title?: string, source?: string }>} [allEvents]
 * @returns {{ level: "breaking" | "normal", reason: string }}
 */
export function classify(event, allEvents = []) {
  const members = [];
  const seen = new Set();
  const norm = normalizeTitle(event?.title);
  for (const e of [event, ...(allEvents || [])]) {
    if (!e) continue;
    const key = e.id || normalizeTitle(e.title) + ":" + String(e.source || "");
    if (seen.has(key)) continue;
    if (e === event || normalizeTitle(e.title) === norm) {
      seen.add(key);
      members.push(e);
    }
  }
  if (!members.length && event) members.push(event);
  return classifyMembers(members);
}
