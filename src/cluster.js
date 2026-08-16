/** Cluster events into cards and score them. No network. */

import {
  LAB_RE,
  STRONG_RE,
  HARD_IMPACT_RE,
  VETO_RE,
  normalizeTitle,
  sourceFamily,
} from "./classify.js";

const CJK = /[\u4e00-\u9fff]/;
const LATIN_WORD = /[A-Za-z][A-Za-z0-9]{1,}/g;

export function titleTokens(title) {
  const s = String(title || "");
  const tokens = new Set();
  const words = s.match(LATIN_WORD) || [];
  for (const w of words) {
    if (w.length >= 2) tokens.add(w.toLowerCase());
  }
  let buf = "";
  for (const ch of s) {
    if (CJK.test(ch)) buf += ch;
    else {
      addCjkBigrams(buf, tokens);
      buf = "";
    }
  }
  addCjkBigrams(buf, tokens);
  return tokens;
}

function addCjkBigrams(buf, tokens) {
  for (let i = 0; i + 1 < buf.length; i++) {
    tokens.add(buf.slice(i, i + 2));
  }
}

export function jaccard(a, b) {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function labEntities(title) {
  const found = String(title || "").match(new RegExp(LAB_RE.source, "gi")) || [];
  return new Set(found.map((m) => m.toLowerCase()));
}

export function hasImpact(title) {
  const t = title || "";
  return HARD_IMPACT_RE.test(t) || STRONG_RE.test(t);
}

export function shouldMerge(a, b) {
  const ta = a?.title || "";
  const tb = b?.title || "";
  const vetoA = VETO_RE.test(ta);
  const vetoB = VETO_RE.test(tb);
  if (vetoA !== vetoB) return false;

  const na = normalizeTitle(ta);
  const nb = normalizeTitle(tb);
  if (na && na === nb) return true;

  if (jaccard(titleTokens(ta), titleTokens(tb)) >= 0.5) return true;

  const labsA = labEntities(ta);
  const labsB = labEntities(tb);
  let shareLab = false;
  for (const x of labsA) {
    if (labsB.has(x)) {
      shareLab = true;
      break;
    }
  }
  if (shareLab && hasImpact(ta) && hasImpact(tb)) return true;
  return false;
}

export function scoreCard(members) {
  const titles = members.map((m) => m?.title || "");
  const families = new Set(members.map((m) => sourceFamily(m?.source)));
  const familyCount = families.size;
  const hard = titles.some((t) => HARD_IMPACT_RE.test(t)) ? 1 : 0;
  const labStrong = titles.some((t) => LAB_RE.test(t) && STRONG_RE.test(t)) ? 1 : 0;
  const care = titles.some((t) => LAB_RE.test(t)) ? 1 : 0;
  return 2 * familyCount + 3 * hard + 2 * labStrong + 1 * care;
}

export function classifyCard(members) {
  const titles = members.map((m) => m?.title || "");
  const families = new Set(members.map((m) => sourceFamily(m?.source)));
  const familyCount = families.size;
  const hard = titles.some((t) => HARD_IMPACT_RE.test(t));
  const labStrong = titles.some((t) => LAB_RE.test(t) && STRONG_RE.test(t));
  const veto = titles.some((t) => VETO_RE.test(t));
  const score = scoreCard(members);

  if (veto && !hard) {
    return { level: "normal", reason: "veto entertainment unless hard impact", score };
  }
  if (hard) {
    return { level: "breaking", reason: "hard impact keyword", score };
  }
  if (labStrong) {
    return { level: "breaking", reason: "lab + strong event", score };
  }
  if (familyCount >= 2) {
    return { level: "breaking", reason: "cross-family sources", score };
  }
  return { level: "normal", reason: "no breaking rule matched", score };
}

function pickSummary(members) {
  let best = "";
  for (const m of members) {
    const s = String(m?.summary || "");
    if (s.length > best.length) best = s;
  }
  return best;
}

function toCard(members) {
  const primary = members[0] || {};
  const { level, reason, score } = classifyCard(members);
  const id = members
    .map((m) => m?.id || normalizeTitle(m?.title))
    .filter(Boolean)
    .sort()
    .join("|");
  const summary = pickSummary(members);
  const card = {
    id: id || "cluster:empty",
    title: primary.title || "",
    titleZh: primary.titleZh,
    url: primary.url,
    source: primary.source,
    level,
    reason,
    score,
    sources: members.map((m) => ({
      source: m?.source,
      url: m?.url,
      title: m?.title,
    })),
  };
  if (summary) card.summary = summary;
  if (primary.summaryZh) card.summaryZh = primary.summaryZh;
  return card;
}

export function cluster(events = []) {
  const groups = [];
  for (const ev of events) {
    let placed = false;
    for (const g of groups) {
      if (g.some((member) => shouldMerge(member, ev))) {
        g.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([ev]);
  }
  return groups.map(toCard);
}
