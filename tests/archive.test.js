import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeArchive } from "../src/archive.js";

test("incoming overlapping members keep first archivedAt and id", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");
  const first = mergeArchive(
    [],
    [
      {
        id: "card:deepseek",
        title: "DeepSeek R1 发布",
        source: "hn",
        memberIds: ["hn:r1"],
        seenAt: "2026-08-25T08:00:00.000Z",
        publishedAt: "2026-08-24T01:00:00.000Z",
      },
    ],
    now
  );
  const second = mergeArchive(
    first.items,
    [
      {
        id: "card:deepseek",
        title: "DeepSeek R1 发布",
        source: "hn",
        memberIds: ["hn:r1", "36kr:nvda"],
        seenAt: "2026-08-25T12:00:00.000Z",
        publishedAt: "2026-08-24T03:00:00.000Z",
        score: 9,
        level: "breaking",
      },
    ],
    new Date("2026-08-25T12:00:00.000Z")
  );
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0].id, "card:deepseek");
  assert.equal(second.items[0].archivedAt, "2026-08-25T12:00:00.000Z");
  assert.equal(second.items[0].seenAt, "2026-08-25T08:00:00.000Z");
  assert.equal(second.items[0].publishedAt, "2026-08-24T01:00:00.000Z");
  assert.equal(second.items[0].level, "breaking");
  assert.ok(second.items[0].memberIds.includes("36kr:nvda"));
});

test("old pipe ids still match member overlap", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");
  const prev = [
    {
      id: "hn:r1|36kr:nvda",
      title: "old",
      archivedAt: "2026-08-24T12:00:00.000Z",
    },
  ];
  const next = mergeArchive(
    prev,
    [
      {
        id: "card:deepseek",
        title: "new",
        memberIds: ["hn:r1"],
      },
    ],
    now
  );
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].id, "hn:r1|36kr:nvda");
  assert.equal(next.items[0].archivedAt, "2026-08-24T12:00:00.000Z");
});
