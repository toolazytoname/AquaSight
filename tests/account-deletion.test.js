import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createMemoryStore } from "../src/store/memory.js";
import { createD1Store } from "../src/store/d1.js";
import { requestCode, verifyCode, loadSession } from "../src/auth.js";

async function sqliteFixture(t, failAt = "") {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); }
  catch { t.skip("node:sqlite unavailable"); return; }
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(await readFile(new URL("../worker/schema.sql", import.meta.url), "utf8"));
  const adapter = {
    prepare(sql) {
      const stmt = db.prepare(sql); let args = [];
      const bound = {
        bind(...values) { args = values; return bound; },
        async run() { if (failAt && sql.includes(failAt)) throw new Error("injected delete failure"); return stmt.run(...args); },
        async first() { return stmt.get(...args) ?? null; },
        async all() { return { results: stmt.all(...args) }; },
      };
      return bound;
    },
    async batch(stmts) {
      db.exec("BEGIN");
      try { for (const stmt of stmts) await stmt.run(); db.exec("COMMIT"); }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  for (const id of ["a", "b"]) {
    db.prepare("INSERT INTO users(id,email) VALUES (?,?)").run(id, id + "@example.com");
    db.prepare("INSERT INTO otp_challenges(email,code_hash) VALUES (?,?)").run(id + "@example.com", "otp");
    db.prepare("INSERT INTO sessions(id,user_id,email,ip) VALUES (?,?,?,?)").run("session-" + id, id, id + "@example.com", "192.0.2.1");
    for (const table of ["user_prefs", "user_rev"]) db.prepare("INSERT INTO " + table + "(user_id) VALUES (?)").run(id);
    for (const table of ["user_reads", "user_favorites"]) db.prepare("INSERT INTO " + table + "(user_id,event_id) VALUES (?,?)").run(id, "event");
    db.prepare("INSERT INTO user_feedback(id,user_id) VALUES (?,?)").run("feedback-" + id, id);
  }
  db.prepare("INSERT INTO rate_limits(key,count) VALUES (?,?)").run("email-d:a@example.com:123", 5);
  return { db, store: createD1Store(adapter) };
}

test("account deletion atomically removes owned data and session PII, preserves other users and abuse counters", async (t) => {
  const fixture = await sqliteFixture(t); if (!fixture) return;
  const { db, store } = fixture;
  await store.deleteUserData("a");
  for (const table of ["user_prefs", "user_reads", "user_favorites", "user_feedback", "user_rev", "sessions"]) {
    assert.deepEqual(db.prepare("SELECT user_id FROM " + table).all().map(r => r.user_id), ["b"], table);
  }
  assert.deepEqual(db.prepare("SELECT id FROM users").all().map(r => r.id), ["b"]);
  assert.deepEqual(db.prepare("SELECT email FROM otp_challenges").all().map(r => r.email), ["b@example.com"]);
  assert.equal(db.prepare("SELECT count FROM rate_limits").get().count, 5);
  await store.deleteUserData("a"); // Idempotent retry.
});

test("failed account deletion rolls back all preceding cleanup", async (t) => {
  const fixture = await sqliteFixture(t, "DELETE FROM user_favorites"); if (!fixture) return;
  const { db, store } = fixture;
  await assert.rejects(store.deleteUserData("a"), /injected delete failure/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM otp_challenges").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_reads").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 2);
});

test("memory account deletion removes credentials and allows a fresh identity for the same email", async () => {
  const store = createMemoryStore();
  const email = "delete@example.com";
  const otp = await requestCode(store, { email, ip: "192.0.2.1" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const auth = await verifyCode(store, { email, code: otp.debugCode });
  const oldId = auth.user.id;
  await store.putOtp({ email, codeHash: "pending" });
  store.tables.userRev.set(oldId, 8);
  await store.deleteUserData(oldId);
  assert.equal(await store.getUser(oldId), null);
  assert.equal(await store.getOtp(email), null);
  assert.equal(store.tables.sessions.size, 0);
  assert.equal(store.tables.userRev.has(oldId), false);
  assert.equal(await loadSession(store, auth.token), null);
  const next = await requestCode(store, { email, ip: "192.0.2.1" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const fresh = await verifyCode(store, { email, code: next.debugCode });
  assert.equal(fresh.ok, true);
  assert.notEqual(fresh.user.id, oldId);
});
