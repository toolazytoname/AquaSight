import { test } from "node:test";
import assert from "node:assert/strict";
import { instantAllowed, notifyInstant, notifySourceOutage } from "../src/notify.js";
import { beijingParts } from "../src/time.js";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("instant is off by default for shadow period", () => {
  const g = instantAllowed({ instantNotifyEnabled: false }, [], new Date("2026-09-07T02:00:00Z"));
  assert.equal(g.ok, false);
  assert.equal(g.reason, "shadow-disabled");
});

test("silent hours 23:00-08:00 Beijing", () => {
  const prefs = { instantNotifyEnabled: true, silentStart: "23:00", silentEnd: "08:00" };
  const night = new Date("2026-09-06T16:00:00Z");
  assert.equal(beijingParts(night).hour, 0);
  assert.equal(instantAllowed(prefs, [], night).ok, false);
  const day = new Date("2026-09-07T02:00:00Z");
  assert.equal(beijingParts(day).hour, 10);
  assert.equal(instantAllowed(prefs, [], day).ok, true);
});

test("daily cap survives restart via sent ids", async () => {
  const prefs = { instantNotifyEnabled: true, instantMaxPerDay: 3, silentStart: "23:00", silentEnd: "08:00" };
  const now = new Date("2026-09-07T02:00:00Z");
  const day = beijingParts(now).ymd;
  const sent = ["day:" + day + ":a", "day:" + day + ":b", "day:" + day + ":c"];
  const g = instantAllowed(prefs, sent, now);
  assert.equal(g.ok, false);
  const r = await notifyInstant(
    [{ id: "n", title: "x", level: "breaking", category: "tech" }],
    { prefs, sentIds: sent, now, key: "k", fetchImpl: async () => ({ ok: true }) }
  );
  assert.equal(r.attempted, 0);
});

test("source outage alert fires once per Beijing day", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aq-outage-"));
  const marker = join(dir, "source-outage.json");
  const errors = ["qbitai", "v2ex", "wallstreetcn", "techcrunch", "bbc"].map((source) => ({
    source,
    error: "fetch failed",
  }));
  const now = new Date("2026-09-07T02:00:00Z");
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true };
  };
  const few = await notifySourceOutage(errors.slice(0, 4), {
    key: "k",
    markerPath: marker,
    now,
    fetchImpl,
  });
  assert.equal(few.sent, false);
  assert.equal(few.reason, "below-min");
  const first = await notifySourceOutage(errors, { key: "k", markerPath: marker, now, fetchImpl });
  assert.equal(first.sent, true);
  const markerData = JSON.parse(await readFile(marker, "utf8"));
  assert.equal(markerData.date, "2026-09-07");
  const again = await notifySourceOutage(errors, { key: "k", markerPath: marker, now, fetchImpl });
  assert.equal(again.sent, false);
  assert.equal(again.reason, "deduped");
  assert.equal(calls, 1);
  const nextDay = await notifySourceOutage(errors, {
    key: "k",
    markerPath: marker,
    now: new Date("2026-09-08T02:00:00Z"),
    fetchImpl,
  });
  assert.equal(nextDay.sent, true);
  assert.equal(calls, 2);
});
