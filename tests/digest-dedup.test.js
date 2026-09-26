import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigestHistory,
  loadDigestHistory,
  matchHistory,
  planDedup,
  prevDigestDates,
} from "../src/digest-history.js";
import { createMemoryStore } from "../src/store/memory.js";
import { digestOnce } from "../src/pipeline.js";

const NOW = new Date("2026-09-26T01:00:00Z"); // 09:00 Beijing

function prevItem(id, over = {}) {
  return {
    id,
    title: "story " + id,
    titleZh: "报道 " + id,
    url: "https://example.com/" + id,
    source: "hn",
    category: "tech",
    value: 0.9,
    subject: id,
    publishedAt: "2026-09-24T12:00:00Z",
    memberIds: ["art:" + id],
    ...over,
  };
}

test("prevDigestDates lists strictly earlier days", () => {
  assert.deepEqual(prevDigestDates("2026-09-26", 3), ["2026-09-25", "2026-09-24", "2026-09-23"]);
  assert.deepEqual(prevDigestDates("bad"), []);
});

test("history matches by id, member overlap, and canonical url", () => {
  const history = buildDigestHistory([
    { date: "2026-09-25", items: [prevItem("evt:a", { memberIds: ["art:a1", "art:a2"] })] },
  ]);
  // same id
  assert.equal(matchHistory({ id: "evt:a", url: "https://other.example/x" }, history).item.id, "evt:a");
  // member article overlap
  assert.equal(matchHistory({ id: "evt:zz", memberIds: ["art:a2"] }, history).item.id, "evt:a");
  // canonical url overlap (tracking params + www + hash ignored)
  assert.equal(
    matchHistory(
      { id: "evt:zz", url: "https://www.example.com/evt:a?utm_source=rss#top" },
      history
    ).item.id,
    "evt:a"
  );
  // unrelated stays unmatched
  assert.equal(matchHistory({ id: "evt:qq", url: "https://qq.example/1" }, history), null);
});

test("planDedup strictly excludes every match, no update bypass", () => {
  const history = buildDigestHistory([{ date: "2026-09-25", items: [prevItem("evt:a")] }]);
  // A syndicated copy: new member joined, newer timestamp — still excluded.
  const items = [
    prevItem("evt:a", {
      memberIds: ["art:a", "art:new-copy"],
      publishedAt: "2026-09-25T20:00:00Z",
    }),
    prevItem("evt:b"),
  ];
  const { exclude, stats } = planDedup(items, history);
  assert.ok(exclude.has("evt:a"));
  assert.ok(!exclude.has("evt:b"));
  assert.equal(stats.duplicates, 1);
  assert.equal(stats.candidates, 2);
});

test("digestOnce does not republish yesterday's stories and never pads with repeats", async () => {
  const store = createMemoryStore();
  await store.putSnapshot("digest:2026-09-25", {
    date: "2026-09-25",
    items: ["a", "b", "c", "d", "e", "f", "g"].map((x) => prevItem("evt:" + x)),
  });
  await store.putSnapshot("digest-sent:2026-09-25", { ok: true, at: "2026-09-25T01:00:00Z" });
  const yesterday = ["a", "b", "c", "d", "e", "f", "g"].map((x) =>
    prevItem("evt:" + x, { publishedAt: "2026-09-25T06:00:00Z" })
  );
  const fresh = [1, 2, 3].map((i) =>
    prevItem("evt:new" + i, { url: "https://example.com/new" + i, publishedAt: "2026-09-25T18:00:00Z" })
  );
  for (const it of [...yesterday, ...fresh]) await store.putEvent(it);
  const { digest } = await digestOnce({
    store,
    now: NOW,
    items: [...yesterday, ...fresh],
    skipNotify: true,
    dryRun: true,
  });
  const ids = digest.items.map((it) => it.id);
  for (const x of ["a", "b", "c", "d", "e", "f", "g"]) {
    assert.equal(ids.includes("evt:" + x), false, "repeated old story evt:" + x);
  }
  assert.equal(digest.items.length, 3); // fewer fresh items, no repeat padding
  assert.equal(digest.dedup.duplicates, 7);
  assert.ok(digest.stats);
  assert.equal(digest.stats.excludedAsDuplicate, 7);
});

test("loadDigestHistory throws on remote fetch failure instead of assuming empty", async () => {
  const store = createMemoryStore();
  await store.putSnapshot("digest:2026-09-25", { date: "2026-09-25", items: [prevItem("evt:a")] });
  await assert.rejects(
    loadDigestHistory(store, "2026-09-27", {
      fetchRemoteDigest: async (d) => {
        if (d === "2026-09-26") throw new Error("http-502");
        return null;
      },
    }),
    (e) => e.code === "HISTORY_FETCH"
  );
});

test("loadDigestHistory uses remote digest when local snapshot is missing", async () => {
  const store = createMemoryStore();
  const history = await loadDigestHistory(store, "2026-09-26", {
    fetchRemoteDigest: async () => ({ date: "2026-09-25", items: [prevItem("evt:remote")] }),
  });
  assert.equal(matchHistory({ id: "evt:remote" }, history).date, "2026-09-25");
});

test("digestOnce returns remote published digest without notifying (cache-loss guard)", async () => {
  const store = createMemoryStore();
  // Local sent marker lost (cache evicted), but the Worker already published.
  const remote = {
    date: "2026-09-26",
    generatedAt: "2026-09-26T00:30:00Z",
    items: [prevItem("evt:r1")],
  };
  const { digest, bark } = await digestOnce({
    store,
    now: NOW,
    items: [prevItem("evt:r1")],
    skipNotify: false,
    dryRun: true,
    fetchRemoteDigest: async (d) => (d === "2026-09-26" ? remote : null),
  });
  assert.equal(bark.reason, "remote-already-published");
  assert.equal(bark.attempted, 0);
  assert.equal(digest.items.length, 1);
  const sent = await store.getSnapshot("digest-sent:2026-09-26");
  assert.equal(sent.json.remotePublished, true);
  assert.equal(sent.json.ok, false);
  assert.equal(sent.json.unknown, true);
});

test("digestOnce fails closed when remote check errors and no local marker exists", async () => {
  const store = createMemoryStore();
  await assert.rejects(
    digestOnce({
      store,
      now: NOW,
      items: [prevItem("evt:x")],
      dryRun: true,
      fetchRemoteDigest: async () => {
        throw new Error("http-502");
      },
    })
  );
});
