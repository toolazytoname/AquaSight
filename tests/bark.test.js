import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPayload, pushBreaking } from "../src/bark.js";

const breaking = {
  id: "fixture:k3-beat",
  title: "K3 release beats foreign models",
  url: "https://example.com/k3",
  source: "hn",
  level: "breaking",
  reason: "tech source hit lab + strong event",
};
const normal = {
  id: "fixture:plain-hn",
  title: "Show HN: a tiny CSS framework for forms",
  url: "https://example.com/css",
  source: "hn",
  level: "normal",
  reason: "no breaking rule matched",
};

test("dry-run makes zero requests", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return { ok: true };
  };
  const r = await pushBreaking([breaking, normal], {
    key: "test-key",
    dryRun: true,
    fetchImpl: fake,
  });
  assert.equal(calls, 0);
  assert.equal(r.attempted, 0);
  assert.equal(r.dryRun, true);
});

test("fixture breaking sends once then zero on rerun", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bark-"));
  const sentPath = join(dir, "sent.json");
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return { ok: true };
  };
  const first = await pushBreaking([breaking, normal], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
  });
  assert.equal(first.attempted, 1);
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].init.body);
  assert.ok(body.title);
  assert.ok(body.body);
  assert.equal(body.group, "\u9e2d\u5148\u77e5");
  assert.equal(body.level, "timeSensitive");
  assert.match(calls[0].url, /test-key$/);

  const second = await pushBreaking([breaking, normal], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
  });
  assert.equal(second.attempted, 0);
  assert.equal(calls.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("normal events are not sent", async () => {
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return { ok: true };
  };
  const r = await pushBreaking([normal], {
    key: "test-key",
    fetchImpl: fake,
  });
  assert.equal(calls, 0);
  assert.equal(r.attempted, 0);
});

test("payload has title body group level", () => {
  const p = buildPayload(breaking);
  assert.ok(p.title.startsWith("[\u7834\u5708]"));
  assert.ok(p.body);
  assert.equal(p.group, "\u9e2d\u5148\u77e5");
  assert.equal(p.level, "timeSensitive");
});
