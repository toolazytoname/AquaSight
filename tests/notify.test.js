import { test } from "node:test";
import assert from "node:assert/strict";
import { instantAllowed, notifyInstant } from "../src/notify.js";
import { beijingParts } from "../src/time.js";

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
