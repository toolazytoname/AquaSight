import { heatOf, contentCategory, isHiddenContent } from "./classify.js";
import { sourceQuality, isClueSource, sourceRole } from "./catalog.js";
import { extractEvent, isEnglishOfficialRelease, LAB_RE } from "./extract.js";
import { ageHours } from "./time.js";

export const SCORE_WEIGHTS = {
  relevance: 0.35,
  impact: 0.25,
  newInfo: 0.2,
  sourceQuality: 0.15,
  heat: 0.05,
};

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function recencyScore(hours) {
  if (hours <= 6) return 1;
  if (hours <= 24) return 0.7;
  if (hours <= 72) return 0.4;
  if (hours <= 168) return 0.2;
  return 0.05;
}

export function scoreParts(members, now = new Date()) {
  const list = (members || []).filter(Boolean);
  const hide = isHiddenContent(list);
  const category = contentCategory(list);
  if (hide.hidden || category === "hidden") {
    return {
      relevance: 0,
      impact: 0,
      newInfo: 0,
      sourceQuality: 0,
      heat: 0,
      value: 0,
      category: "hidden",
    };
  }
  const blob = list.map((m) => m.title || "").join(" ");
  let relevance = 0.4;
  if (category === "tech") relevance = 0.95;
  else if (category === "business") relevance = 0.7;
  else if (category === "public") relevance = 0.45;
  if (list.every((m) => isClueSource(m.source))) relevance = Math.min(relevance, 0.25);

  let impact = 0.35;
  if (list.some((m) => isEnglishOfficialRelease(m.title) || sourceRole(m.source) === "official")) {
    impact = 0.9;
  } else if (LAB_RE.test(blob) && /发布|开源|launch|release/i.test(blob)) {
    impact = 0.8;
  } else if (/市值蒸发|崩盘/.test(blob)) {
    impact = 0.7;
  } else if (/净利润|财报|营收/.test(blob)) {
    impact = 0.4;
  } else if (sourceRole(list[0]?.source) === "opensource") {
    impact = 0.3;
  }

  let newestPub = 0;
  for (const m of list) {
    const meta = extractEvent(m, now);
    const t = Date.parse(meta.publishedAt || meta.occurredAt || meta.firstSeenAt || "");
    if (Number.isFinite(t) && t > newestPub) newestPub = t;
  }
  const newInfo = recencyScore(ageHours(newestPub || now, now));

  const qualities = list.map((m) => sourceQuality(m.source));
  const srcQ = qualities.length ? Math.max(...qualities) : 0.4;

  const heat = clamp01(heatOf(list) / 4);
  const extra =
    list.reduce((n, m) => n + (Number(m.points) || 0), 0) > 80 ? 0.2 : 0;

  const value =
    SCORE_WEIGHTS.relevance * relevance +
    SCORE_WEIGHTS.impact * impact +
    SCORE_WEIGHTS.newInfo * newInfo +
    SCORE_WEIGHTS.sourceQuality * srcQ +
    SCORE_WEIGHTS.heat * clamp01(heat + extra);

  return {
    relevance,
    impact,
    newInfo,
    sourceQuality: srcQ,
    heat: clamp01(heat + extra),
    value: Math.round(value * 1000) / 1000,
    category,
  };
}

export function scoreCard(members, now = new Date()) {
  const parts = scoreParts(members, now);
  return Math.round(parts.value * 100);
}
