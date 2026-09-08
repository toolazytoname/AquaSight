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
  assert.equal(body.body.includes("hard impact"), false);
  assert.equal(body.body.includes("lab + strong"), false);
  assert.equal(body.group, "鸭先知");
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

test("payload has title body group level, not internal reason", () => {
  const p = buildPayload(breaking);
  assert.ok(p.title.startsWith("[破圈]"));
  assert.ok(p.body);
  assert.equal(p.body.includes("tech source"), false);
  assert.equal(p.body.includes("lab + strong"), false);
  assert.equal(p.group, "鸭先知");
  assert.equal(p.level, "timeSensitive");
});

test("member-id overlap does not resend after cluster grows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bark-stable-"));
  const sentPath = join(dir, "sent.json");
  const calls = [];
  const fake = async () => {
    calls.push(1);
    return { ok: true };
  };
  const firstCard = {
    id: "card:deepseek",
    title: "DeepSeek R1 发布",
    level: "breaking",
    memberIds: ["hn:r1"],
    url: "https://example.com/1",
  };
  const grown = {
    id: "card:deepseek",
    title: "DeepSeek R1 发布",
    level: "breaking",
    memberIds: ["hn:r1", "36kr:nvda"],
    url: "https://example.com/1",
  };
  const first = await pushBreaking([firstCard], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
  });
  const second = await pushBreaking([grown], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
  });
  assert.equal(first.attempted, 1);
  assert.equal(second.attempted, 0);
  assert.equal(calls.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("no key does not write sent.json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bark-nokey-"));
  const sentPath = join(dir, "sent.json");
  let calls = 0;
  const fake = async () => {
    calls += 1;
    return { ok: true };
  };
  await pushBreaking([breaking], {
    key: "",
    sentPath,
    fetchImpl: fake,
  });
  assert.equal(calls, 0);
  let exists = true;
  try {
    await rm(sentPath);
  } catch {
    exists = false;
  }
  assert.equal(exists, false);
  await rm(dir, { recursive: true, force: true });
});

test("HTTP 500 is not permanently marked sent and can retry", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bark-500-"));
  const sentPath = join(dir, "sent.json");
  let n = 0;
  const fake = async () => {
    n += 1;
    if (n < 4) return { ok: false, status: 500, json: async () => ({ code: 500, message: "err" }) };
    return { ok: true, status: 200, json: async () => ({ code: 200, message: "success" }) };
  };
  const first = await pushBreaking([breaking], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
    sleepImpl: async () => {},
  });
  assert.equal(first.sent.length, 0);
  assert.ok(first.failed.length >= 1);
  const second = await pushBreaking([breaking], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
    sleepImpl: async () => {},
  });
  assert.equal(second.sent.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test("timeout is recorded as unknown and not marked sent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bark-to-"));
  const sentPath = join(dir, "sent.json");
  const fake = async () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    throw err;
  };
  const r = await pushBreaking([breaking], {
    key: "test-key",
    sentPath,
    fetchImpl: fake,
    timeoutMs: 5,
  });
  assert.equal(r.sent.length, 0);
  assert.equal(r.unknown.length, 1);
  const again = await pushBreaking([breaking], {
    key: "test-key",
    sentPath,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ code: 200, message: "success" }) }),
  });
  assert.equal(again.sent.length, 0);
  assert.equal(again.attempted, 0);
  await rm(dir, { recursive: true, force: true });
});

test("same round dedups and sorts by value", async () => {
  const calls = [];
  const fake = async (_u, init) => {
    calls.push(JSON.parse(init.body).title);
    return { ok: true, status: 200, json: async () => ({ code: 200, message: "success" }) };
  };
  const events = [
    { ...breaking, id: "a", title: "low", value: 0.1 },
    { ...breaking, id: "a", title: "dup", value: 0.9 },
    { ...breaking, id: "b", title: "high", value: 0.8 },
  ];
  const r = await pushBreaking(events, { key: "k", fetchImpl: fake });
  assert.equal(r.attempted, 2);
  assert.equal(calls[0].includes("high"), true);
});
