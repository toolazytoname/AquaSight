import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cluster } from "../src/cluster.js";
import { selectFeatured } from "../src/select.js";
import { articleId } from "../src/identity.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures/regression");

async function load(name) {
  return JSON.parse(await readFile(join(dir, name), "utf8"));
}

function replay(fix) {
  const now = fix.now ? new Date(fix.now) : new Date("2026-09-07T08:00:00.000Z");
  const map = new Map();
  const cards = cluster(fix.articles, { now, articleEventMap: map });
  const again = cluster(fix.articles, { now, articleEventMap: map });
  return { cards, again, now };
}

test("T01 duplicate Huawei news stay two events and replay stably", async () => {
  const fix = await load("duplicate-huawei.json");
  const { cards, again } = replay(fix);
  assert.equal(cards.length, 2);
  assert.deepEqual(
    cards.map((c) => c.id).sort(),
    again.map((c) => c.id).sort()
  );
  const ids = new Set(cards.map((c) => c.id));
  assert.equal(ids.size, cards.length);
  assert.ok(cards.every((c) => c.id.startsWith("evt:")));
});

test("T01 different OpenAI news are not overwritten; bilingual GPT-5 merges", async () => {
  const fix = await load("openai-overwrite.json");
  const { cards } = replay(fix);
  assert.ok(cards.length >= 2);
  const gpt = cards.filter((c) => /gpt-5/i.test(c.title + c.product));
  assert.equal(gpt.length, 1);
  assert.equal(gpt[0].sources.length, 2);
  const cfo = cards.find((c) => /CFO|cfo/.test(c.title));
  assert.ok(cfo);
  assert.notEqual(cfo.id, gpt[0].id);
});

test("T01 2024 obituary is not breaking when rediscovered", async () => {
  const fix = await load("obituary-2024.json");
  const { cards, now } = replay(fix);
  assert.equal(cards.length, 1);
  assert.notEqual(cards[0].level, "breaking");
  assert.equal(cards[0].notifyEligible, false);
  const featured = selectFeatured(cards, { now });
  assert.equal(featured.length, 0);
});

test("T01 different company earnings stay independent; bank not tech", async () => {
  const fix = await load("earnings.json");
  const { cards, now } = replay(fix);
  assert.equal(cards.length, 4);
  const bank = cards.find((c) => /招商银行/.test(c.title));
  assert.equal(bank.category, "business");
  const featured = selectFeatured(cards, { now });
  assert.equal(
    featured.filter((c) => c.category === "tech" && /银行/.test(c.title)).length,
    0
  );
});

test("T01 article ids are hashes of source identity, not company names", async () => {
  const a = {
    source: "openai",
    title: "OpenAI launches GPT-5 API",
    url: "https://openai.com/blog/gpt-5",
  };
  const b = {
    source: "openai",
    title: "OpenAI hires a new CFO",
    url: "https://openai.com/blog/cfo",
  };
  assert.match(articleId(a), /^art:/);
  assert.notEqual(articleId(a), articleId(b));
  assert.equal(articleId(a).includes("openai"), false);
});
