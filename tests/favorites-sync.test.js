import { test } from "node:test";
import assert from "node:assert/strict";
import { createFavorites } from "../web/favorites.js";

const article = { id: "evt:a", titleZh: "值得收藏的新闻", summary: "已保存材料" };
function harness(seed = {}, request = async () => {}) {
  let disk = structuredClone(seed);
  const options = { read: () => disk, write: (v) => { disk = structuredClone(v); }, request };
  return { make: () => createFavorites(options), disk: () => disk };
}

test("failed removal survives restart and ignores the old server favorite until retry succeeds", async () => {
  let fail = true;
  const calls = [];
  const h = harness({}, async (id, kind) => { calls.push(kind); if (fail) throw Error("500"); });
  let favorites = h.make();
  favorites.mergeRemote([article]);
  favorites.setRemoteAvailable(true);
  favorites.set(article.id, null);
  await favorites.sync();
  assert.equal(favorites.has(article.id), false);
  assert.equal(h.disk().pending[article.id].kind, "remove");
  favorites = h.make();
  favorites.mergeRemote([article]);
  assert.equal(favorites.has(article.id), false);
  favorites.setRemoteAvailable(true);
  fail = false;
  await favorites.sync();
  assert.equal(favorites.pendingCount(), 0);
  assert.deepEqual(calls, ["remove", "remove"]);
});

test("a newer save wins while an older removal is in flight", async () => {
  let finish;
  const kinds = [];
  const h = harness({}, async (_id, kind) => {
    kinds.push(kind);
    if (kinds.length === 1) await new Promise((r) => { finish = r; });
  });
  const favorites = h.make();
  favorites.mergeRemote([article]);
  favorites.setRemoteAvailable(true);
  favorites.set(article.id, null);
  const pending = favorites.sync();
  favorites.set(article.id, article);
  const again = favorites.sync();
  finish();
  await Promise.all([pending, again]);
  assert.deepEqual(kinds, ["remove", "save"]);
  assert.equal(favorites.has(article.id), true);
  assert.equal(favorites.pendingCount(), 0);
  assert.equal(h.disk().synced[article.id], true);
});

test("static favorites remain local and old data migrates without losing snapshots", async () => {
  let calls = 0;
  const h = harness({ ids: [article.id], items: { [article.id]: article } }, async () => { calls++; });
  const favorites = h.make();
  assert.equal(favorites.has(article.id), true);
  favorites.set("evt:b", { id: "evt:b", title: "第二条" });
  await favorites.sync();
  assert.equal(calls, 0);
  favorites.setRemoteAvailable(true);
  favorites.mergeRemote([]);
  await favorites.sync();
  assert.equal(calls, 2);
  assert.equal(favorites.pendingCount(), 0);
});

test("late GET cannot reintroduce a removed item, and acknowledged remote deletion is respected", async () => {
  const h = harness();
  const favorites = h.make();
  favorites.mergeRemote([article]);
  const before = favorites.revision();
  favorites.set(article.id, null);
  favorites.setRemoteAvailable(true);
  await favorites.sync();
  assert.equal(favorites.mergeRemote([article], before), false);
  assert.equal(favorites.has(article.id), false);
  favorites.mergeRemote([article]);
  favorites.mergeRemote([]);
  assert.equal(favorites.has(article.id), false);
});

test("storage failures do not claim a durable save or discard previous favorites", () => {
  const favorites = createFavorites({
    read: () => ({ items: { [article.id]: article } }),
    write: () => { throw Error("quota"); }, request: async () => {},
  });
  assert.throws(() => favorites.set(article.id, null), /quota/);
  assert.equal(favorites.has(article.id), true);
});
