import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryStore } from "../src/store/memory.js";
import { loadFileStore } from "../src/store/file.js";
import { createD1Store } from "../src/store/d1.js";
import { requestCode, resetPassword, loginPassword, loadSession } from "../src/auth.js";
import { hashPassword, checkPassword } from "../src/password.js";
import { handleApi } from "../src/api/handlers.js";

const password = "Test-reader-long-2026!";
const email = "password-tests@example.com";
async function register(store, address = email) {
  const sent = await requestCode(store, { email: address, ip: "192.0.2.8" }, { MAIL_DRIVER: "log", exposeOtp: true });
  return resetPassword(store, { email: address, code: sent.debugCode, password, ip: "192.0.2.8" });
}

test("scrypt salts differ, verification rejects wrong password and malformed hashes", async () => {
  const a = await hashPassword(password), b = await hashPassword(password);
  assert.notEqual(a, b); assert.ok(!a.includes(password));
  assert.equal(await checkPassword(password, a), true);
  assert.equal(await checkPassword(password + "x", a), false);
  assert.equal(await checkPassword(password, "bad-hash"), false);
  await assert.rejects(hashPassword("short"), /invalid-password/);
});

test("verified registration, password login and reset invalidate both cookie and bearer sessions", async () => {
  const store = createMemoryStore();
  const account = await register(store); assert.equal(account.ok, true);
  const login = await loginPassword(store, { email: email.toUpperCase(), password });
  assert.equal(login.ok, true); assert.equal(login.user.id, account.user.id);
  await store.putFavorite("kept", { id: "kept", title: "Keep" }, { userId: account.user.id });
  await store.deleteOtp(email);
  const sent = await requestCode(store, { email, ip: "192.0.2.8" }, { MAIL_DRIVER: "log", exposeOtp: true });
  const changed = await resetPassword(store, { email, code: sent.debugCode, password: password + "new" });
  assert.equal(changed.ok, true); assert.equal(await loadSession(store, account.token), null);
  assert.equal(await loadSession(store, login.token), null);
  assert.ok(await loadSession(store, changed.token));
  assert.equal((await loginPassword(store, { email, password })).ok, false);
  assert.equal((await store.getFavorite("kept", { userId: account.user.id })).snapshot.title, "Keep");
  // A login that completed its hash before reset may insert late; its captured
  // credential version still cannot authorize after the reset.
  await store.putSession({ ...login.session, id: "late", tokenHash: login.session.tokenHash, revokedAt: "" });
  assert.equal(await loadSession(store, login.token), null);
  await store.deleteUserData(account.user.id);
  assert.equal(await store.getPasswordCredential(account.user.id), null);
  assert.equal(await loadSession(store, changed.token), null);
});

test("invalid/reused codes cannot set a password and login errors do not reveal account existence", async () => {
  const store = createMemoryStore(); const account = await register(store);
  assert.equal((await resetPassword(store, { email, code: "000000", password })).ok, false);
  const missing = await loginPassword(store, { email: "missing@example.com", password });
  const wrong = await loginPassword(store, { email, password: password + "wrong" });
  assert.deepEqual(missing, wrong);
  const dump = await store.exportUser(account.user.id);
  assert.ok(!JSON.stringify(dump).includes("scrypt-v1"));
  for (let i = 0; i < 10; i++) await store.bumpRate(`password-login:ip:limited:${Math.floor(Date.now()/900000)}`, 0);
  for (let i = 0; i < 31; i++) await store.bumpRate(`password-login:ip:limited:${Math.floor(Date.now()/900000)}`, 0);
  assert.equal((await loginPassword(store, { email, password, ip: "limited" })).error, "rate-limited");
});

test("file storage persists credentials, sessions, OTP consumption and per-account favorites", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aquasight-password-"));
  try {
    const file = join(dir, "store.json"); const first = await loadFileStore(file);
    const account = await register(first); assert.equal(account.ok, true);
    await first.putFavorite("web", { id: "web", title: "Web" }, { userId: account.user.id });
    const reopened = await loadFileStore(file);
    assert.ok(await loadSession(reopened, account.token));
    assert.equal(await reopened.getOtp(email), null);
    assert.equal((await reopened.getFavorite("web", { userId: account.user.id })).snapshot.title, "Web");
    await reopened.revokeUserSessions(account.user.id);
    assert.equal(await loadSession(await loadFileStore(file), account.token), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("password API issues shared web cookie/native bearer and rejects missing credentials", async () => {
  const store = createMemoryStore(); await register(store);
  const env = { store, authMode: "otp", cookieSecure: false };
  const response = await handleApi(new Request("http://localhost/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  for (const headers of [{ cookie: response.headers.get("set-cookie").split(";")[0] }, { authorization: "Bearer " + body.token }]) {
    const me = await handleApi(new Request("http://localhost/api/v1/me", { headers }), env);
    assert.equal((await me.json()).user.id, body.user.id);
  }
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
});

test("D1 password migration is repeatable and reset/deletion are transactional", async (t) => {
  let DatabaseSync;
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { t.skip("node:sqlite unavailable; CI runs Node 24"); return; }
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(await readFile(new URL("../worker/schema.sql", import.meta.url), "utf8"));
    const migration = await readFile(new URL("../worker/migrations/20260928_password_auth.sql", import.meta.url), "utf8");
    db.exec(migration); db.exec(migration);
    let fail = false;
    const store = createD1Store({ prepare(sql) {
      const stmt = db.prepare(sql); let args = [];
      const bound = { bind(...v) { args = v; return bound; }, async first() { return stmt.get(...args); }, async all() { return { results: stmt.all(...args) }; }, async run() {
        if (fail && sql.startsWith("UPDATE sessions SET revoked_at")) throw new Error("injected");
        const result = stmt.run(...args); return { meta: { changes: result.changes } };
      } }; return bound;
    }, async batch(stmts) { db.exec("BEGIN"); try { for (const stmt of stmts) await stmt.run(); db.exec("COMMIT"); } catch(e) { db.exec("ROLLBACK"); throw e; } } });
    const account = await register(store); assert.equal(account.ok, true);
    assert.ok(await loadSession(store, account.token));
    const before = await store.getPasswordCredential(account.user.id);
    fail = true; await assert.rejects(store.setPasswordCredential(account.user.id, "replacement")); fail = false;
    assert.deepEqual(await store.getPasswordCredential(account.user.id), before);
    assert.ok(await loadSession(store, account.token));
    await store.deleteUserData(account.user.id);
    assert.equal(db.prepare("SELECT count(*) n FROM password_credentials").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM session_auth_versions").get().n, 0);
  } finally { db.close(); }
});

test("failed mail invalidates undelivered challenge and retry cannot claim a phantom delivery", async () => {
  const store = createMemoryStore();
  const env = { MAIL_DRIVER:"resend", MAIL_API_KEY:"local-test-only", fetchImpl:async()=>{throw new Error("network down");} };
  const failed=await requestCode(store,{email,ip:"mail-test"},env);
  assert.equal(failed.mailError,true); assert.equal(await store.getOtp(email),null);
  const apiEnv={store,authMode:"otp",mailDriver:"log"};
  for(let i=0;i<2;i++) {
    const response=await handleApi(new Request("http://localhost/api/v1/auth/request-code",{method:"POST",body:JSON.stringify({email})}),apiEnv);
    assert.equal((await response.json()).delivery,"unavailable");
  }
});

test("password rate-limit buckets are purged with their 15-minute window", async () => {
  const store=createMemoryStore();const now=new Date();
  const old=`password-login:all:${Math.floor((now.getTime()-3*86400000)/900000)}`;
  const fresh=`password-login:all:${Math.floor(now.getTime()/900000)}`;
  await store.bumpRate(old,300);await store.bumpRate(fresh,300);
  await store.purgeAuthArtifacts(now);
  assert.equal(store.tables.rates.has(old),false);assert.equal(store.tables.rates.has(fresh),true);
});

test("foreign browser origins cannot create or replace a login session", async () => {
  const store=createMemoryStore();
  for(const endpoint of ["login","password-reset","request-code","verify"]) {
    const response=await handleApi(new Request("https://quack.weichao.ren/api/v1/auth/"+endpoint,{method:"POST",headers:{origin:"https://foreign.example"},body:JSON.stringify({email,password})}),{store,authMode:"otp"});
    assert.equal(response.status,403);assert.equal(response.headers.get("set-cookie"),null);
  }
});
