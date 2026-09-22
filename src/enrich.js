import {
  actualCny,
  cacheKey,
  createBudget,
  ENRICH_VERSION,
  MAX_TOKENS_IN,
  MAX_TOKENS_OUT,
  reserveCny,
  resolvePricing,
} from "./budget.js";

export const MODEL = "grok-4.5";
export const BASE_URL = "https://api.x.ai/v1";

export function resolveEnrichEndpoint(opts = {}) {
  const apiKey = String(opts.apiKey || process.env.XAI_API_KEY || "").trim();
  const baseUrl = String(opts.baseUrl || process.env.XAI_BASE_URL || BASE_URL)
    .trim()
    .replace(/\/+$/, "") || BASE_URL;
  const model = String(opts.model || process.env.XAI_MODEL || MODEL).trim() || MODEL;
  return { apiKey, baseUrl, model };
}

const SCHEMA_KEYS = [
  "category",
  "entities",
  "titleZh",
  "overviewZh",
  "facts",
  "impact",
  "evidence",
  "uncertainty",
  "attribution",
  "insufficient",
];

export function contentBlob(item) {
  return [
    item?.title || "",
    item?.summary || "",
    item?.body || "",
    item?.url || "",
    ...(Array.isArray(item?.sources) ? item.sources.map((s) => s.title) : []),
  ].join("\n");
}

export function validateEnrichment(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "not-object" };
  }
  const category = String(raw.category || "");
  if (!["tech", "business", "public", "hidden"].includes(category)) {
    return { ok: false, error: "bad-category" };
  }
  if (typeof raw.titleZh !== "string" || !raw.titleZh.trim()) {
    return { ok: false, error: "titleZh" };
  }
  if (typeof raw.overviewZh !== "string") return { ok: false, error: "overviewZh" };
  if (!Array.isArray(raw.facts) || raw.facts.length > 3) {
    return { ok: false, error: "facts" };
  }
  if (raw.facts.some((f) => typeof f !== "string")) return { ok: false, error: "facts-type" };
  if (!Array.isArray(raw.evidence)) return { ok: false, error: "evidence" };
  if (!Array.isArray(raw.uncertainty)) return { ok: false, error: "uncertainty" };
  if (!Array.isArray(raw.entities)) return { ok: false, error: "entities" };
  if (!Array.isArray(raw.attribution)) return { ok: false, error: "attribution" };
  if (typeof raw.insufficient !== "boolean") return { ok: false, error: "insufficient" };
  if (typeof raw.impact !== "string") return { ok: false, error: "impact" };
  return { ok: true, value: pickSchema(raw) };
}

function pickSchema(raw) {
  const out = {};
  for (const k of SCHEMA_KEYS) out[k] = raw[k];
  out.facts = (raw.facts || []).slice(0, 3).map((s) => String(s).trim()).filter(Boolean);
  out.titleZh = String(raw.titleZh).trim();
  out.overviewZh = String(raw.overviewZh || "").trim();
  return out;
}

export function fallbackEnrichment(item, reason = "model-unavailable") {
  const title = String(item?.titleZh || item?.title || "").trim();
  const summary = String(item?.summaryZh || item?.summary || "").trim();
  return {
    category: item?.category && item.category !== "hidden" ? item.category : "tech",
    entities: item?.subject ? [{ name: item.subject, type: "subject" }] : [],
    titleZh: /[\u4e00-\u9fff]/.test(title) ? title : "",
    overviewZh: /[\u4e00-\u9fff]/.test(summary) ? summary : "",
    facts: [],
    impact: "",
    evidence: [],
    uncertainty: ["资料不足，未调用或未通过模型校验：" + reason],
    attribution: [],
    insufficient: true,
    degraded: true,
    fallbackReason: reason,
  };
}

/**
 * Real processing state persisted on the item, so the UI never has to guess
 * from field presence. queued = waiting for credentials/budget/turn;
 * failed = dispatched but errored; insufficient = model saw too little
 * material; ready = enrichment accepted.
 */
export function aiStateForReason(reason) {
  const r = String(reason || "");
  if (/^(no-credential|pricing-[a-z]+|daily-cap|monthly-cap|candidate-cap|budget)$/i.test(r)) return "queued";
  return "failed";
}

const URL_IN_TEXT_RE = /https?:\/\/[^\s"'<>）】\]]+/gi;

export function foreignUrls(text, allowedHosts) {
  const found = [];
  for (const match of String(text || "").matchAll(URL_IN_TEXT_RE)) {
    try {
      const host = new URL(match[0]).hostname.toLowerCase();
      if (!allowedHosts.has(host)) found.push(match[0]);
    } catch {
      // not a parseable URL; ignore
    }
  }
  return found;
}

function allowedHostsOf(item) {
  const hosts = new Set();
  const urls = [item?.url, item?.discussionUrl];
  for (const s of item?.sources || []) if (s && s.url) urls.push(s.url);
  for (const u of urls) {
    try {
      if (u) hosts.add(new URL(u).hostname.toLowerCase());
    } catch {
      // ignore malformed
    }
  }
  return hosts;
}

function scrubModelCitations(value, item) {
  // The model must only cite the source set it was given; anything else is
  // dropped rather than shown as evidence.
  const allowed = allowedHostsOf(item);
  if (!allowed.size) return value;
  const hasForeign = (entry) =>
    foreignUrls(typeof entry === "string" ? entry : JSON.stringify(entry || ""), allowed).length > 0;
  const evidence = Array.isArray(value.evidence) ? value.evidence : [];
  const attribution = Array.isArray(value.attribution) ? value.attribution : [];
  const badEvidence = evidence.filter(hasForeign);
  const badAttribution = attribution.filter(hasForeign);
  if (!badEvidence.length && !badAttribution.length) return value;
  const dropped = badEvidence.length + badAttribution.length;
  return {
    ...value,
    evidence: evidence.filter((e) => !hasForeign(e)),
    attribution: attribution.filter((a) => !hasForeign(a)),
    uncertainty: [
      ...(Array.isArray(value.uncertainty) ? value.uncertainty : []),
      "模型引用了本次来源之外的链接，已移除 " + dropped + " 条。",
    ],
  };
}

function extractJson(text) {
  const s = String(text || "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function estimateTokens(text) {
  let n = 0;
  for (const ch of String(text || "")) {
    n += ch >= "\u4e00" && ch <= "\u9fff" ? 1 : 0.25;
  }
  return Math.ceil(n);
}

export function clipToTokens(text, maxTokens) {
  const s = String(text || "");
  if (estimateTokens(s) <= maxTokens && s.length <= maxTokens) return s;
  let out = "";
  let used = 0;
  for (const ch of s) {
    const cost = ch >= "\u4e00" && ch <= "\u9fff" ? 1 : 0.25;
    if (used + cost > maxTokens || out.length + 1 > maxTokens) break;
    out += ch;
    used += cost;
  }
  return out;
}

export function buildPrompt(item) {
  const sources = Array.isArray(item.sources) ? item.sources : [];
  const lines = sources
    .map((s) => "- [" + (s.source || "") + "] " + (s.title || "") + " " + (s.url || ""))
    .join("\n");
  const header = [
    "你是新闻整理器。只根据给定材料输出 JSON，禁止根据标题虚构细节。",
    "材料不足时 insufficient=true，facts 留空，uncertainty 说明缺什么。",
    "企业自述和个人观点必须写入 attribution。",
    "字段：category(tech|business|public|hidden), entities[{name,type}], titleZh, overviewZh, facts(最多3条), impact, evidence[], uncertainty[], attribution[{claim,source}], insufficient(boolean)。",
    "标题：" + clipToTokens(item.title || "", 200),
    "摘要：" + clipToTokens(item.summary || "", 400),
  ].join("\n");
  const sourceBudget = 200;
  const bodyBudget = Math.max(0, MAX_TOKENS_IN - estimateTokens(header) - sourceBudget - 20);
  const prompt =
    header +
    "\n正文：" +
    clipToTokens(item.body || "", bodyBudget) +
    "\n来源：\n" +
    clipToTokens(lines, sourceBudget);
  return clipToTokens(prompt, MAX_TOKENS_IN);
}

export async function enrichOne(item, opts = {}) {
  const version = opts.version || ENRICH_VERSION;
  const key = cacheKey(contentBlob(item), version);
  if (opts.cache && opts.cache[key]) return { ...opts.cache[key], cached: true, cacheKey: key };
  const { apiKey, baseUrl, model } = resolveEnrichEndpoint(opts);
  if (!apiKey) {
    return { ...fallbackEnrichment(item, "no-credential"), cacheKey: key };
  }
  const pricing = resolvePricing({
    baseUrl,
    model,
    usdPerMtokIn: opts.usdPerMtokIn,
    usdPerMtokOut: opts.usdPerMtokOut,
  });
  if (!pricing.pricingKnown) {
    return { ...fallbackEnrichment(item, pricing.blockedReason), cacheKey: key };
  }
  const budget = opts.budget || createBudget(opts.budgetState, opts.now, { pricing });
  const reserved = reserveCny(pricing);
  // A relay can hand back HTTP 200 with empty/garbage content; one retry converts most of those.
  const retryable = new Set(["parse", "invalid:not-object"]);
  for (let attempt = 0; ; attempt++) {
    let reservation;
    try {
      reservation = await budget.reserve({ cny: reserved, now: opts.now });
    } catch (e) {
      return { ...fallbackEnrichment(item, e.code || "budget"), cacheKey: key };
    }
    const fetchImpl = opts.fetchImpl || fetch;
    let dispatched = false;
    async function keepUnknown() {
      if (budget.keep) await budget.keep(reservation);
      else await budget.commit(reservation, reservation?.cny || reserved);
    }
    try {
      dispatched = true;
      const res = await fetchImpl(baseUrl + "/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_TOKENS_OUT,
          messages: [
            { role: "system", content: "Return JSON only." },
            { role: "user", content: buildPrompt(item) },
          ],
        }),
      });
      if (!res || !res.ok) {
        await budget.release(reservation);
        return { ...fallbackEnrichment(item, "http-" + (res && res.status)), cacheKey: key };
      }
      let data;
      try {
        data = await res.json();
      } catch {
        await keepUnknown();
        if (attempt === 0) continue;
        return { ...fallbackEnrichment(item, "parse"), cacheKey: key };
      }
      const text =
        data?.choices?.[0]?.message?.content ||
        data?.output_text ||
        "";
      const parsed = extractJson(text);
      const checked = validateEnrichment(parsed);
      const actual = actualCny(data?.usage, pricing);
      await budget.commit(reservation, actual);
      if (!checked.ok) {
        const reason = "invalid:" + checked.error;
        if (attempt === 0 && retryable.has(reason)) continue;
        return { ...fallbackEnrichment(item, reason), cacheKey: key, usageCny: actual };
      }
      const value = scrubModelCitations({ ...checked.value, usageCny: actual, cacheKey: key }, item);
      if (opts.cache) opts.cache[key] = value;
      return value;
    } catch (e) {
      const timedOut =
        e && (e.name === "AbortError" || /timeout|aborted/i.test(String(e.message || e)));
      if ((dispatched || timedOut) && budget.keep) await keepUnknown();
      else await budget.release(reservation);
      return {
        ...fallbackEnrichment(item, e && e.message ? e.message : "error"),
        cacheKey: key,
      };
    }
  }
}

export async function enrichItems(items, opts = {}) {
  const out = [];
  for (const it of items || []) {
    const en = await enrichOne(it, opts);
    const next = { ...it };
    next.aiState = en.degraded ? aiStateForReason(en.fallbackReason) : en.insufficient ? "insufficient" : "ready";
    if (en.titleZh) next.titleZh = en.titleZh;
    if (en.overviewZh) next.overviewZh = next.summaryZh = en.overviewZh;
    if (en.facts) next.facts = en.facts;
    if (en.insufficient) next.enrichInsufficient = true;
    if (en.uncertainty) next.uncertainty = en.uncertainty;
    if (en.attribution) next.attribution = en.attribution;
    if (en.evidence) next.evidence = en.evidence;
    if (typeof en.impact === "string") next.impact = en.impact;
    if (en.entities) next.entities = en.entities;
    if (en.category) {
      next.category = en.category;
      if (en.category === "hidden") {
        next.level = "normal";
        next.notifyEligible = false;
      }
    }
    next.enrich = en;
    out.push(next);
  }
  return out;
}

export async function summarizeDigest(entries, opts = {}) {
  const { apiKey, baseUrl, model } = resolveEnrichEndpoint(opts);
  if (!apiKey) return { text: "", reason: "no-credential" };
  const pricing = resolvePricing({ baseUrl, model, usdPerMtokIn: opts.usdPerMtokIn, usdPerMtokOut: opts.usdPerMtokOut });
  if (!pricing.pricingKnown) return { text: "", reason: pricing.blockedReason };
  const lines = (entries || [])
    .slice(0, 25)
    .map((it) => String(it?.titleZh || it?.title || "").trim())
    .filter(Boolean);
  if (lines.length < 3) return { text: "", reason: "not-enough-entries" };
  const budget = opts.budget || createBudget(opts.budgetState, opts.now, { pricing });
  let reservation;
  try {
    reservation = await budget.reserve({ cny: reserveCny(pricing), now: opts.now });
  } catch (e) {
    return { text: "", reason: e.code || "budget" };
  }
  const fetchImpl = opts.fetchImpl || fetch;
  try {
    const res = await fetchImpl(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "你是新闻编辑。只依据给定条目写 3 到 4 句中文综述，概括今天最重要的动向，不虚构，不罗列全部条目。直接输出综述正文，不要标题，不要列表。",
          },
          { role: "user", content: lines.map((t, i) => i + 1 + ". " + t).join("\n") },
        ],
      }),
    });
    if (!res || !res.ok) {
      await budget.release(reservation);
      return { text: "", reason: "http-" + (res && res.status) };
    }
    let data;
    try {
      data = await res.json();
    } catch {
      await budget.release(reservation);
      return { text: "", reason: "parse" };
    }
    const text = String(data?.choices?.[0]?.message?.content || "").trim().slice(0, 500);
    await budget.commit(reservation, actualCny(data?.usage, pricing));
    if (!text) return { text: "", reason: "empty" };
    return { text, model };
  } catch (e) {
    await budget.release(reservation);
    return { text: "", reason: e && e.message ? e.message : "error" };
  }
}
