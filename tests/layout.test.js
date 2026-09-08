import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("layout guards long titles, 44px targets, 390 and 1440 breakpoints", async () => {
  const css = await readFile(join(root, "web/style.css"), "utf8");
  const html = await readFile(join(root, "web/index.html"), "utf8");
  assert.match(css, /--touch: 44px/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /max-width: 1440px/);
  assert.match(css, /max-width: 860px/);
  assert.match(css, /bottom-nav/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /精选/);
  assert.match(html, /口味校准/);
});
