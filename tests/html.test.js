import { test } from "node:test";
import assert from "node:assert/strict";
import { stripHtml, decodeEntities, extractMainText } from "../src/html.js";
import { parseRss } from "../src/rss.js";

test("entities decode fully and html is stripped", () => {
  assert.equal(decodeEntities("A &amp; B &lt;C&gt;"), "A & B <C>");
  assert.equal(stripHtml("<p>hello <b>world</b></p>"), "hello world");
});

test("repo names and CUDA are not mangled", () => {
  const xml =
    "<rss><channel><item><title>facebook/react CUDA kernels</title>" +
    "<link>https://github.com/facebook/react</link>" +
    "<description>owner/repo stays owner/repo</description></item></channel></rss>";
  const items = parseRss(xml);
  assert.equal(items[0].title, "facebook/react CUDA kernels");
  assert.match(items[0].summary, /owner\/repo/);
});

test("failed html still returns readable text", () => {
  const text = extractMainText("<p>可读内容</p><script>alert(1)</script>");
  assert.match(text, /可读内容/);
  assert.equal(text.includes("alert"), false);
});
