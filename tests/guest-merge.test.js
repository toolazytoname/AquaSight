import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMergeBody } from "../web/guest-merge.js";
import { createMemoryStore } from "../src/store/memory.js";
import { handleApi } from "../src/api/handlers.js";
import { requestCode, verifyCode } from "../src/auth.js";

test("guest merge payload prefers tombstones over snapshots", () => {
  const body = buildMergeBody({
    reads: { "evt:a": "t" },
    prefs: { blockedSources: ["weibo"] },
    items: [
      { id: "evt:keep", titleZh: "留着" },
      { id: "evt:drop", titleZh: "不该复活" },
    ],
    deletedIds: ["evt:drop"],
  });
  assert.deepEqual(body.reads, { "evt:a": "t" });
  assert.deepEqual(body.prefs.blockedSources, ["weibo"]);
  const drop = body.favorites.find((f) => f.id === "evt:drop");
  const keep = body.favorites.find((f) => f.id === "evt:keep");
  assert.equal(drop.deleted, true);
  assert.equal(drop.snapshot, undefined);
  assert.equal(keep.deleted, undefined);
  assert.equal(keep.snapshot.titleZh, "留着");
});

test("merge body tombstone still does not resurrect after login", async () => {
  const store = createMemoryStore();
  const sent = await requestCode(store, { email: "merge@example.com", ip: "8.8.8.8" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const v = await verifyCode(store, { email: "merge@example.com", code: sent.debugCode });
  const env = { store, requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp" };
  const headers = { authorization: "Bearer " + v.token, "content-type": "application/json" };
  await handleApi(
    new Request("http://127.0.0.1/api/v1/sync/merge", {
      method: "POST",
      headers,
      body: JSON.stringify(buildMergeBody({ items: [{ id: "evt:x", title: "X" }] })),
    }),
    env
  );
  await handleApi(
    new Request("http://127.0.0.1/api/v1/favorites/evt:x", { method: "DELETE", headers }),
    env
  );
  const resurrect = await handleApi(
    new Request("http://127.0.0.1/api/v1/sync/merge", {
      method: "POST",
      headers,
      body: JSON.stringify(buildMergeBody({ items: [{ id: "evt:x", title: "X again" }], deletedIds: ["evt:x"] })),
    }),
    env
  );
  assert.equal(resurrect.status, 200);
  const list = await handleApi(new Request("http://127.0.0.1/api/v1/favorites", { headers }), env);
  const items = (await list.json()).items.map((it) => it.id || it.eventId);
  assert.equal(items.includes("evt:x"), false);
});
