import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fromHnCitation,
  fromManualImport,
  xSubscriptionStatus,
  fetchSubscribedAccount,
  isXUrl,
} from "../src/x.js";

test("HN cited X posts become sourced articles", () => {
  const item = fromHnCitation({
    title: "A post about GPT-5",
    url: "https://x.com/openai/status/1234567890",
    source: "hn",
    discussionUrl: "https://news.ycombinator.com/item?id=9",
    publishedAt: "2026-09-01T00:00:00Z",
  });
  assert.equal(item.source, "x");
  assert.equal(item.provenance.kind, "hn-citation");
  assert.equal(item.url, "https://x.com/openai/status/1234567890");
});

test("manual import keeps provenance", () => {
  const item = fromManualImport({
    url: "https://twitter.com/foo/status/42",
    excerpt: "hello &amp; world",
    title: "手工摘录",
  });
  assert.equal(item.provenance.kind, "manual-import");
  assert.equal(item.summary, "hello & world");
});

test("no credential shows disconnected; adapter does not fetch", async () => {
  const st = xSubscriptionStatus({});
  assert.equal(st.connected, false);
  await assert.rejects(() => fetchSubscribedAccount(), /未接通/);
  assert.equal(isXUrl("https://nitter.net/foo/status/1"), false);
});
