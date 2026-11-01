import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

// Transfer-size regression guard, not a substitute for device/network RUM.
// No framework rewrite is needed to keep this reading shell lightweight.
for (const [file, maxGzipBytes] of [["app.js", 50_000], ["i18n.js", 20_000], ["style.css", 12_000]]) {
  test(`reading-shell transfer budget: ${file}`, async () => {
    const bytes = gzipSync(await readFile(new URL(`../web/${file}`, import.meta.url))).byteLength;
    assert.ok(bytes <= maxGzipBytes, `${file}: ${bytes} gzip bytes exceeds ${maxGzipBytes}; investigate before raising the budget`);
  });
}
