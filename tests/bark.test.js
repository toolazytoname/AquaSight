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
