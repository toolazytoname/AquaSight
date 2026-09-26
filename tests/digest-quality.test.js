import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCookies } from "../src/auth.js";
import { digestItemQuality, isHttpUrl, prepareDigest } from "../src/digest-editor.js";
import { enrichmentCacheKey } from "../src/enrich.js";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";

test("parseCookies tolerates malformed percent escapes", () => {
  // Previously decodeURIComponent("%") threw URIError and turned a public
  // GET /api/v1/events into a 500.
  const jar = parseCookies("aqs_session=%; other=ok%2Fx; plain=1");
  assert.equal(jar.aqs_session, "%");
  assert.equal(jar.other, "ok/x");
  assert.equal(jar.plain, "1");
});

test("parseCookies on empty header", () => {
  assert.deepEqual(parseCookies(""), {});
  assert.deepEqual(parseCookies(null), {});
});

test("malformed session cookie keeps public GET /api/v1/events at 200 (end-to-end)", async () => {
  const store = createMemoryStore();
  await store.putEvent({
    id: "evt:x",
    title: "Public story title",
    url: "https://example.com/x",
    source: "hn",
    category: "tech",
    value: 0.9,
    subject: "x",
    publishedAt: new Date().toISOString(),
  });
  const res = await handleApi(
    new Request("https://worker.test/api/v1/events?view=latest&limit=5", {
      headers: { cookie: "aqs_session=%" },
    }),
    { store, ingestToken: "", authToken: "", requireAuth: false, authMode: "otp" }
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.items));
});

test("isHttpUrl accepts only valid http(s) with host", () => {
  assert.equal(isHttpUrl("https://example.com/a"), true);
  assert.equal(isHttpUrl("http://example.com"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("data:text/html,hi"), false);
  assert.equal(isHttpUrl("https://"), false);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl("not a url"), false);
});

test("digestItemQuality checks link, time, title, grounding", () => {
  const base = {
    title: "A real story title",
    url: "https://example.com/s",
    publishedAt: "2026-09-25T10:00:00Z",
  };
  assert.deepEqual(digestItemQuality(base), { ok: true, reasons: [] });
  assert.ok(digestItemQuality({ ...base, url: "javascript:x" }).reasons.includes("link"));
  assert.ok(digestItemQuality({ ...base, url: undefined }).reasons.includes("link"));
  // a member source URL can satisfy the link requirement
  assert.equal(
    digestItemQuality({ ...base, url: undefined, sources: [{ url: "https://ok.example/1" }] }).ok,
    true
  );
  assert.ok(digestItemQuality({ ...base, publishedAt: "not-a-date", firstSeenAt: null, seenAt: null }).reasons.includes("time"));
  assert.ok(digestItemQuality({ ...base, title: "x" }).reasons.includes("title"));
  assert.ok(
    digestItemQuality({ ...base, aiState: "ready", facts: [], evidence: [] }).reasons.includes("no-grounding")
  );
  assert.equal(
    digestItemQuality({ ...base, aiState: "ready", facts: ["f1"], evidence: [] }).ok,
    true
  );
});

function cachedEnrich(item, titleZh, facts) {
  return {
    category: "tech",
    entities: [],
    titleZh,
    overviewZh: "模型依据来源生成的中文概述，长度足够。",
    facts,
    impact: "",
    evidence: facts.length ? ["来源依据"] : [],
    uncertainty: [],
    attribution: [],
    insufficient: false,
    cacheKey: enrichmentCacheKey(item),
  };
}

test("prepareDigest uses valid cache, drops unlinked and ungrounded entries with reasons", async () => {
  const store = createMemoryStore();
  const mk = (id, url) => ({
    id,
    title: "story " + id + " with a long enough title",
    url,
    source: "hn",
    category: "tech",
    value: 0.9,
    subject: id,
    publishedAt: "2026-09-25T12:00:00Z",
  });
  const good = mk("evt:good", "https://example.com/good");
  const noLink = mk("evt:nolink", "javascript:bad");
  const noGround = mk("evt:noground", "https://example.com/noground");
  for (const it of [good, noLink, noGround]) await store.putEvent(it);
  // Real, valid enrichment cache entries (no model call, no weakened gate):
  await store.putCache("event-enrich:evt:good", cachedEnrich(good, "好的报道标题字数足够", ["fact one"]));
  await store.putCache("event-enrich:evt:nolink", cachedEnrich(noLink, "无链接的报道标题字数", ["fact two"]));
  await store.putCache("event-enrich:evt:noground", cachedEnrich(noGround, "无事实的报道标题字数", []));
  const out = await prepareDigest(
    { date: "2026-09-26", items: [good, noLink, noGround].map(({ id }) => ({ id })) },
    { store, apiKey: "", now: new Date("2026-09-26T01:00:00Z") }
  );
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, "evt:good");
  assert.equal(out.items[0].aiState, "ready");
  const reasons = Object.fromEntries(out.aiEditing.rejected.map((r) => [r.id, r.reasons]));
  assert.ok(reasons["evt:nolink"].includes("link"), JSON.stringify(reasons));
  assert.ok(reasons["evt:noground"].includes("no-grounding"), JSON.stringify(reasons));
  // Real request accounting: everything came from cache — zero requests.
  assert.equal(out.aiEditing.fetch.requests, 0);
  assert.equal(out.aiEditing.ready, 1);
  assert.equal(out.aiEditing.selected, 3);
  assert.equal(out.aiSummaryOutcome.attempted, false); // no API key configured
});
