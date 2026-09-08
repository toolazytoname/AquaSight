import { test } from "node:test";
import assert from "node:assert/strict";
import { assertSafeImportUrl, fetchImported, isPrivateHostname } from "../src/ssrf.js";

const publicLookup = async () => ["93.184.216.34"];

test("blocks private hosts and metadata", async () => {
  await assert.rejects(() => assertSafeImportUrl("http://127.0.0.1/x"), /not allowed|private/i);
  await assert.rejects(() => assertSafeImportUrl("http://localhost/x"));
  await assert.rejects(() => assertSafeImportUrl("http://169.254.169.254/latest/meta-data"));
  await assert.rejects(() => assertSafeImportUrl("http://10.0.0.5/x"));
  await assert.rejects(() => assertSafeImportUrl("file:///etc/passwd"));
  const ok = await assertSafeImportUrl("https://example.com/a", { lookupImpl: publicLookup });
  assert.equal(ok.hostname, "example.com");
});

test("blocks IPv4-mapped IPv6 and metadata v6", async () => {
  assert.equal(isPrivateHostname("[::ffff:127.0.0.1]"), true);
  await assert.rejects(() => assertSafeImportUrl("http://[::ffff:127.0.0.1]/"));
  await assert.rejects(() => assertSafeImportUrl("http://[::ffff:169.254.169.254]/latest/meta-data"));
  await assert.rejects(() => assertSafeImportUrl("http://[::1]/"));
});

test("blocks DNS results that resolve privately", async () => {
  await assert.rejects(
    () =>
      assertSafeImportUrl("https://evil.example/x", {
        lookupImpl: async () => ["127.0.0.1"],
      }),
    /private/i
  );
});

test("limits redirects and re-checks each hop", async () => {
  let hops = 0;
  const fake = async () => {
    hops += 1;
    if (hops < 5) {
      return {
        status: 302,
        ok: false,
        headers: { get: () => "https://example.com/next" + hops },
        text: async () => "",
      };
    }
    return { status: 200, ok: true, headers: { get: () => "text/plain" }, text: async () => "ok" };
  };
  await assert.rejects(
    () =>
      fetchImported("https://example.com/start", {
        fetchImpl: fake,
        maxRedirects: 2,
        lookupImpl: publicLookup,
      }),
    /redirect/i
  );
});

test("redirect to private host is blocked", async () => {
  const fake = async () => ({
    status: 302,
    ok: false,
    headers: { get: () => "http://127.0.0.1/secret" },
    text: async () => "",
  });
  await assert.rejects(
    () =>
      fetchImported("https://example.com/start", {
        fetchImpl: fake,
        lookupImpl: publicLookup,
      }),
    /private|not allowed/i
  );
});
