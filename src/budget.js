import { beijingYmd } from "./time.js";
import { sha256Hex } from "./hash.js";

export const MONTHLY_CNY = 100;
export const DAILY_CNY = 3.3;
export const DAILY_CANDIDATE_CAP = 100;
export const ENRICH_VERSION = "v1";
export const CNY_PER_USD = 7.2;
export const USD_PER_MTOK_IN = 3;
export const USD_PER_MTOK_OUT = 15;
export const OFFICIAL_BASE_URL = "https://api.x.ai/v1";
export const OFFICIAL_MODEL = "grok-4.5";
export const MAX_TOKENS_IN = 2000;
export const MAX_TOKENS_OUT = 600;

function parseRate(v) {
  if (v == null || String(v).trim() === "" || typeof v === "boolean") return NaN;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function roundCny(n) {
  return Math.round(n * 10000) / 10000;
}

export function resolvePricing(opts = {}) {
  const baseUrl = String(opts.baseUrl || process.env.XAI_BASE_URL || OFFICIAL_BASE_URL)
    .trim()
    .replace(/\/+$/, "") || OFFICIAL_BASE_URL;
  const model = String(opts.model || process.env.XAI_MODEL || OFFICIAL_MODEL).trim() || OFFICIAL_MODEL;
  const usdPerMtokIn = parseRate(opts.usdPerMtokIn ?? process.env.XAI_USD_PER_MTOK_IN);
  const usdPerMtokOut = parseRate(opts.usdPerMtokOut ?? process.env.XAI_USD_PER_MTOK_OUT);
  const priced = Number.isFinite(usdPerMtokIn) && Number.isFinite(usdPerMtokOut);
  const configured = [opts.usdPerMtokIn ?? process.env.XAI_USD_PER_MTOK_IN, opts.usdPerMtokOut ?? process.env.XAI_USD_PER_MTOK_OUT]
    .some((v) => v != null && v !== "");
  const official = baseUrl === OFFICIAL_BASE_URL && model === OFFICIAL_MODEL;
  if (priced) {
    return { usdPerMtokIn, usdPerMtokOut, hard: true, pricingKnown: true, blockedReason: null, official };
  }
  if (official && !configured) {
    return { usdPerMtokIn: USD_PER_MTOK_IN, usdPerMtokOut: USD_PER_MTOK_OUT, hard: true, pricingKnown: true, blockedReason: null, official: true };
  }
  return { usdPerMtokIn: null, usdPerMtokOut: null, hard: true, pricingKnown: false, blockedReason: configured ? "pricing-invalid" : "pricing-missing", official };
}

export function cacheKey(content, version = ENRICH_VERSION) {
  return "enrich:" + version + ":" + sha256Hex(String(content || ""));
}

export function estimateCny(tokensIn = MAX_TOKENS_IN, tokensOut = MAX_TOKENS_OUT, pricing) {
  const p = pricing || { usdPerMtokIn: USD_PER_MTOK_IN, usdPerMtokOut: USD_PER_MTOK_OUT };
  if (p.pricingKnown === false) return null;
  const usd = (tokensIn / 1e6) * p.usdPerMtokIn + (tokensOut / 1e6) * p.usdPerMtokOut;
  return roundCny(usd * CNY_PER_USD);
}

export const RESERVE_CNY = estimateCny(MAX_TOKENS_IN, MAX_TOKENS_OUT);

export function reserveCny(pricing) {
  return estimateCny(MAX_TOKENS_IN, MAX_TOKENS_OUT, pricing || resolvePricing());
}

export function actualCny(usage, pricing) {
  const p = pricing || resolvePricing();
  if (usage && Number.isFinite(parseRate(usage.cost_cny))) return roundCny(Number(usage.cost_cny));
  if (usage && Number.isFinite(parseRate(usage.cost))) {
    return roundCny(Number(usage.cost) * CNY_PER_USD);
  }
  if (!usage) return reserveCny(p);
  const inn = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const out = Number(usage.completion_tokens || usage.output_tokens || 0);
  if (!inn && !out) return reserveCny(p);
  return estimateCny(inn, out, p);
}

export function emptyBudgetState(now = new Date()) {
  const day = beijingYmd(now);
  const month = day.slice(0, 7);
  return {
    month,
    day,
    monthSpent: 0,
    daySpent: 0,
    dayCandidates: 0,
    reserved: 0,
    calls: 0,
  };
}

function roll(state, now) {
  const day = beijingYmd(now);
  const month = day.slice(0, 7);
  const next = { ...emptyBudgetState(now), ...state };
  if (next.month !== month) {
    next.month = month;
    next.monthSpent = 0;
  }
  if (next.day !== day) {
    next.day = day;
    next.daySpent = 0;
    next.dayCandidates = 0;
  }
  return next;
}

export function createBudget(initial = {}, now = new Date(), opts = {}) {
  const pricing = opts.pricing || resolvePricing(opts);
  let state = roll(initial, now);
  let chain = Promise.resolve();
  const persist = opts.persist;
  function locked(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => {},
      () => {}
    );
    return run;
  }
  async function save() {
    if (persist) await persist(snapshot());
  }

  function snapshot() {
    const pricingKnown = pricing.pricingKnown !== false && pricing.hard !== false;
    const blockedReason = !pricingKnown ? pricing.blockedReason || "pricing-missing"
      : state.monthSpent >= MONTHLY_CNY ? "monthly-cap"
      : state.daySpent >= DAILY_CNY ? "daily-cap"
      : state.dayCandidates >= DAILY_CANDIDATE_CAP ? "candidate-cap" : null;
    return { ...state, hard: true, pricingKnown, blockedReason,
      usdPerMtokIn: pricingKnown ? pricing.usdPerMtokIn : null,
      usdPerMtokOut: pricingKnown ? pricing.usdPerMtokOut : null };
  }

  return {
    snapshot,
    async reserve(reserveOpts = {}) {
      return locked(async () => {
        const t = reserveOpts.now || now;
        state = roll(state, t);
        if (!snapshot().pricingKnown) {
          const err = new Error(snapshot().blockedReason);
          err.code = "BUDGET_PRICING";
          throw err;
        }
        const cost = Number.isFinite(reserveOpts.cny) ? reserveOpts.cny : reserveCny(pricing);
        if (!Number.isFinite(cost) || cost < 0) throw new Error("invalid reservation");
        if (state.dayCandidates >= DAILY_CANDIDATE_CAP) {
          const err = new Error("daily candidate cap");
          err.code = "BUDGET_CANDIDATES";
          throw err;
        }
        if (state.monthSpent + cost > MONTHLY_CNY) {
          const err = new Error("monthly budget");
          err.code = "BUDGET_MONTH";
          throw err;
        }
        if (state.daySpent + cost > DAILY_CNY) {
          const err = new Error("daily budget");
          err.code = "BUDGET_DAY";
          throw err;
        }
        state.monthSpent += cost;
        state.daySpent += cost;
        state.reserved += cost;
        state.dayCandidates += 1;
        state.calls += 1;
        await save();
        return { id: "r" + state.calls, cny: cost };
      });
    },
    async commit(reservation, actual) {
      return locked(async () => {
        const reserved = reservation?.cny || 0;
        const used = Number.isFinite(actual) ? Math.max(0, actual) : reserved;
        state.reserved = Math.max(0, state.reserved - reserved);
        state.monthSpent = Math.max(0, state.monthSpent - reserved + used);
        state.daySpent = Math.max(0, state.daySpent - reserved + used);
        await save();
        return { ...state };
      });
    },
    async keep(reservation) {
      return locked(async () => {
        const reserved = reservation?.cny || 0;
        state.reserved = Math.max(0, state.reserved - reserved);
        await save();
        return { ...state };
      });
    },
    async release(reservation) {
      return locked(async () => {
        const reserved = reservation?.cny || 0;
        state.reserved = Math.max(0, state.reserved - reserved);
        state.monthSpent = Math.max(0, state.monthSpent - reserved);
        state.daySpent = Math.max(0, state.daySpent - reserved);
        state.dayCandidates = Math.max(0, state.dayCandidates - 1);
        await save();
        return { ...state };
      });
    },
  };
}
