import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("reader settings and personalized feed never fall back to a service-worker cache", async () => {
  const code = await readFile(new URL("../web/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  let fetches = 0;
  const context = vm.createContext({
    URL, Request, Response, Headers,
    self: { location: { href: "https://example.com/" }, addEventListener: (name, callback) => listeners.set(name, callback) },
    fetch: async () => { fetches++; throw new Error("offline"); },
    caches: { open: () => { throw new Error("personal data must not use shared cache"); } },
  });
  vm.runInContext(code, context);
  for (const path of ["/api/v1/reader/settings", "/api/v1/reader/catalog", "/api/v1/events?view=reader", "/api/v1/events/private?reader=1"]) {
    let response;
    listeners.get("fetch")({ request: new Request("https://example.com" + path), respondWith: (promise) => { response = promise; } });
    const result = await response;
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("cache-control"), "no-store");
  }
  assert.equal(fetches, 4);
});
