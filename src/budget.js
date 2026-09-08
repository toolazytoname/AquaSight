import { beijingYmd } from "./time.js";
import { sha256Hex } from "./hash.js";

export const MONTHLY_CNY = 100;
export const DAILY_CNY = 3.3;
export const DAILY_CANDIDATE_CAP = 100;
export const ENRICH_VERSION = "v1";
export const CNY_PER_USD = 7.2;
export const USD_PER_MTOK_IN = 3;
export const USD_PER_MTOK_OUT = 15;
export const MAX_TOKENS_IN = 2000;
export const MAX_TOKENS_OUT = 600;
export const RESERVE_CNY = estimateCny(MAX_TOKENS_IN, MAX_TOKENS_OUT);

export function cacheKey(content, version = ENRICH_VERSION) {
  return "enrich:" + version + ":" + sha256Hex(String(content || ""));
}

export function estimateCny(tokensIn = MAX_TOKENS_IN, tokensOut = MAX_TOKENS_OUT) {
  const usd =
    (tokensIn / 1e6) * USD_PER_MTOK_IN + (tokensOut / 1e6) * USD_PER_MTOK_OUT;
  return Math.round(usd * CNY_PER_USD * 10000) / 10000;
}

export function actualCny(usage) {
  if (!usage) return RESERVE_CNY;
  const inn = Number(usage.prompt_tokens || usage.input_tokens || 0);
  const out = Number(usage.completion_tokens || usage.output_tokens || 0);
  if (!inn && !out) return RESERVE_CNY;
  return estimateCny(inn, out);
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
    if (persist) await persist({ ...state });
  }

  return {
    snapshot() {
      return { ...state };
    },
    async reserve(reserveOpts = {}) {
      return locked(async () => {
        const t = reserveOpts.now || now;
        state = roll(state, t);
        const cost = Number.isFinite(reserveOpts.cny) ? reserveOpts.cny : RESERVE_CNY;
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
