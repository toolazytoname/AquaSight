import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { requestCode, verifyCode } from "../src/auth.js";

// 个人资料库：readerTags/readerNote 只存在于账户 favorite snapshot，
// canonical 字段始终以服务器为准，个人字段可显式更新与清空。

function envWith(store, extra = {}) {
  return { store, requireAuth: false, ...extra };
}

async function post(store, path, body, extra = {}) {
  return handleApi(new Request("http://127.0.0.1" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), envWith(store, extra));
}

async function get(store, path) {
  return handleApi(new Request("http://127.0.0.1" + path), envWith(store));
}

const CANONICAL = {
  id: "evt:lib-1",
  title: "Canonical title",
  source: "hn",
  url: "https://example.com/a",
  summary: "server summary",
};

test("POST favorite applies personal fields; canonical fields stay authoritative", async () => {
  const store = createMemoryStore();
  await store.putEvent(CANONICAL);
  const res = await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: {
      ...CANONICAL,
      title: "Tampered title",
      readerTags: ["rust", "db"],
      readerNote: "want to read later",
    },
  });
  assert.equal(res.status, 200);
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.equal(favs.items.length, 1);
  const item = favs.items[0];
  assert.equal(item.title, "Canonical title", "canonical title must win");
  assert.deepEqual(item.readerTags, ["rust", "db"]);
  assert.equal(item.readerNote, "want to read later");
});

test("re-POST without personal keys preserves existing tags/note", async () => {
  const store = createMemoryStore();
  await store.putEvent(CANONICAL);
  await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerTags: ["ai"], readerNote: "note v1" },
  });
  await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { id: "evt:lib-1", title: "Canonical title" },
  });
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.deepEqual(favs.items[0].readerTags, ["ai"]);
  assert.equal(favs.items[0].readerNote, "note v1");
});

test("explicit empty values clear tags and note", async () => {
  const store = createMemoryStore();
  await store.putEvent(CANONICAL);
  await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerTags: ["ai"], readerNote: "note" },
  });
  await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerTags: [], readerNote: "" },
  });
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.deepEqual(favs.items[0].readerTags, []);
  assert.equal(favs.items[0].readerNote, "");
});

test("personal-link snapshots save without a canonical event and stay out of the public feed", async () => {
  const store = createMemoryStore();
  const personal = {
    id: "pl-abc123",
    title: "My saved link",
    url: "https://example.com/page",
    source: "import",
    kind: "personal-link",
    readerTags: ["todo"],
    readerNote: "private note",
  };
  const res = await post(store, "/api/v1/favorites", { eventId: personal.id, snapshot: personal });
  assert.equal(res.status, 200);
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.equal(favs.items.length, 1);
  assert.equal(favs.items[0].kind, "personal-link");

  // Public feed list must not contain the private link or any personal fields.
  await store.putEvent(CANONICAL);
  const list = await (await get(store, "/api/v1/events?view=featured")).json();
  assert.ok(list.items.every((it) => it.id !== "pl-abc123"));
  assert.ok(list.items.every((it) => !("readerNote" in it) && !("readerTags" in it)));
});

test("invalid personal field types are rejected", async () => {
  const store = createMemoryStore();
  await store.putEvent(CANONICAL);
  const bad1 = await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerTags: "not-an-array" },
  });
  assert.equal(bad1.status, 400);
  const bad2 = await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerNote: 123 },
  });
  assert.equal(bad2.status, 400);
  const bad3 = await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerTags: Array.from({ length: 13 }, (_, i) => "t" + i) },
  });
  assert.equal(bad3.status, 400);
});

test("favorites search matches personal note and tags", async () => {
  const store = createMemoryStore();
  const personal = {
    id: "pl-search",
    title: "Quiet title",
    url: "https://example.com/q",
    source: "import",
    kind: "personal-link",
    readerTags: ["zig"],
    readerNote: "performance benchmark",
  };
  await post(store, "/api/v1/favorites", { eventId: personal.id, snapshot: personal });
  const byNote = await (await get(store, "/api/v1/favorites?q=benchmark")).json();
  assert.equal(byNote.items.length, 1);
  const byTag = await (await get(store, "/api/v1/favorites?q=zig")).json();
  assert.equal(byTag.items.length, 1);
  const byTagMiss = await (await get(store, "/api/v1/favorites?q=nothing-matches")).json();
  assert.equal(byTagMiss.items.length, 0);
});

test("guest merge transfer carries personal fields into the account library", async () => {
  const store = createMemoryStore();
  // Real user identity: merge requires auth.userId (only the account's own
  // library may receive guest data).
  const sent = await requestCode(store, { email: "lib@example.com", ip: "8.8.8.8" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const v = await verifyCode(store, { email: "lib@example.com", code: sent.debugCode });
  const headers = { authorization: "Bearer " + v.token, "content-type": "application/json" };
  const guest = {
    id: "pl-merge1",
    title: "Guest link",
    url: "https://example.com/guest",
    source: "import",
    kind: "personal-link",
    readerTags: ["inbox"],
    readerNote: "from phone",
  };
  const merge = await handleApi(new Request("http://127.0.0.1/api/v1/sync/merge", {
    method: "POST",
    headers,
    body: JSON.stringify({ reads: {}, favorites: [{ id: guest.id, snapshot: guest }] }),
  }), { store, requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp" });
  assert.equal(merge.status, 200);
  const favs = await (await handleApi(
    new Request("http://127.0.0.1/api/v1/favorites", { headers }),
    { store, requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp" }
  )).json();
  const found = favs.items.find((it) => it.id === "pl-merge1");
  assert.ok(found, "merged favorite exists");
  assert.deepEqual(found.readerTags, ["inbox"]);
  assert.equal(found.readerNote, "from phone");
});

test("legacy favorites without personal fields keep working", async () => {
  const store = createMemoryStore();
  await store.putEvent(CANONICAL);
  await post(store, "/api/v1/favorites", { eventId: "evt:lib-1", snapshot: CANONICAL });
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.equal(favs.items[0].title, "Canonical title");
  assert.ok(!("readerNote" in favs.items[0]) || favs.items[0].readerNote === undefined);
});

// ---- 集中返工新增：个人链接更新语义 / 校验 / 隔离 / 公共路径保护 ----

test("re-saving a personal link updates title/excerpt/url but keeps id stable", async () => {
  const store = createMemoryStore();
  const v1 = {
    id: "pl-re", title: "v1 title", url: "https://example.com/re",
    source: "import", kind: "personal-link", summary: "old excerpt",
    readerTags: ["t1"], readerNote: "n1",
  };
  await post(store, "/api/v1/favorites", { eventId: v1.id, snapshot: v1 });
  const v2 = {
    id: "pl-re", title: "v2 title", url: "https://example.com/re-v2",
    source: "import", kind: "personal-link", summary: "new excerpt",
  };
  const res = await post(store, "/api/v1/favorites", { eventId: v2.id, snapshot: v2 });
  assert.equal(res.status, 200);
  const favs = await (await get(store, "/api/v1/favorites")).json();
  assert.equal(favs.items.length, 1, "same id must update in place, not duplicate");
  assert.equal(favs.items[0].title, "v2 title");
  assert.equal(favs.items[0].summary, "new excerpt");
  assert.equal(favs.items[0].url, "https://example.com/re-v2");
  assert.deepEqual(favs.items[0].readerTags, ["t1"], "absent personal keys preserve");
  assert.equal(favs.items[0].readerNote, "n1");
});

test("mismatched eventId/snapshot.id and invalid personal-link shapes are rejected", async () => {
  const store = createMemoryStore();
  const r1 = await post(store, "/api/v1/favorites", {
    eventId: "pl-x", snapshot: { id: "pl-y", kind: "personal-link", title: "t", url: "https://e.com/a", source: "import" },
  });
  assert.equal(r1.status, 400);
  const r2 = await post(store, "/api/v1/favorites", {
    eventId: "pl-x", snapshot: { id: "pl-x", kind: "personal-link", title: "t", url: "javascript:alert(1)", source: "import" },
  });
  assert.equal(r2.status, 400);
  const r3 = await post(store, "/api/v1/favorites", {
    eventId: "pl-x", snapshot: { id: "pl-x", kind: "personal-link", url: "https://e.com/a", source: "import" },
  });
  assert.equal(r3.status, 400, "missing title rejected");
  const r4 = await post(store, "/api/v1/favorites", {
    eventId: "pl-x", snapshot: { id: "pl-x", kind: "weird", title: "t", url: "https://e.com/a", source: "import" },
  });
  assert.equal(r4.status, 200, "non personal-link snapshots without canonical are stored as-is");
});

test("guest merge rejects invalid personal fields before writing anything", async () => {
  const store = createMemoryStore();
  const sent = await requestCode(store, { email: "merge2@example.com", ip: "8.8.8.8" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const v = await verifyCode(store, { email: "merge2@example.com", code: sent.debugCode });
  const env = { store, requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp" };
  const headers = { authorization: "Bearer " + v.token, "content-type": "application/json" };
  const bad = await handleApi(new Request("http://127.0.0.1/api/v1/sync/merge", {
    method: "POST", headers,
    body: JSON.stringify({
      reads: {},
      favorites: [
        { id: "pl-ok", snapshot: { id: "pl-ok", kind: "personal-link", title: "ok", url: "https://e.com/ok", source: "import" } },
        { id: "pl-bad", snapshot: { id: "pl-bad", kind: "personal-link", title: "bad", url: "https://e.com/bad", source: "import", readerTags: "oops" } },
      ],
    }),
  }), env);
  assert.equal(bad.status, 400);
  const favs = await (await handleApi(new Request("http://127.0.0.1/api/v1/favorites", { headers }), env)).json();
  assert.equal(favs.items.length, 0, "batch validated pre-write: nothing applied");
});

test("merge updates only personal fields on an existing canonical favorite", async () => {
  const store = createMemoryStore();
  const sent = await requestCode(store, { email: "merge3@example.com", ip: "8.8.8.8" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const v = await verifyCode(store, { email: "merge3@example.com", code: sent.debugCode });
  const env = { store, requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp" };
  const headers = { authorization: "Bearer " + v.token, "content-type": "application/json" };
  await store.putEvent(CANONICAL);
  await handleApi(new Request("http://127.0.0.1/api/v1/favorites", {
    method: "POST", headers,
    body: JSON.stringify({ eventId: "evt:lib-1", snapshot: { ...CANONICAL, readerTags: ["keep"], readerNote: "keep-note" } }),
  }), env);
  await handleApi(new Request("http://127.0.0.1/api/v1/sync/merge", {
    method: "POST", headers,
    body: JSON.stringify({ reads: {}, favorites: [{ id: "evt:lib-1", snapshot: { ...CANONICAL, title: "Merge Title", readerTags: [] } }] }),
  }), env);
  const favs = await (await handleApi(new Request("http://127.0.0.1/api/v1/favorites", { headers }), env)).json();
  const row = favs.items.find((it) => it.id === "evt:lib-1");
  assert.equal(row.title, "Canonical title", "merge must not clobber canonical content");
  assert.deepEqual(row.readerTags, [], "explicit clear wins");
  assert.equal(row.readerNote, "keep-note", "absent key preserved");
});

test("public event detail never exposes personal fields even when a favorite carries them", async () => {
  const store = createMemoryStore();
  await store.putEvent(CANONICAL);
  await post(store, "/api/v1/favorites", {
    eventId: "evt:lib-1",
    snapshot: { ...CANONICAL, readerTags: ["secret-tag"], readerNote: "secret note" },
  });
  const detail = await (await get(store, "/api/v1/events/evt%3Alib-1")).json();
  assert.equal(detail.item.title, "Canonical title");
  assert.ok(!("readerNote" in detail.item) && !("readerTags" in detail.item), "canonical path strips personal fields");
  const list = await (await get(store, "/api/v1/events?view=featured")).json();
  assert.ok(list.items.every((it) => !("readerNote" in it) && !("readerTags" in it)));
  // Public q does not match private notes.
  const leak = await (await get(store, "/api/v1/events?view=featured&q=secret")).json();
  assert.equal(leak.items.length, 0);
});

test("account isolation: another user's library does not leak", async () => {
  const store = createMemoryStore();
  const sent = await requestCode(store, { email: "iso@example.com", ip: "8.8.8.8" }, { exposeOtp: true, MAIL_DRIVER: "log" });
  const v = await verifyCode(store, { email: "iso@example.com", code: sent.debugCode });
  const env = { store, requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp" };
  const headers = { authorization: "Bearer " + v.token, "content-type": "application/json" };
  const mine = { id: "pl-iso", kind: "personal-link", title: "Mine", url: "https://e.com/mine", source: "import", readerNote: "private" };
  await handleApi(new Request("http://127.0.0.1/api/v1/favorites", {
    method: "POST", headers, body: JSON.stringify({ eventId: mine.id, snapshot: mine }),
  }), env);
  // Anonymous/local scope must not see the logged-in user's item.
  const anon = await (await get(store, "/api/v1/favorites")).json();
  assert.equal(anon.items.filter((it) => it.id === "pl-iso").length, 0);
  const other = await (await handleApi(new Request("http://127.0.0.1/api/v1/favorites", { headers }), env)).json();
  assert.equal(other.items.filter((it) => it.id === "pl-iso").length, 1);
});

// ---- 跨端 URL 规范向量（与 iOS PersonalLibraryTests 完全一致）----

test("shared URL normalization vectors (mirrors iOS PersonalLibraryTests)", async () => {
  const { normalizePersonalUrl } = await import("../web/urlnorm.js");
  const vectors = [
    ["https://example.com/📚?q=📖", "https://example.com/%F0%9F%93%9A?q=%F0%9F%93%96"],
    ["HTTPS://Example.COM:443/a/../b/%2F?query=a%2Fb#frag", "https://example.com/b/%2F?query=a%2Fb"],
    ["https://example.com", "https://example.com"],
    ["https://example.com/", "https://example.com"],
    ["https://example.com/a/", "https://example.com/a"],
    ["https://example.com:443/x", "https://example.com/x"],
    ["http://example.com:80/x", "http://example.com/x"],
    ["https://example.com:8443/x", "https://example.com:8443/x"],
    ["https://example.com/a#frag", "https://example.com/a"],
    ["https://example.com/a%2Fb?q=a%2Fb", "https://example.com/a%2Fb?q=a%2Fb"],
    ["https://example.com/a/../../b", "https://example.com/b"],
    ["https://[2001:DB8::1]:8443/x y", "https://[2001:db8::1]:8443/x%20y"],
    ["https://例え.jp/引数/", "https://%E4%BE%8B%E3%81%88.jp/%E5%BC%95%E6%95%B0"],
    ["https://example.com/中文?q=关键词", "https://example.com/%E4%B8%AD%E6%96%87?q=%E5%85%B3%E9%94%AE%E8%AF%8D"],
    ["https://example.com/%2e%2e/x", "https://example.com/%2E%2E/x"],
  ];
  for (const [input, expected] of vectors) {
    assert.equal(normalizePersonalUrl(input), expected, `vector ${input}`);
  }
  // Rejections both sides agree on.
  for (const bad of ["javascript:alert(1)", "ftp://e.com/x", "not a url", "https://user:pass@example.com/", "https://e.com:99999/x"]) {
    assert.equal(normalizePersonalUrl(bad), null, `reject ${bad}`);
  }
});
