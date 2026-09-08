import { test } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/store/memory.js";
import { handleApi } from "../src/api/handlers.js";
import { requestCode, verifyCode } from "../src/auth.js";

function envWith(store, extra = {}) {
  return { store, requireAuth: false, cookieSecure: false, mailDriver: "log", ...extra };
}

async function jsonReq(store, path, { method = "GET", body, headers = {}, extra = {} } = {}) {
  const req = new Request("http://127.0.0.1" + path, {
    method,
    headers: { accept: "application/json", ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  return handleApi(req, envWith(store, extra));
}

test("otp request does not reveal whether an email is registered", async () => {
  const store = createMemoryStore();
  const a = await jsonReq(store, "/api/v1/auth/request-code", {
    method: "POST",
    body: { email: "one@example.com" },
    extra: { authMode: "otp" },
  });
  const b = await jsonReq(store, "/api/v1/auth/request-code", {
    method: "POST",
    body: { email: "two@example.com" },
    extra: { authMode: "otp" },
  });
  const ja = await a.json();
  const jb = await b.json();
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(ja.ok, true);
  assert.equal(jb.ok, true);
  assert.equal(ja.debugCode, undefined);
});

test("verify creates a user and isolates favorites", async () => {
  const store = createMemoryStore();
  store.authPepper = "test-pepper";
  const first = await requestCode(store, { email: "a@example.com", ip: "1.1.1.1" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const second = await requestCode(store, { email: "b@example.com", ip: "1.1.1.2" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const va = await verifyCode(store, { email: "a@example.com", code: first.debugCode });
  const vb = await verifyCode(store, { email: "b@example.com", code: second.debugCode });
  assert.equal(va.ok, true);
  assert.equal(vb.ok, true);
  await store.putEvent({ id: "evt:1", title: "Hello", titleZh: "你好", source: "hn", category: "tech" });
  const postA = await jsonReq(store, "/api/v1/favorites", {
    method: "POST",
    body: { eventId: "evt:1" },
    headers: { authorization: "Bearer " + va.token },
    extra: { authMode: "otp" },
  });
  assert.equal(postA.status, 200);
  const listB = await jsonReq(store, "/api/v1/favorites", {
    headers: { authorization: "Bearer " + vb.token },
    extra: { authMode: "otp" },
  });
  const jb = await listB.json();
  assert.equal(jb.items.length, 0);
  const listA = await jsonReq(store, "/api/v1/favorites", {
    headers: { authorization: "Bearer " + va.token },
    extra: { authMode: "otp" },
  });
  const ja = await listA.json();
  assert.equal(ja.items.length, 1);
});

test("wrong code and reuse fail; news stays public", async () => {
  const store = createMemoryStore();
  await store.putEvent({ id: "evt:p", title: "Public", source: "hn", category: "tech" });
  const news = await jsonReq(store, "/api/v1/events?view=latest", { extra: { authMode: "otp" } });
  assert.equal(news.status, 200);
  const sent = await requestCode(store, { email: "c@example.com", ip: "2.2.2.2" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const bad = await verifyCode(store, { email: "c@example.com", code: "000000" });
  assert.equal(bad.ok, false);
  const good = await verifyCode(store, { email: "c@example.com", code: sent.debugCode });
  assert.equal(good.ok, true);
  const reuse = await verifyCode(store, { email: "c@example.com", code: sent.debugCode });
  assert.equal(reuse.ok, false);
  const priv = await jsonReq(store, "/api/v1/favorites", { extra: { authMode: "otp" } });
  assert.equal(priv.status, 401);
});

test("merge guest favorites after login does not resurrect deletes", async () => {
  const store = createMemoryStore();
  const sent = await requestCode(store, { email: "d@example.com", ip: "3.3.3.3" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const v = await verifyCode(store, { email: "d@example.com", code: sent.debugCode });
  await store.putEvent({ id: "evt:keep", title: "Keep", source: "hn" });
  await store.putEvent({ id: "evt:drop", title: "Drop", source: "hn" });
  const merge = await jsonReq(store, "/api/v1/sync/merge", {
    method: "POST",
    headers: { authorization: "Bearer " + v.token },
    extra: { authMode: "otp" },
    body: {
      favorites: [
        { id: "evt:keep", snapshot: { id: "evt:keep", title: "Keep" } },
        { id: "evt:drop", snapshot: { id: "evt:drop", title: "Drop" } },
      ],
    },
  });
  assert.equal(merge.status, 200);
  await jsonReq(store, "/api/v1/favorites/evt:drop", {
    method: "DELETE",
    headers: { authorization: "Bearer " + v.token },
    extra: { authMode: "otp" },
  });
  const again = await jsonReq(store, "/api/v1/sync/merge", {
    method: "POST",
    headers: { authorization: "Bearer " + v.token },
    extra: { authMode: "otp" },
    body: {
      favorites: [{ id: "evt:drop", snapshot: { id: "evt:drop", title: "Drop" } }],
    },
  });
  assert.equal(again.status, 200);
  const list = await jsonReq(store, "/api/v1/favorites", {
    headers: { authorization: "Bearer " + v.token },
    extra: { authMode: "otp" },
  });
  const items = (await list.json()).items.map((it) => it.id || it.eventId);
  assert.equal(items.includes("evt:drop"), false);
  assert.equal(items.includes("evt:keep"), true);
});
