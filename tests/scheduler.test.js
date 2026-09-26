import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ensureDigestScheduled,
  ensureCollectScheduled,
  schedulerStatus,
  runScheduler,
  SCHEDULER,
} from "../src/scheduler.js";
import { createMemoryStore } from "../src/store/memory.js";
import { createD1Store } from "../src/store/d1.js";
import { createFakeD1 } from "./helpers/fake-d1.js";
import { withLock } from "../src/lock.js";

// 08:30 Beijing on 2026-09-26 — after the 08:05 digest gate.
const NOW = new Date("2026-09-26T00:30:00Z");

function recordingFetch(calls, { repoOk = true, defaultBranch = "main", dispatchStatus = 204, activeRuns = [] } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET" });
    if (String(url).endsWith("/repos/owner/repo")) {
      if (!repoOk) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ default_branch: defaultBranch }) };
    }
    if (String(url).includes("/runs?per_page=10")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ workflow_runs: activeRuns.map((status) => ({ status })) }),
      };
    }
    if (String(url).includes("/dispatches")) {
      return { ok: dispatchStatus === 204, status: dispatchStatus, json: async () => ({}) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const ENV = { GITHUB_DISPATCH_TOKEN: "t", GITHUB_REPO: "owner/repo" };

test("digest already published (explicit empty counts): no dispatch", async () => {
  const store = createMemoryStore();
  await store.putSnapshot("digest:2026-09-26", { date: "2026-09-26", items: [] });
  const calls = [];
  const res = await ensureDigestScheduled({ store, now: NOW, env: ENV, fetchImpl: recordingFetch(calls) });
  assert.equal(res.skipped, "published");
  assert.equal(calls.length, 0);
});

test("before 08:05 Beijing: digest is not dispatched", async () => {
  const store = createMemoryStore();
  const calls = [];
  const res = await ensureDigestScheduled({
    store,
    now: new Date("2026-09-25T23:00:00Z"), // 07:00 Beijing
    env: ENV,
    fetchImpl: recordingFetch(calls),
  });
  assert.equal(res.skipped, "before-slot");
  assert.equal(calls.length, 0);
});

test("missing digest dispatches on fixed main ref, records attempting first", async () => {
  const store = createMemoryStore();
  const calls = [];
  const res = await ensureDigestScheduled({ store, now: NOW, env: ENV, fetchImpl: recordingFetch(calls) });
  assert.equal(res.dispatched, true);
  assert.equal(res.slot.lastResult, "dispatched");
  assert.equal(res.slot.attempts, 1);
  const dispatch = calls.find((c) => c.method === "POST");
  assert.match(dispatch.url, /workflows\/digest\.yml\/dispatches$/);
  const slot = await store.getSnapshot("scheduler:digest:2026-09-26");
  assert.equal(slot.json.lastResult, "dispatched");
  assert.equal(slot.json.firstAt, slot.json.lastAt);
});

test("concurrent ensureDigestScheduled double-fire dispatches at most once (locked)", async () => {
  const store = createMemoryStore();
  const calls = [];
  // Reviewer's repro time 2026-09-26T16:15Z is Beijing 27th 00:15 — before
  // the 08:05 gate, so the correct answer there is zero dispatches.
  const early = await Promise.all([
    ensureDigestScheduled({ store, now: new Date("2026-09-26T16:15:00Z"), env: ENV, fetchImpl: recordingFetch(calls) }),
    ensureDigestScheduled({ store, now: new Date("2026-09-26T16:15:00Z"), env: ENV, fetchImpl: recordingFetch(calls) }),
  ]);
  assert.equal(early.every((r) => r.skipped === "before-slot"), true);
  assert.equal(calls.length, 0);
  // After the gate (Beijing 27th 09:00), a double fire still POSTs once.
  const now = new Date("2026-09-27T01:00:00Z");
  const results = await Promise.all([
    ensureDigestScheduled({ store, now, env: ENV, fetchImpl: recordingFetch(calls) }),
    ensureDigestScheduled({ store, now, env: ENV, fetchImpl: recordingFetch(calls) }),
  ]);
  const posts = calls.filter((c) => c.method === "POST" && c.url.includes("digest.yml"));
  assert.equal(posts.length, 1, "exactly one dispatch POST across concurrent fires");
  const dispatched = results.filter((r) => r.dispatched).length;
  assert.equal(dispatched, 1);
  const other = results.find((r) => !r.dispatched);
  assert.ok(["cooldown", "in-progress", "published", "lock"].includes(other.skipped));
});

test("cooldown prevents re-dispatch right after acceptance", async () => {
  const store = createMemoryStore();
  const calls = [];
  await ensureDigestScheduled({ store, now: NOW, env: ENV, fetchImpl: recordingFetch(calls) });
  const again = await ensureDigestScheduled({
    store,
    now: new Date(NOW.getTime() + 5 * 60 * 1000),
    env: ENV,
    fetchImpl: recordingFetch(calls),
  });
  assert.equal(again.skipped, "cooldown");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("active queued GitHub run suppresses dispatch", async () => {
  const store = createMemoryStore();
  const calls = [];
  const res = await ensureDigestScheduled({
    store,
    now: NOW,
    env: ENV,
    fetchImpl: recordingFetch(calls, { activeRuns: ["queued"] }),
  });
  assert.equal(res.skipped, "in-progress");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  const slot = await store.getSnapshot("scheduler:digest:2026-09-26");
  assert.equal(slot.json.lastResult, "in-progress");
  assert.equal(slot.json.attempts, 0); // observing an active run is not a dispatch attempt
});

test("bounded retries: digest cutoff after max attempts", async () => {
  const store = createMemoryStore();
  const calls = [];
  let t = NOW.getTime();
  for (let i = 0; i < 20; i++) {
    t += 30 * 60 * 1000;
    const d = new Date(t);
    // stay on the same Beijing date for attempt accounting
    await ensureDigestScheduled({ store, now: d, env: ENV, fetchImpl: recordingFetch(calls) }).catch(() => {});
  }
  const slot = await store.getSnapshot("scheduler:digest:" + new Date(t).toISOString().slice(0, 10));
  assert.equal(slot.json.attempts, SCHEDULER.digestMaxAttempts);
  assert.equal(calls.filter(c => c.method === "POST").length, SCHEDULER.digestMaxAttempts);
});

test("missing credentials are misconfigured and do not consume attempts", async () => {
  const store = createMemoryStore();
  const logged = [];
  for (let i = 0; i < 3; i++) {
    await ensureDigestScheduled({ store, now: NOW, env: {}, log: (m) => logged.push(m) });
  }
  const slot = await store.getSnapshot("scheduler:digest:2026-09-26");
  assert.equal(slot.json.lastResult, "no-token");
  assert.equal(slot.json.attempts, 0); // unconfigured ≠ exhausted
  const status = await schedulerStatus(store, { now: NOW, env: {} });
  assert.equal(status.github.configured, false);
  assert.equal(status.enabled, false);
});

test("ref mismatch aborts dispatch", async () => {
  const store = createMemoryStore();
  const calls = [];
  const res = await ensureDigestScheduled({
    store,
    now: NOW,
    env: ENV,
    fetchImpl: recordingFetch(calls, { defaultBranch: "release" }),
  });
  assert.equal(res.dispatched, false);
  assert.equal(res.slot.lastResult, "SCHEDULER_REF");
  assert.equal(calls.filter((c) => c.method === "POST").length, 0);
});

test("runScheduler is inert unless explicitly enabled", async () => {
  const store = createMemoryStore();
  const calls = [];
  const off = await runScheduler({ store, now: NOW, env: ENV, fetchImpl: recordingFetch(calls) });
  assert.equal(off.skipped, "disabled");
  assert.equal(calls.length, 0);
  const on = await runScheduler({
    store,
    now: NOW,
    env: { ...ENV, SCHEDULER_ENABLE: "1" },
    fetchImpl: recordingFetch(calls),
  });
  assert.equal(on.digest.dispatched, true);
});

const COLLECT_NOW = new Date("2026-09-26T08:35:00Z"); // past the 07:00 UTC slot + grace

test("collect slot fresh (payload snapshotAt after slot): no dispatch", async () => {
  const store = createMemoryStore();
  store.tables.snapshots.set("events", {
    json: { snapshotAt: "2026-09-26T07:10:00Z" },
    at: "2026-09-26T07:10:00Z",
  });
  const calls = [];
  const res = await ensureCollectScheduled({ store, now: COLLECT_NOW, env: ENV, fetchImpl: recordingFetch(calls) });
  assert.equal(res.skipped, "published");
  assert.equal(calls.length, 0);
});

test("collect slot stale: dispatches once per slot, judged by payload snapshotAt", async () => {
  const store = createMemoryStore();
  // Row write time is fresh but the payload snapshotAt predates the slot:
  // the payload timestamp is authoritative.
  store.tables.snapshots.set("events", {
    json: { snapshotAt: "2026-09-26T03:00:00Z" },
    at: "2026-09-26T08:20:00Z",
  });
  const calls = [];
  const res = await ensureCollectScheduled({ store, now: COLLECT_NOW, env: ENV, fetchImpl: recordingFetch(calls) });
  assert.equal(res.dispatched, true);
  assert.equal(res.slot, "2026-09-26T07");
  // Same slot again after cooldown, still unpublished and no active run:
  // bounded per-slot attempts, and cooldown stops a 20-minute pile-up.
  const again = await ensureCollectScheduled({
    store,
    now: new Date(COLLECT_NOW.getTime() + 5 * 60 * 1000),
    env: ENV,
    fetchImpl: recordingFetch(calls),
  });
  assert.equal(again.skipped, "cooldown");
});

test("before any slot+grace: collect not dispatched", async () => {
  const store = createMemoryStore();
  const calls = [];
  const res = await ensureCollectScheduled({
    store,
    now: new Date("2026-09-26T01:10:00Z"), // inside the 01:00 slot's grace window
    env: ENV,
    fetchImpl: recordingFetch(calls),
  });
  assert.equal(res.skipped, "before-slot");
  assert.equal(calls.length, 0);
});

test("withLock serializes on memory store with owner tokens", async () => {
  const store = createMemoryStore();
  const seen = [];
  const op = (tag) => withLock(store, "job", async () => {
    seen.push(tag + ":in");
    await new Promise((r) => setTimeout(r, 10));
    seen.push(tag + ":out");
  });
  const first = op("a");
  const second = op("b").then(() => "ran").catch((e) => e.code);
  await first;
  assert.equal(await second, "LOCK");
  await op("c");
  assert.deepEqual(seen, ["a:in", "a:out", "c:in", "c:out"]);
});

test("memory lock tolerates legacy string rows; wrong owner cannot release", async () => {
  const store = createMemoryStore();
  store.tables.locks.set("legacy", "2099-01-01T00:00:00Z"); // legacy string
  assert.equal(await store.acquireLock("legacy", new Date(Date.now() + 60000).toISOString(), "t1"), false);
  store.tables.locks.set("legacy", "2020-01-01T00:00:00Z"); // expired legacy
  assert.equal(await store.acquireLock("legacy", new Date(Date.now() + 60000).toISOString(), "t2"), true);
  await store.releaseLock("legacy", "t1"); // stale owner
  assert.equal(await store.acquireLock("legacy", new Date(Date.now() + 60000).toISOString(), "t3"), false);
  await store.releaseLock("legacy", "t2");
  assert.equal(await store.acquireLock("legacy", new Date(Date.now() + 60000).toISOString(), "t4"), true);
});

test("d1 lock: concurrent acquires yield exactly one winner", async () => {
  const store = createD1Store(createFakeD1());
  const until = new Date(Date.now() + 60000).toISOString();
  const results = await Promise.all(
    ["a", "b", "c", "d", "e"].map((t) => store.acquireLock("collect", until, t))
  );
  assert.equal(results.filter(Boolean).length, 1);
  const winner = ["a", "b", "c", "d", "e"][results.findIndex(Boolean)];
  for (const t of ["a", "b", "c", "d", "e"].filter((x) => x !== winner)) {
    await store.releaseLock("collect", t);
  }
  assert.equal(await store.acquireLock("collect", until, "x"), false);
  await store.releaseLock("collect", winner);
  assert.equal(await store.acquireLock("collect", until, "y"), true);
});

test("d1 lock: expired row is retaken by upsert guard", async () => {
  const store = createD1Store(createFakeD1());
  assert.equal(await store.acquireLock("digest", new Date(Date.now() - 5000).toISOString(), "old"), true);
  assert.equal(await store.acquireLock("digest", new Date(Date.now() + 60000).toISOString(), "new"), true);
});
