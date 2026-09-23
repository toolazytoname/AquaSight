import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDigestSummary, extractNumbers } from "../src/digest-check.js";

const ENTRIES = [
  {
    titleZh: "某公司完成 350 亿元融资",
    overviewZh: "该公司宣布完成 350 亿元 C 轮融资，估值达到 1200 亿元。",
  },
  { titleZh: "高通发布新芯片", overviewZh: "主频超过 5GHz，功耗下降 30%。" },
  { titleZh: "恒指微跌", overviewZh: "恒生指数开盘下跌 0.4%。" },
];

test("summary restating source numbers passes all gates", () => {
  const v = validateDigestSummary(
    "某公司完成 350 亿元融资，估值达到 1200 亿元；高通新芯片主频超过 5GHz，功耗下降 30%。",
    ENTRIES
  );
  assert.equal(v.ok, true);
  assert.equal(v.checked.numbers, 4);
});

test("the 10x error (350亿 → 3500亿) is rejected as ungrounded", () => {
  const v = validateDigestSummary("某公司完成 3500 亿元融资，创纪录。", ENTRIES);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ungrounded-numbers");
  assert.deepEqual(v.checked.unmatched, ["3500亿"]);
});

test("unit mismatch is rejected even when the digits match", () => {
  const v = validateDigestSummary("估值达到 1200 万元。", ENTRIES);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ungrounded-numbers");
});

test("percentages and bare counts compare on the numeric part", () => {
  const v = validateDigestSummary("恒生指数下跌 0.4%，高通功耗下降 30%。", ENTRIES);
  assert.equal(v.ok, true);
});

test("a sentence about an entity absent from the sources is rejected", () => {
  const v = validateDigestSummary("特斯拉宣布在上海建设全新超级工厂。", ENTRIES);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ungrounded-sentence");
});

test("foreign URLs are rejected", () => {
  const v = validateDigestSummary("详见 https://example.com/report 某公司 350 亿元融资。", ENTRIES);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "foreign-url");
});

test("empty summary and empty sources never validate", () => {
  assert.equal(validateDigestSummary("", ENTRIES).ok, false);
  assert.equal(validateDigestSummary("某公司完成 350 亿元融资。", []).ok, false);
});

test("extractNumbers normalizes full-width digits and comma grouping", () => {
  const nums = extractNumbers("共计１２,３４５万元与 3.5%");
  assert.deepEqual(
    nums.map((n) => n.value),
    [12345, 3.5]
  );
  assert.equal(nums[0].unit, "万");
});
