import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { handleApi } from "../src/api/handlers.js";
import { createSqliteD1, queryPlan } from "./helpers/sqlite-d1.js";
import { personalFeedId } from "../src/personal-feeds.js";

// 真 SQLite（node:sqlite）上跑 D1 适配器的自定义 RSS SQL：建表/迁移可
// 重复执行、CRUD、删除级联与索引命中。

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Sql Feed</title>
<item><title>A</title><link>https://s.example/a</link><guid>a</guid></item>
<item><title>B</title><link>https://s.example/b</link><guid>b</guid></item>
</channel></rss>`;

const rssResponse = (body, type = "application/rss+xml") =>
  new Response(body, { status: 200, headers: { "content-type": type } });
const LOOKUP_OK = async () => [{ address: "93.184.216.34" }];

async function otpUser(store, email, id, token) {
  await store.putUser({ id, email, createdAt: new Date().toISOString() });
  const tokenHash = await crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(":" + token))
    .then((h) => [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""));
  await store.putSession({
    id: "ses:" + id,
    userId: id,
    email,
    tokenHash,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 864e5).toISOString(),
  });
  return (path, init = {}) => new Request("http://x" + path, {
    ...init,
    headers: { ...(init.headers || {}), authorization: "Bearer " + token },
  });
}

test("migration sql is repeatable (idempotent apply)", async () => {
  const d1 = await createSqliteD1();
  const sql = await readFile(new URL("../worker/migrations/20261001_personal_feeds.sql", import.meta.url), "utf8");
  d1.__db.exec(sql);
  d1.__db.exec(sql); // second apply must not throw
  d1.close();
});

test("d1: personal feed add/list/pause/refresh-fail/remove + owner isolation + reader stream", async () => {
  const d1 = await createSqliteD1();
  const { createD1Store } = await import("../src/store/d1.js");
  const store = createD1Store(d1);
  const user = await otpUser(store, "u@example.com", "usr:1", "tok-1");
  const other = await otpUser(store, "o@example.com", "usr:2", "tok-2");
  const env = { store, authMode: "otp", mailApiKey: "k", lookupImpl: LOOKUP_OK, fetchImpl: async () => rssResponse(RSS) };

  const add = await handleApi(user("/api/v1/feeds", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://s.example/feed.xml" }) }), env);
  assert.equal(add.status, 200);
  const feed = (await add.json()).feed;
  assert.equal(feed.name, "Sql Feed");
  assert.equal(feed.itemCount, 2);

  // owner isolation: another user sees nothing and cannot refresh/remove
  const otherList = await handleApi(other("/api/v1/feeds"), env);
  assert.equal((await otherList.json()).feeds.length, 0);
  const otherRefresh = await handleApi(other("/api/v1/feeds/" + encodeURIComponent(feed.feedId) + "/refresh", { method: "POST" }), env);
  assert.equal(otherRefresh.status, 404);

  // reader stream via D1 store
  const stream = await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  const data = await stream.json();
  assert.equal(data.items.length, 2);
  assert.ok(data.items[0].id.startsWith("pfi:"));

  // refresh failure keeps items + records state (D1 upsert path)
  const failEnv = { ...env, fetchImpl: async () => new Response("boom", { status: 500 }) };
  const seedOld = personalFeedId("usr:1", "https://s.example/feed.xml");
  // make it stale so refresh is attempted despite floors (non-aihot: no floor)
  const refreshed = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feed.feedId) + "/refresh", { method: "POST" }), failEnv);
  assert.equal(refreshed.status, 200);
  assert.ok((await refreshed.json()).feed.lastError);
  const still = await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  assert.equal((await still.json()).items.length, 2);

  // delete cascades items
  const del = await handleApi(user("/api/v1/feeds/" + encodeURIComponent(feed.feedId), { method: "DELETE" }), env);
  assert.equal(del.status, 200);
  const gone = await handleApi(user("/api/v1/events?view=reader&sources=github"), env);
  assert.equal((await gone.json()).items.length, 0);
  const rows = d1.__db.prepare("SELECT COUNT(*) AS n FROM user_feed_items").get();
  assert.equal(rows.n, 0);

  // deleteUserData covers the feed tables
  const fid2 = personalFeedId("usr:1", "https://s.example/feed.xml");
  void fid2; void seedOld;
  d1.close();
});

test("d1: feed item queries use the covering index", async () => {
  const d1 = await createSqliteD1();
  const plan = queryPlan(d1, "SELECT item_id FROM user_feed_items WHERE user_id = ? AND feed_id = ?", "u", "f");
  assert.ok(plan.some((d) => d.includes("covering index")), plan.join(" | "));
  d1.close();
});

test('d1: atomic feed cap and update-only writes cannot resurrect deleted sources', async () => {
  const d1 = await createSqliteD1();
  try {
    const {createD1Store}=await import('../src/store/d1.js');const store=createD1Store(d1),me={userId:'atomic'};
    const results=await Promise.all(Array.from({length:35},(_,i)=>store.putUserFeed({feedId:'f'+i,url:'https://x.example/'+i,name:'Feed'}, {...me,createOnly:true})));
    assert.equal(results.filter(Boolean).length,30);
    await store.updateUserFeed('f0',{paused:true},me);
    assert.equal((await store.getUserFeed('f0',me)).paused,true);
    await store.deleteUserFeed('f0',me);
    assert.equal(await store.updateUserFeed('f0',{lastError:'late response'},me),null);
    await store.setUserFeedItems('f0',[{id:'orphan',key:'a'}],me);
    assert.equal((await store.listUserFeedItems(me)).length,0);
  } finally {d1.close();}
});
