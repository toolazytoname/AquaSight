import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, request as httpRequest } from "node:http";
import { handleApi } from "../src/api/handlers.js";
import { API_BODY_MAX_BYTES, INGEST_BODY_MAX_BYTES, requestBodyLimit } from "../src/api/body.js";
import { createMemoryStore } from "../src/store/memory.js";
import { loadFileStore } from "../src/store/file.js";
import { fetchPinned } from "../src/import-fetch-node.js";
import { startServer } from "../src/server.js";

const req = (path, body, headers = {}) => new Request("http://localhost" + path, { method: "POST", headers, body });

test("API invalid JSON and scalar bodies return 400 without writes", async () => {
  const store = createMemoryStore();
  const before = await store.exportAll();
  for (const body of ["{", "null", "[]", '"text"', "42", ""]) {
    const result = await handleApi(req("/api/v1/settings", body), { store });
    assert.equal(result.status, 400, body);
  }
  assert.deepEqual(await store.exportAll(), before);
});

test("API body limits count streamed bytes and distrust Content-Length", async () => {
  const store = createMemoryStore();
  for (const headers of [{}, { "content-length": "1" }]) {
    const res = await handleApi(req("/api/v1/settings", JSON.stringify({ text: "字".repeat(API_BODY_MAX_BYTES / 2) }), headers), { store });
    assert.equal(res.status, 413);
  }
  const res = await handleApi(req("/api/v1/settings", "{}", { "content-length": String(API_BODY_MAX_BYTES + 1) }), { store });
  assert.equal(res.status, 413);
  assert.equal(requestBodyLimit("/api/v1/ingest/"), INGEST_BODY_MAX_BYTES);
  assert.equal(requestBodyLimit("/api/v1/import-backup"), INGEST_BODY_MAX_BYTES);
  // Route authorization precedes expensive JSON parsing for bulk writes.
  const unauthorized = await handleApi(req("/api/v1/ingest", "{"), { store, requireAuth: true });
  assert.equal(unauthorized.status, 401);
});

test("foreign Origin cannot write any API route; native and same-origin clients still work", async () => {
  const store = createMemoryStore();
  for (const path of ["/api/v1/settings", "/api/v1/auth/login", "/api/v1/reads", "/api/v1/feedback"]) {
    assert.equal((await handleApi(req(path, "{}", { origin: "http://sibling.localhost" }), { store })).status, 403);
  }
  for (const headers of [{}, { origin: "http://localhost" }]) {
    assert.equal((await handleApi(req("/api/v1/settings", "{}", headers), { store })).status, 200);
  }
});

test("API snapshot metadata stays request-local across concurrent requests", async () => {
  const store = createMemoryStore();
  const env = { store, snapshotAt: "caller-owned" };
  await Promise.all([handleApi(new Request("http://localhost/api/v1/events"), env), handleApi(new Request("http://localhost/api/v1/events"), env)]);
  assert.equal(env.snapshotAt, "caller-owned");
});

test("file store fails closed on damaged JSON and saves private data owner-only", async t => {
  const dir = await mkdtemp(join(tmpdir(), "aquasight-boundary-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, "store.json");
  await writeFile(path, "{broken");
  await assert.rejects(loadFileStore(path), SyntaxError);
  assert.equal(await readFile(path, "utf8"), "{broken");
  await rm(path);
  const store = await loadFileStore(path);
  await store.setPrefs({ topics: ["tech"] });
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(JSON.parse(await readFile(path, "utf8")));
});

test("Node import pins checked addresses but preserves original Host", async t => {
  let host;
  const server = createServer((req, res) => { host = req.headers.host; res.end("pinned"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const response = await fetchPinned(`http://no-such-dns-name.invalid:${port}/`, { validatedAddresses: ["127.0.0.1"] });
  assert.equal(await response.text(), "pinned");
  assert.equal(host, `no-such-dns-name.invalid:${port}`);
  await assert.rejects(fetchPinned("https://example.com"), /validated addresses/);
});

test("Node adapter returns 413 for chunked oversized input and stays healthy", async t => {
  const { server, port } = await startServer({ port: 0, store: createMemoryStore() });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const status = await new Promise((resolve, reject) => {
    const r = httpRequest({ hostname: "127.0.0.1", port, path: "/api/v1/settings", method: "POST", headers: { "transfer-encoding": "chunked" } }, res => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    r.on("error", reject);
    r.end("x".repeat(API_BODY_MAX_BYTES + 1));
  });
  assert.equal(status, 413);
  const healthy = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
  assert.equal(healthy.status, 200);
  assert.equal(healthy.headers.get("x-content-type-options"), "nosniff");
});

test("deployment commands apply personal-feed migration before publishing", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.scripts.deploy.indexOf("db:migrate:feeds") < pkg.scripts.deploy.indexOf("wrangler deploy"));
  const staging = pkg.scripts["deploy:staging"];
  assert.ok(staging.indexOf("20261001_personal_feeds.sql") < staging.indexOf("wrangler deploy"));
});

test("manual import rejects private targets as a client error, not an internal failure", async () => {
  const result = await handleApi(req("/api/v1/import", JSON.stringify({ url: "http://127.0.0.1/private" })), { store: createMemoryStore() });
  assert.equal(result.status, 400);
  assert.equal((await result.json()).error, "import_private");
});

test("Worker without D1 fails closed, never acknowledges ephemeral account writes", async () => {
  const { default: worker } = await import("../worker/src/index.js");
  const res = await worker.fetch(new Request("https://example.com/api/v1/health"), {});
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, "storage unavailable");
  assert.equal(res.headers.get("cache-control"), "no-store");
  const asset = await worker.fetch(new Request("https://example.com/"), { ASSETS: { fetch: () => new Response("shell") } });
  assert.equal(await asset.text(), "shell");
});

test("Cloudflare asset headers match API/Node security policy", async () => {
  const { SECURITY_HEADERS } = await import("../src/security-headers.js");
  const config = await readFile(new URL("../web/_headers", import.meta.url), "utf8");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.ok(config.includes(`  ${name}: ${value}`), name);
  const res = await handleApi(new Request("http://localhost/api/v1/events"), { store: createMemoryStore() });
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) assert.equal(res.headers.get(name), value);
});

test("CI applies the whole migration directory and serializes same-environment deployments", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-worker.yml", import.meta.url), "utf8");
  assert.match(workflow, /for migration in worker\/migrations\/\*\.sql/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /dev\|staging\|production/);
  assert.ok(workflow.indexOf('for migration') < workflow.indexOf('wrangler deploy'));
});

test("operator export declares its coverage instead of implying a complete D1 backup", async () => {
  const store = createMemoryStore();
  const local = await handleApi(new Request("http://localhost/api/v1/export"), { store });
  assert.equal((await local.json()).backupScope, "full-local-store");
  const { createSqliteD1 } = await import("./helpers/sqlite-d1.js");
  const { createD1Store } = await import("../src/store/d1.js");
  const db = await createSqliteD1();
  try {
    const d1 = await handleApi(new Request("http://localhost/api/v1/export"), { store: createD1Store(db) });
    assert.equal((await d1.json()).backupScope, "shared-content-only");
  } finally { db.close(); }
});

test("Node import rejects out-of-range upstream status without crashing the server", async t => {
  const server = createServer((_req, res) => { res.writeHead(700); res.end("invalid upstream"); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  await assert.rejects(fetchPinned(`http://pinned.invalid:${server.address().port}/`, { validatedAddresses: ["127.0.0.1"] }), { code: "IMPORT_HTTP" });
});
