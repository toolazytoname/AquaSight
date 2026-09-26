/**
 * Worker-cron reliability scheduler. GitHub Actions `schedule` is a trigger
 * hint, not a delivery guarantee (2026-09-26: the 08:05 Beijing digest only
 * started 12:27). Runs from the Worker's own cron trigger and re-dispatches
 * the EXISTING workflows when persisted state proves an output is missing.
 * Never fabricates credentials: a missing token is a reported
 * misconfiguration, never fake health, and it does not consume attempts.
 *
 * Safety properties:
 * - The whole read-slot / check / dispatch / write-slot sequence runs inside
 *   an owner-token lock, so concurrent cron fires cannot double-dispatch.
 * - "attempting" is persisted BEFORE the dispatch POST, so a process death
 *   mid-dispatch leaves a counted, observable state instead of a silent gap.
 * - Existing queued/in_progress GitHub runs are checked before dispatching.
 * - Dispatch acceptance (204) is NOT publication; the next tick re-checks
 *   the persisted output. The legacy GitHub schedule stays as a fallback:
 *   the digest run itself refuses to re-send (digest-sent:<date>), so no
 *   double notification.
 * - Digest dispatch is gated to Beijing >= 08:05. Collect follows the original
 *   UTC 1/7/13/19 slots, judged by the events payload's snapshotAt (not the
 *   row write time), one bounded retry set per slot — no stacked 24-minute
 *   collect runs every 20 minutes.
 */

import { beijingParts, beijingYmd } from "./time.js";
import { withLock } from "./lock.js";

export const SCHEDULER = {
  digestWorkflow: "digest.yml",
  collectWorkflow: "collect.yml",
  ref: "main", // fixed: the audited ref
  digestNotBeforeBeijingMin: 8 * 60 + 5, // 08:05 Beijing
  collectSlotUtcHours: [1, 7, 13, 19],
  collectGraceMs: 30 * 60 * 1000, // late-start tolerance after a slot
  digestMaxAttempts: 16,
  collectMaxAttemptsPerSlot: 3,
  dispatchCooldownMs: 20 * 60 * 1000,
  attemptingTimeoutMs: 10 * 60 * 1000,
  lockTtlMs: 60 * 1000,
};

function githubConfig(env = {}) {
  const token = String(env.GITHUB_DISPATCH_TOKEN || "").trim();
  const repo = String(env.GITHUB_REPO || "").trim();
  const api = String(env.GITHUB_API || "https://api.github.com").replace(/\/+$/, "");
  return { token, repo, api, configured: Boolean(token && repo) };
}

function ghHeaders(cfg, extra = {}) {
  return {
    Authorization: "Bearer " + cfg.token,
    Accept: "application/vnd.github+json",
    "User-Agent": "aquasight-scheduler",
    ...extra,
  };
}

async function getSlot(store, key) {
  const snap = await store.getSnapshot(key);
  return (snap && snap.json) || { key, attempts: 0, firstAt: null, lastAt: null, lastResult: null };
}

async function putSlot(store, slot) {
  await store.putSnapshot(slot.key, slot);
  return slot;
}

function bump(slot, nowIso, result) {
  return {
    ...slot,
    attempts: (slot.attempts || 0) + 1,
    firstAt: slot.firstAt || nowIso,
    lastAt: nowIso,
    lastResult: result,
  };
}

async function verifyRepoRef(cfg, fetchImpl) {
  const res = await fetchImpl(cfg.api + "/repos/" + cfg.repo, {
    headers: ghHeaders(cfg),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = new Error("repo check http-" + res.status);
    err.code = "SCHEDULER_REPO";
    throw err;
  }
  const data = await res.json();
  if (!data || data.default_branch !== SCHEDULER.ref) {
    const err = new Error("ref mismatch: default " + (data && data.default_branch) + " != " + SCHEDULER.ref);
    err.code = "SCHEDULER_REF";
    throw err;
  }
  return true;
}

async function hasActiveRun(cfg, workflow, fetchImpl) {
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
    const res = await fetchImpl(
      cfg.api + "/repos/" + cfg.repo + "/actions/workflows/" + workflow + "/runs?per_page=10&branch=main&status=" + status,
      { headers: ghHeaders(cfg), signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) {
      const err = new Error("runs check http-" + res.status);
      err.code = "SCHEDULER_RUNS";
      throw err;
    }
    const data = await res.json();
    if (!Array.isArray(data.workflow_runs)) throw new Error("invalid workflow runs response");
    if (data.workflow_runs.some(r => r && ["queued", "in_progress", "waiting", "pending", "requested"].includes(r.status))) return true;
  }
  return false;
}

async function dispatchWorkflow(cfg, workflow, fetchImpl) {
  const res = await fetchImpl(
    cfg.api + "/repos/" + cfg.repo + "/actions/workflows/" + workflow + "/dispatches",
    {
      method: "POST",
      headers: ghHeaders(cfg, { "Content-Type": "application/json" }),
      body: JSON.stringify({ ref: SCHEDULER.ref }),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (res.status !== 204) {
    const err = new Error("dispatch http-" + res.status);
    err.code = "SCHEDULER_DISPATCH";
    throw err;
  }
  return true;
}

/**
 * Published means: today's digest snapshot exists with a matching date and
 * an explicit items array — an intentionally EMPTY digest is complete, not
 * missing, and must not be retried in a loop.
 */
async function digestPublished(store, date) {
  const snap = await store.getSnapshot("digest:" + date);
  const j = snap && snap.json;
  return Boolean(j && !j.missing && j.date === date && Array.isArray(j.items));
}

async function eventsSnapshotAt(store) {
  const snap = await store.getSnapshot("events");
  const t = Date.parse(snap?.json?.snapshotAt || "");
  return Number.isFinite(t) ? t : 0;
}

async function ensureDigest(opts) {
  opts = { ...opts, fetchImpl: opts.fetchImpl || fetch };
  const store = opts.store;
  const now = opts.now || new Date();
  const date = beijingYmd(now);
  const key = "scheduler:digest:" + date;
  const p = beijingParts(now);
  const beijingMin = p.hour * 60 + p.minute;
  if (beijingMin < SCHEDULER.digestNotBeforeBeijingMin) {
    return { kind: "digest", date, skipped: "before-slot" };
  }
  try {
    return await withLock(
      store,
      "scheduler-digest",
      async () => {
      if (await digestPublished(store, date)) {
        const prev = await getSlot(store, key);
        if (!prev.publishedAt) {
          await putSlot(store, { ...prev, publishedAt: now.toISOString(), lastResult: "published" });
        }
        return { kind: "digest", date, skipped: "published" };
      }
      let slot = await getSlot(store, key);
      if ((slot.attempts || 0) >= SCHEDULER.digestMaxAttempts) {
        return { kind: "digest", date, skipped: "cutoff" };
      }
      if (
        slot.lastAt &&
        now.getTime() - Date.parse(slot.lastAt) < SCHEDULER.dispatchCooldownMs
      ) {
        return { kind: "digest", date, skipped: "cooldown" };
      }
      const cfg = githubConfig(opts.env);
      if (!cfg.configured) {
        // Missing credentials must never look healthy — and must not burn
        // the day's attempt budget while unconfigured.
        if (opts.log) opts.log("scheduler misconfigured: GITHUB_DISPATCH_TOKEN / GITHUB_REPO missing");
        await putSlot(store, {
          ...slot,
          firstAt: slot.firstAt || now.toISOString(),
          lastAt: now.toISOString(),
          lastResult: "no-token",
        });
        return { kind: "digest", date, skipped: "misconfigured", slot };
      }
      // Persist "attempting" BEFORE dispatching: a process death here leaves
      // a counted, observable state rather than a silent re-dispatch risk.
      try {
        await verifyRepoRef(cfg, opts.fetchImpl);
        if (await hasActiveRun(cfg, SCHEDULER.digestWorkflow, opts.fetchImpl)) {
          await putSlot(store, { ...slot, checkedAt: now.toISOString(), lastResult: "in-progress" });
          return { kind: "digest", date, skipped: "in-progress", slot };
        }
        slot = bump(slot, now.toISOString(), "attempting");
        await putSlot(store, slot);
        await dispatchWorkflow(cfg, SCHEDULER.digestWorkflow, opts.fetchImpl);
      } catch (e) {
        const done = { ...slot, lastAt: now.toISOString(), lastResult: (e && e.code) || "error" };
        await putSlot(store, done);
        if (opts.log) opts.log("scheduler digest dispatch failed: " + (e && e.message));
        return { kind: "digest", date, dispatched: false, error: e && e.message, slot: done };
      }
      const done = { ...slot, lastResult: "dispatched" };
      await putSlot(store, done);
        return { kind: "digest", date, dispatched: true, slot: done };
      },
      { ttlMs: SCHEDULER.lockTtlMs }
    );
  } catch (e) {
    if (e && e.code === "LOCK") return { kind: "digest", date, skipped: "lock" };
    throw e;
  }
}

function collectSlotFor(now) {
  // The most recent UTC 1/7/13/19 slot whose grace window has opened.
  const t = now.getTime();
  const hour = now.getUTCHours();
  let best = null;
  for (const h of SCHEDULER.collectSlotUtcHours) {
    if (hour < h) continue;
    const slotTime = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      h,
      0,
      0
    );
    if (t - slotTime >= SCHEDULER.collectGraceMs && (!best || slotTime > best.time)) {
      best = { time: slotTime, hour: h };
    }
  }
  return best;
}

async function ensureCollect(opts) {
  opts = { ...opts, fetchImpl: opts.fetchImpl || fetch };
  const store = opts.store;
  const now = opts.now || new Date();
  const slot = collectSlotFor(now);
  if (!slot) return { kind: "collect", skipped: "before-slot" };
  const slotId = new Date(slot.time).toISOString().slice(0, 13); // YYYY-MM-DDTHH
  const key = "scheduler:collect:" + slotId;
  try {
    return await withLock(
      store,
      "scheduler-collect",
      async () => {
      // Judge by the payload's snapshotAt, not the row write time.
      if ((await eventsSnapshotAt(store)) >= slot.time) {
        const prev = await getSlot(store, key);
        if (!prev.publishedAt) {
          await putSlot(store, { ...prev, publishedAt: now.toISOString(), lastResult: "published" });
        }
        return { kind: "collect", slot: slotId, skipped: "published" };
      }
      let state = await getSlot(store, key);
      if ((state.attempts || 0) >= SCHEDULER.collectMaxAttemptsPerSlot) {
        return { kind: "collect", slot: slotId, skipped: "cutoff" };
      }
      if (state.lastAt && now.getTime() - Date.parse(state.lastAt) < SCHEDULER.dispatchCooldownMs) {
        return { kind: "collect", slot: slotId, skipped: "cooldown" };
      }
      const cfg = githubConfig(opts.env);
      if (!cfg.configured) {
        if (opts.log) opts.log("scheduler misconfigured: GITHUB_DISPATCH_TOKEN / GITHUB_REPO missing");
        await putSlot(store, {
          ...state,
          firstAt: state.firstAt || now.toISOString(),
          lastAt: now.toISOString(),
          lastResult: "no-token",
        });
        return { kind: "collect", slot: slotId, skipped: "misconfigured" };
      }
      try {
        await verifyRepoRef(cfg, opts.fetchImpl);
        if (await hasActiveRun(cfg, SCHEDULER.collectWorkflow, opts.fetchImpl)) {
          await putSlot(store, { ...state, checkedAt: now.toISOString(), lastResult: "in-progress" });
          return { kind: "collect", slot: slotId, skipped: "in-progress" };
        }
        state = bump(state, now.toISOString(), "attempting");
        await putSlot(store, state);
        await dispatchWorkflow(cfg, SCHEDULER.collectWorkflow, opts.fetchImpl);
      } catch (e) {
        const done = { ...state, lastAt: now.toISOString(), lastResult: (e && e.code) || "error" };
        await putSlot(store, done);
        if (opts.log) opts.log("scheduler collect dispatch failed: " + (e && e.message));
        return { kind: "collect", slot: slotId, dispatched: false, error: e && e.message };
      }
      const done = { ...state, lastResult: "dispatched" };
      await putSlot(store, done);
        return { kind: "collect", slot: slotId, dispatched: true };
      },
      { ttlMs: SCHEDULER.lockTtlMs }
    );
  } catch (e) {
    if (e && e.code === "LOCK") return { kind: "collect", slot: slotId, skipped: "lock" };
    throw e;
  }
}

export async function runScheduler(opts = {}) {
  // Explicit enable only: an unconfigured Worker must be inert.
  if (String((opts.env || {}).SCHEDULER_ENABLE || "") !== "1") {
    return { skipped: "disabled" };
  }
  const digest = await ensureDigest(opts);
  const collect = await ensureCollect(opts);
  return { digest, collect };
}

export async function schedulerStatus(store, opts = {}) {
  const now = opts.now || new Date();
  const dates = [beijingYmd(now), beijingYmd(new Date(now.getTime() - 86400000))];
  const slots = {};
  for (const kind of ["digest", "collect"]) {
    slots[kind] = [];
    const keys = kind === "digest" ? dates : [now, new Date(now.getTime() - 86400000)].flatMap(d =>
      SCHEDULER.collectSlotUtcHours.map(h => d.toISOString().slice(0, 10) + "T" + String(h).padStart(2, "0")));
    for (const d of keys) {
      const snap = await store.getSnapshot("scheduler:" + kind + ":" + d);
      if (snap && snap.json) slots[kind].push(snap.json);
    }
  }
  const cfg = githubConfig(opts.env || {});
  return {
    date: dates[0],
    now: now.toISOString(),
    enabled: String((opts.env || {}).SCHEDULER_ENABLE || "") === "1",
    github: { configured: cfg.configured, repo: cfg.repo || null, ref: SCHEDULER.ref },
    limits: {
      digestMaxAttempts: SCHEDULER.digestMaxAttempts,
      collectMaxAttemptsPerSlot: SCHEDULER.collectMaxAttemptsPerSlot,
      dispatchCooldownMin: Math.round(SCHEDULER.dispatchCooldownMs / 60000),
      collectSlotsUtc: SCHEDULER.collectSlotUtcHours,
    },
    digestPublishedToday: await digestPublished(store, dates[0]),
    slots,
  };
}

export { ensureDigest as ensureDigestScheduled, ensureCollect as ensureCollectScheduled };
