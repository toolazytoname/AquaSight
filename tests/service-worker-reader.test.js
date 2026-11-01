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

test("cookie-personalized events never enter CacheStorage, even without a visible Cookie header", async () => {
  const code = await readFile(new URL("../web/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const context = vm.createContext({
    URL, Request, Response, Headers,
    self: { location: { href: "https://example.com/" }, addEventListener: (name, callback) => listeners.set(name, callback) },
    fetch: async () => Response.json({ items: [{ id: "account-a-unread" }] }),
    caches: { open: () => { throw new Error("API responses must not use CacheStorage"); } },
  });
  vm.runInContext(code, context);
  for (const path of ["/api/v1/events?view=latest&unread=1", "/api/v1/events?view=featured", "/api/v1/digest"]) {
    const req = new Request("https://example.com" + path, { credentials: "include" });
    assert.equal(req.headers.get("cookie"), null);
    assert.equal((await context.handleApi(req)).status, 200);
  }
  context.fetch = async () => { throw new Error("offline after account switch"); };
  const offline = await context.handleApi(new Request("https://example.com/api/v1/events?view=featured"));
  assert.equal(offline.status, 503);
  assert.equal((await offline.json()).error, "offline");
  let intercepted = false;
  listeners.get("fetch")({ request: new Request("https://other.example/app.js"), respondWith: () => { intercepted = true; } });
  assert.equal(intercepted, false, "other origins must never receive our same-basename shell asset");
});

test("service worker activation deletes all legacy API caches, but preserves other apps", async () => {
  const code = await readFile(new URL("../web/sw.js", import.meta.url), "utf8");
  const listeners = new Map();
  const deleted = [];
  const context = vm.createContext({
    self: { addEventListener: (name, callback) => listeners.set(name, callback), clients: { claim() {} } },
    caches: {
      keys: async () => ["aquasight-shell-v33", "aquasight-shell-v34", "aquasight-news-public-v20", "aquasight-news-v20-private", "other-app"],
      delete: async key => { deleted.push(key); },
    },
  });
  vm.runInContext(code, context);
  let task;
  listeners.get("activate")({ waitUntil: p => { task = p; } });
  await task;
  assert.deepEqual(deleted.sort(), ["aquasight-news-public-v20", "aquasight-news-v20-private", "aquasight-shell-v33"].sort());
});
