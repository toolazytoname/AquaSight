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

test("rejects the full IPv6 local ranges and unsafe transition networks", async () => {
  for (const ip of ["::", "::127.0.0.1", "fe90::1", "febf::1", "fec0::1", "fc00::1", "ff02::1", "64:ff9b::7f00:1", "2002:7f00:1::", "2001:db8::1", "2001::1"]) {
    await assert.rejects(assertSafeImportUrl(`http://[${ip}]/`), { code: "IMPORT_PRIVATE" }, ip);
  }
  const publicV6 = "2606:4700:4700::1111";
  assert.equal((await assertSafeImportUrl(`https://[${publicV6}]/`)).addrs[0], publicV6);
});

test("rejects mixed-family private DNS results and malformed non-address answers", async () => {
  for (const answers of [["93.184.216.34", "fe90::1"], ["alias.example"], ["2001:not-an-ip"]]) {
    await assert.rejects(assertSafeImportUrl("https://example.com", { lookupImpl: async () => answers }), { code: "IMPORT_PRIVATE" });
  }
});

test("import limit options cannot be disabled with NaN or infinity", async () => {
  const spec = await assertSafeImportUrl("https://example.com", { lookupImpl: publicLookup, maxBytes: NaN, timeoutMs: Infinity, maxRedirects: NaN });
  assert.equal(spec.maxBytes, 500_000);
  assert.equal(spec.timeoutMs, 8000);
  assert.equal(spec.maxRedirects, 3);
});

test("deadline covers a DNS lookup that never returns", async () => {
  let fetched = false;
  await assert.rejects(fetchImported("https://example.com", {
    timeoutMs: 500,
    lookupImpl: () => new Promise(() => {}),
    fetchImpl: async () => { fetched = true; },
  }), { code: "IMPORT_TIMEOUT" });
  assert.equal(fetched, false);
});

test("deadline also cancels a stalled response body", async () => {
  let cancelled = false;
  await assert.rejects(fetchImported("https://example.com", {
    timeoutMs: 500, lookupImpl: publicLookup,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })),
  }), { code: "IMPORT_TIMEOUT" });
  assert.equal(cancelled, true);
});

test("redirect and rejected content bodies are cancelled, UTF-8 limits count bytes", async () => {
  let cancelled = 0;
  await assert.rejects(fetchImported("https://example.com", {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 302, headers: { location: "http://127.0.0.1/" } }),
  }), { code: "IMPORT_PRIVATE" });
  assert.equal(cancelled, 1);
  await assert.rejects(fetchImported("https://example.com", {
    maxBytes: 4, lookupImpl: publicLookup,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "中文" }),
  }), { code: "IMPORT_SIZE" });
  await assert.rejects(fetchImported("https://example.com", {
    lookupImpl: publicLookup,
    fetchImpl: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "content-type": "image/png" } }),
  }), { code: "IMPORT_CONTENT_TYPE" });
  assert.equal(cancelled, 2);
});

test("DoH fallback checks A and AAAA, ignores CNAME, and fails closed on resolver errors", async () => {
  const seen = [];
  const options = {
    dnsLookupImpl: async () => { throw new Error("native DNS unavailable"); },
    dnsFetchImpl: async url => {
      const type = new URL(url).searchParams.get("type");
      seen.push(type);
      return Response.json({ Status: 0, Answer: type === "A"
        ? [{ type: 5, data: "alias.example" }, { type: 1, data: "93.184.216.34" }]
        : [{ type: 28, data: "fe90::1" }] });
    },
  };
  await assert.rejects(assertSafeImportUrl("https://example.com", options), { code: "IMPORT_PRIVATE" });
  assert.deepEqual(seen.sort(), ["A", "AAAA"]);
  const cnameOnly = { ...options, dnsFetchImpl: async () => Response.json({ Status: 0, Answer: [{ type: 5, data: "alias.example" }] }) };
  await assert.rejects(assertSafeImportUrl("https://example.com", cnameOnly), { code: "IMPORT_DNS" });
  await assert.rejects(assertSafeImportUrl("https://example.com", { ...options, dnsFetchImpl: async () => Response.json({ Status: 2 }) }), { code: "IMPORT_DNS" });
});

test("a public-looking IPv4 suffix cannot disguise private IPv6 as a mapped address", async () => {
  for (const host of ["fd00::ffff:8.8.8.8", "fe80::ffff:808:808", "fc00:0:0:0:0:ffff:808:808"]) {
    assert.equal(isPrivateHostname(host), true, host);
    await assert.rejects(assertSafeImportUrl(`http://[${host}]/`), { code: "IMPORT_PRIVATE" });
  }
  await assert.rejects(assertSafeImportUrl("http://[0:0:0:0:0:ffff:7f00:1]/"), { code: "IMPORT_PRIVATE" });
  const safe = await assertSafeImportUrl("https://[0:0:0:0:0:ffff:808:808]/");
  assert.equal(safe.hostname, "[::ffff:808:808]");
});


test("Workers lookup CNAME rows trigger typed dual-family DoH, not a false private-address rejection", async () => {
  const seen = [];
  const options = {
    dnsLookupImpl: async () => [
      { address: "feed.example.cdn.example.", family: 4 },
      { address: "93.184.216.34", family: 4 },
      { address: "feed.example.cdn.example.", family: 6 },
    ],
    dnsFetchImpl: async url => {
      const type = new URL(url).searchParams.get("type");
      seen.push(type);
      return Response.json({ Status: 0, Answer: [
        { type: 5, data: "feed.example.cdn.example." },
        ...(type === "A" ? [{ type: 1, data: "93.184.216.34" }] : []),
      ] });
    },
  };
  const spec = await assertSafeImportUrl("https://feed.example/rss", options);
  assert.deepEqual(spec.addrs, ["93.184.216.34"]);
  assert.deepEqual(seen.sort(), ["A", "AAAA"]);
  await assert.rejects(assertSafeImportUrl("https://feed.example/rss", {
    ...options,
    dnsFetchImpl: async url => Response.json({ Status: 0, Answer: [
      new URL(url).searchParams.get("type") === "A"
        ? { type: 1, data: "93.184.216.34" } : { type: 28, data: "fd00::1" },
    ] }),
  }), { code: "IMPORT_PRIVATE" });
  await assert.rejects(assertSafeImportUrl("https://feed.example/rss", {
    ...options, dnsFetchImpl: async () => Response.json({ Status: 2 }),
  }), { code: "IMPORT_DNS" });
});
