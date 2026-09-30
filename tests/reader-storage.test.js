import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "../src/store/memory.js";
import { loadFileStore } from "../src/store/file.js";
import { createD1Store } from "../src/store/d1.js";

async function verifyPatches(store) {
  await store.setPrefs({ blockedSources: ["hn"], reader: { selectedSources: ["github"], moreSourcesEnabled: false } }, { userId: "a" });
  await Promise.all([
    store.setReaderPrefs({ selectedSources: ["openai"], configured: true }, { userId: "a" }),
    store.setReaderPrefs({ moreSourcesEnabled: true, configured: true }, { userId: "a" }),
  ]);
  const prefs = await store.getPrefs({ userId: "a" });
  assert.deepEqual(prefs.reader, { selectedSources: ["openai"], moreSourcesEnabled: true, configured: true });
  assert.deepEqual(prefs.blockedSources, ["hn"]);
  assert.equal((await store.getPrefs({ userId: "b" })).reader, undefined);
  await assert.rejects(store.setReaderPrefs({ moreSourcesEnabled: true }), /account/);
}

test("memory reader field patches preserve concurrent changes and other preferences", async () => verifyPatches(createMemoryStore()));

test("file reader field patches persist across reloads", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aquasight-reader-"));
  try {
    const path = join(dir, "store.json"), store = await loadFileStore(path);
    await verifyPatches(store);
    const restored = await loadFileStore(path);
    assert.equal((await restored.getPrefs({ userId: "a" })).reader.moreSourcesEnabled, true);
    await restored.setReaderPrefs({ selectedSources: ["github"] }, { userId: "a" });
    await store.setReaderPrefs({ moreSourcesEnabled: false }, { userId: "a" });
    assert.deepEqual((await restored.getPrefs({ userId: "a" })).reader.selectedSources, ["github"]);
    assert.equal((await restored.getPrefs({ userId: "a" })).reader.moreSourcesEnabled, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("D1 reader field patches merge atomically through SQLite JSON", async t => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); }
  catch { t.skip("node:sqlite unavailable"); return; }
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(await readFile(new URL("../worker/schema.sql", import.meta.url), "utf8"));
  const store = createD1Store({ prepare(sql) {
    const statement = db.prepare(sql); let args = [];
    const bound = {
      bind(...values) { args = values; return bound; },
      async first() { return statement.get(...args) ?? null; },
      async run() { return statement.run(...args); },
    }; return bound;
  }});
  await verifyPatches(store);
  await store.setReaderPrefs({ selectedSources: [], configured: true }, { userId: "new" });
  assert.deepEqual((await store.getPrefs({ userId: "new" })).reader.selectedSources, []);
});

test("reader API patches independent fields concurrently and advertises the new reading mode", async () => {
  const { handleApi } = await import("../src/api/handlers.js");
  const { verifyCode } = await import("../src/auth.js");
  const { createHash } = await import("node:crypto");
  const store = createMemoryStore(); store.authPepper = "test-pepper";
  const email = "patch@example.com", code = "621845";
  await store.putOtp({ email, codeHash: createHash("sha256").update("test-pepper:" + code).digest("hex"), expiresAt: new Date(Date.now() + 600000).toISOString(), attempts: 0 });
  const user = await verifyCode(store, { email, code }, {});
  assert.equal(user.ok, true);
  const request = (path, body) => handleApi(new Request("https://example.com/api/v1/" + path, {
    method: body ? "PUT" : "GET", headers: { authorization: "Bearer " + user.token, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
  }), { store, authMode: "otp" });
  const results = await Promise.all([
    request("reader/settings", { selectedSources: ["openai"] }),
    request("reader/settings", { moreSourcesEnabled: true }),
  ]);
  for (const response of results) assert.equal(response.status, 200);
  const prefs = (await (await request("reader/settings")).json()).reader;
  assert.deepEqual(prefs.selectedSources, ["openai"]);
  assert.equal(prefs.moreSourcesEnabled, true);
  const reading = await (await request("events?view=reader")).json();
  assert.equal(reading.reader, true);
  const legacy = await (await request("events?view=latest")).json();
  assert.equal(legacy.reader, undefined);
});
