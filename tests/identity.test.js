import { test } from "node:test";
import assert from "node:assert/strict";
import { articleId, newEventId, resolveEventId, rememberEventMembers } from "../src/identity.js";
import { cluster, stableCardId } from "../src/cluster.js";

test("article id uses full source identity hash", () => {
  const a = { source: "ithome", url: "https://www.ithome.com/0/huawei?utm_source=rss", title: "华为甲" };
  const b = { source: "ithome", url: "https://ithome.com/0/huawei", title: "华为甲" };
  assert.equal(articleId(a), articleId(b));
  const c = { source: "36kr", url: "https://ithome.com/0/huawei", title: "华为甲" };
  assert.notEqual(articleId(a), articleId(c));
});

test("stableCardId is not a company name", () => {
  const id = stableCardId([{ title: "OpenAI launches GPT-5", source: "openai", url: "https://openai.com/a" }]);
  assert.match(id, /^evt:/);
  assert.equal(id.includes("openai"), false);
  assert.equal(id.includes("card:"), false);
});

test("same event keeps id when a second source joins", () => {
  const map = new Map();
  const first = cluster(
    [{ title: "OpenAI launches GPT-5 API", source: "hn", url: "https://hn.test/1", publishedAt: "2026-09-02T10:00:00Z" }],
    { now: new Date("2026-09-02T12:00:00Z"), articleEventMap: map }
  );
  const second = cluster(
    [
      { title: "OpenAI launches GPT-5 API", source: "hn", url: "https://hn.test/1", publishedAt: "2026-09-02T10:00:00Z" },
      { title: "OpenAI 发布 GPT-5", source: "36kr", url: "https://36kr.com/p/gpt5", publishedAt: "2026-09-02T11:00:00Z" },
    ],
    { now: new Date("2026-09-02T12:00:00Z"), articleEventMap: map }
  );
  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.equal(second[0].sources.length, 2);
  const ids = second.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("resolveEventId reuses mapped id and never uses company string", () => {
  const map = new Map();
  const members = [{ source: "openai", url: "https://openai.com/x", title: "OpenAI x" }];
  const id = resolveEventId(members, map);
  rememberEventMembers(id, members.map((m) => ({ ...m, articleId: articleId(m) })), map);
  const again = resolveEventId(
    members.map((m) => ({ ...m, articleId: articleId(m) })),
    map
  );
  assert.equal(id, again);
  assert.match(id, /^evt:/);
  assert.ok(newEventId() !== id);
});
