/** Cluster events into cards and score them. No network. */

import {
  LAB_RE,
  STRONG_RE,
  DISASTER_RE,
  VETO_RE,
  normalizeTitle,
  namedFamilies,
  heatOf,
  decayOf,
  classifyMembers,
  isDeathBreaking,
} from "./classify.js";
import { stripHtml } from "./rss.js";

const CJK = /[\u4e00-\u9fff]/;
const LATIN_WORD = /[A-Za-z][A-Za-z0-9]{1,}/g;
const FINANCE_STOP_RE =
  /上半年|净利润|同比|增长|下降|亿元|万元|半年报|拟10|派/g;
const EARNINGS_RE = /净利润|同比增长|营收|半年报/;

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
  return DISASTER_RE.test(t) || STRONG_RE.test(t);
}

export function companyPrefix(title) {
  const s = String(title || "");
  const i = s.search(/[：:]/);
  if (i <= 0) return "";
  return s.slice(0, i).trim();
}

function tokensForJaccard(title) {
  return titleTokens(String(title || "").replace(FINANCE_STOP_RE, ""));
}

export function looksEarnings(title) {
  return EARNINGS_RE.test(title || "");
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

  const pa = companyPrefix(ta);
  const pb = companyPrefix(tb);
  if (pa && pb && pa !== pb) return false;

  if (looksEarnings(ta) && looksEarnings(tb) && na !== nb) {
    if (!pa || !pb || pa !== pb) return false;
  }

  if (jaccard(tokensForJaccard(ta), tokensForJaccard(tb)) >= 0.5) return true;

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

export { heatOf, decayOf };

export function scoreCard(members, now = Date.now()) {
  const titles = members.map((m) => m?.title || "");
  const familyCount = namedFamilies(members).size;
  const heat = heatOf(members);
  const hard =
    titles.some((t) => DISASTER_RE.test(t)) || isDeathBreaking(members)
      ? 1
      : 0;
  const labStrong = titles.some((t) => LAB_RE.test(t) && STRONG_RE.test(t))
    ? 1
    : 0;
  const care = titles.some((t) => LAB_RE.test(t)) ? 1 : 0;
  const decay = decayOf(members, now);
  return (
    (2 * familyCount + 2 * heat + 3 * hard + 2 * labStrong + 1 * care) * decay
  );
}

export function classifyCard(members, now = Date.now()) {
  const { level, reason } = classifyMembers(members, now);
  const score = scoreCard(members, now);
  return { level, reason, score };
}

function pickSummary(members) {
  let best = "";
  for (const m of members) {
    const s = stripHtml(String(m?.summary || ""))
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (s.length > best.length) best = s;
  }
  return best.length >= 12 ? best : "";
}

export function memberIdsOf(item) {
  if (Array.isArray(item?.memberIds) && item.memberIds.length) {
    return item.memberIds.filter(Boolean);
  }
  const id = String(item?.id || "");
  if (id.includes("|")) return id.split("|").filter(Boolean);
  return id ? [id] : [];
}

export function stableCardId(members) {
  const labs = new Set();
  for (const m of members || []) {
    for (const x of labEntities(m?.title)) labs.add(x);
  }
  if (labs.size) {
    return "card:" + [...labs].sort()[0];
  }
  const prefixes = new Set();
  for (const m of members || []) {
    const p = companyPrefix(m?.title);
    if (p) prefixes.add(normalizeTitle(p));
  }
  if (prefixes.size === 1) {
    return "card:" + [...prefixes][0];
  }
  const norms = (members || [])
    .map((m) => normalizeTitle(m?.title))
    .filter(Boolean)
    .sort();
  return "card:" + (norms[0] || "empty").slice(0, 80);
}

function toCard(members) {
  const primary = members[0] || {};
  const { level, reason, score } = classifyCard(members);
  const memberIds = members.map((m) => m?.id).filter(Boolean);
  const summary = pickSummary(members);
  const card = {
    id: stableCardId(members),
    title: primary.title || "",
    titleZh: primary.titleZh,
    url: primary.url,
    source: primary.source,
    level,
    reason,
    score,
    memberIds,
    sources: members.map((m) => ({
      source: m?.source,
      url: m?.url,
      title: m?.title,
    })),
  };
  if (primary.publishedAt) card.publishedAt = primary.publishedAt;
  else {
    let best = "";
    let bestT = NaN;
    for (const m of members) {
      const t = Date.parse(m?.publishedAt || "");
      if (Number.isFinite(t) && (!Number.isFinite(bestT) || t > bestT)) {
        bestT = t;
        best = m.publishedAt;
      }
    }
    if (best) card.publishedAt = best;
  }
  if (primary.seenAt) card.seenAt = primary.seenAt;
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
