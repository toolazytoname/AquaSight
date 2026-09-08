/** Content category, hide policy, notify eligibility. No network. */

import {
  LAB_RE,
  VETO_RE,
  ENT_DISPLAY_RE,
  CURIOSITY_RE,
  PROMO_RE,
  ACCIDENT_GOSSIP_RE,
  actionOf,
  extractEvent,
  isEnglishOfficialRelease,
  normalizeTitle,
} from "./extract.js";
import {
  HOT_SOURCES,
  TECH_SOURCES,
  WORLD_SOURCES,
  sourceFamily,
  sourceRole,
  isClueSource,
} from "./catalog.js";
import { ageHours } from "./time.js";

export {
  LAB_RE,
  VETO_RE,
  ENT_DISPLAY_RE,
  HOT_SOURCES,
  TECH_SOURCES,
  WORLD_SOURCES,
  sourceFamily,
};

export const STRONG_RE = /发布|开源|击退|吊打|市值|崩|突破|超越/;
export const DISASTER_RE = /空难|地震|宣战|开战|崩盘|遇难/;
export const DEATH_RE = /去世|逝世|病逝/;
export const HARD_IMPACT_RE = DISASTER_RE;

const TECH_CONTENT_RE =
  /模型|芯片|GPU|CPU|开源|操作系统|编程|人工智能|AI\b|软件|开发者|API|SDK|数据库|编译器|框架|协议|算法|机器人|半导体|鸿蒙|Android|iOS|Linux|Rust|Python|JavaScript|大模型|智能体|agent|transformer|cuda|pytorch/i;
const BUSINESS_CONTENT_RE =
  /净利润|营收|财报|银行|保险|利率|贷款|存款|央行|股市|IPO|融资|裁员|收购|并购|市值|股价|基金|券商|半年报|同比/i;
const PUBLIC_CONTENT_RE =
  /地震|空难|开战|宣战|战争|选举|议会|制裁|爆炸|溃坝|山洪|海啸/i;

export function namedFamilies(members) {
  const families = new Set();
  for (const m of members || []) {
    const f = sourceFamily(m?.source);
    if (f !== "other" && f !== "clue") families.add(f);
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
    const t = Date.parse(m?.occurredAt || m?.publishedAt || m?.seenAt || "");
    if (Number.isFinite(t) && (!Number.isFinite(best) || t > best)) best = t;
  }
  const ageH = (now - (Number.isFinite(best) ? best : now)) / 3600000;
  if (ageH <= 6) return 1;
  if (ageH <= 24) return 0.6;
  if (ageH <= 72) return 0.3;
  return 0.1;
}

export function blobOf(members) {
  return (members || [])
    .map((m) => [m?.title, m?.summary, m?.titleZh, m?.summaryZh].join(" "))
    .join(" \n ");
}

export function isEntertainment(title) {
  const t = title || "";
  return VETO_RE.test(t) || ENT_DISPLAY_RE.test(t);
}

export function isHiddenContent(members) {
  const titles = (members || []).map((m) => m?.title || "");
  const blob = blobOf(members);
  if (titles.some(isEntertainment)) return { hidden: true, reason: "entertainment" };
  if (CURIOSITY_RE.test(blob)) return { hidden: true, reason: "curiosity" };
  if (PROMO_RE.test(blob)) return { hidden: true, reason: "promo" };
  if (titles.some((t) => actionOf(t) === "death") || DEATH_RE.test(blob)) {
    return { hidden: true, reason: "obituary" };
  }
  if (ACCIDENT_GOSSIP_RE.test(blob)) return { hidden: true, reason: "accident" };
  const review = titles.some((t) => actionOf(t) === "review");
  if (review) return { hidden: true, reason: "retrospective" };
  return { hidden: false, reason: "" };
}

export function contentCategory(members) {
  const hide = isHiddenContent(members);
  if (hide.hidden) return "hidden";
  const blob = blobOf(members);
  const tech = TECH_CONTENT_RE.test(blob) || LAB_RE.test(blob);
  const business = BUSINESS_CONTENT_RE.test(blob);
  const pub = PUBLIC_CONTENT_RE.test(blob);
  const sources = (members || []).map((m) => m?.source);
  const onlyClues = sources.length > 0 && sources.every((s) => isClueSource(s));
  if (onlyClues && !tech && !business && !pub) return "hidden";
  if (business && !tech) return "business";
  if (business && tech) {
    if (/银行|保险|贷款|存款|央行|券商/.test(blob) && !/大模型|芯片|开源|API/.test(blob)) {
      return "business";
    }
    if (/财报|净利润|半年报|营收/.test(blob) && !/发布|开源|模型/.test(blob)) {
      return "business";
    }
  }
  if (tech) return "tech";
  if (pub) return "public";
  if (business) return "business";
  const families = namedFamilies(members);
  if (families.has("tech")) return "tech";
  if (families.has("business")) return "business";
  if (families.has("world")) return "public";
  return "tech";
}

export function isHotEntertainment(item) {
  if (sourceFamily(item && item.source) !== "clue" && sourceFamily(item && item.source) !== "hot") {
    if (!isClueSource(item && item.source)) {
      const title = String((item && item.title) || "");
      return VETO_RE.test(title) || ENT_DISPLAY_RE.test(title);
    }
  }
  const title = String((item && item.title) || "");
  return VETO_RE.test(title) || ENT_DISPLAY_RE.test(title);
}

export function isDisasterTitle(title) {
  return DISASTER_RE.test(title || "");
}

export function isDeathBreaking() {
  return false;
}

export function isNotableDeathTitle() {
  return false;
}

function isAccidentOrReview(members, now) {
  const titles = (members || []).map((m) => m?.title || "");
  if (titles.some((t) => actionOf(t) === "review")) return true;
  if (titles.some((t) => actionOf(t) === "death")) return true;
  if (ACCIDENT_GOSSIP_RE.test(blobOf(members))) return true;
  for (const m of members || []) {
    const meta = extractEvent(m, now);
    if (meta.retrospective) return true;
    if (meta.occurredAt && ageHours(meta.occurredAt, now) > 72 && actionOf(m?.title) === "disaster") {
      return true;
    }
  }
  return false;
}

export function notifyEligible(members, now = new Date()) {
  const list = (members || []).filter(Boolean);
  if (!list.length) return { ok: false, reason: "empty" };
  if (isHiddenContent(list).hidden) return { ok: false, reason: "hidden" };
  if (isAccidentOrReview(list, now)) return { ok: false, reason: "obituary-accident-review" };
  const cat = contentCategory(list);
  if (cat === "hidden") return { ok: false, reason: "hidden" };
  const published = list
    .map((m) => m.publishedAt || m.occurredAt || m.seenAt)
    .filter(Boolean);
  const newest = published.sort().slice(-1)[0];
  if (newest && ageHours(newest, now) > 24) return { ok: false, reason: "stale" };
  const titles = list.map((m) => m.title || "");
  const official = titles.some(isEnglishOfficialRelease) || list.some((m) => sourceRole(m.source) === "official");
  const zhRelease = titles.some((t) => /正式发布|推出/.test(t) && LAB_RE.test(t));
  const heat = heatOf(list);
  if (official || zhRelease) return { ok: true, reason: "official-release-candidate" };
  if (heat >= 3 && namedFamilies(list).size >= 2 && decayOf(list, toMs(now)) >= 0.6) {
    return { ok: true, reason: "cross-family-heat" };
  }
  return { ok: false, reason: "no-notify-rule" };
}

function toMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === "number") return now;
  const t = Date.parse(String(now || ""));
  return Number.isFinite(t) ? t : Date.now();
}

export function classifyMembers(members, now = new Date()) {
  const list = (members || []).filter(Boolean);
  const hide = isHiddenContent(list);
  const category = contentCategory(list);
  const notify = notifyEligible(list, now);
  if (hide.hidden || category === "hidden") {
    return {
      level: "normal",
      reason: "hidden:" + (hide.reason || "content"),
      category: "hidden",
      notifyEligible: false,
    };
  }
  if (notify.ok) {
    return {
      level: "breaking",
      reason: notify.reason,
      category,
      notifyEligible: true,
    };
  }
  return {
    level: "normal",
    reason: notify.reason || "no breaking rule matched",
    category,
    notifyEligible: false,
  };
}

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
