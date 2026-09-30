import { test } from "node:test";
import assert from "node:assert/strict";
import { handleApi } from "../src/api/handlers.js";
import { createMemoryStore } from "../src/store/memory.js";
import { requestCode, verifyCode } from "../src/auth.js";
import { isPublicApi } from "../src/access.js";
import {
  readerCatalog,
  readerAllowed,
  READER_BASIC_SOURCES,
  effectiveSources,
  normalizeReader,
  sortReaderItems,
} from "../src/reader.js";

const OTP_ENV = { requireAuth: false, cookieSecure: false, mailDriver: "log", authMode: "otp", exposeOtp: true };

async function makeUser(store, email) {
  const sent = await requestCode(store, { email, ip: "192.0.2.9" }, OTP_ENV);
  const v = await verifyCode(store, { email, code: sent.debugCode });
  assert.ok(v.token, "verify must succeed in test env");
  return v.token;
}

const authHeaders = (token) => ({
  authorization: "Bearer " + token,
  "content-type": "application/json",
});

async function call(store, path, opts = {}, env = {}) {
  return handleApi(new Request("http://127.0.0.1" + path, opts), { store, ...OTP_ENV, ...env });
}

// 动态时间：相对“现在”偏移小时，避免历史硬编码种子被精选 48h 窗口等
// 旧逻辑过滤；value/level 给足让旧 featured/latest 视图也可用。
const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();

async function seedEvents(store) {
  const mk = (over) => ({
    title: over.id,
    category: "tech",
    level: "normal",
    value: 0.7,
    score: 7,
    ...over,
    id: "evt:" + over.id,
    url: over.url === undefined ? "https://example.com/" + over.id : over.url,
  });
  await store.putEvent(mk({ id: "r1", source: "github", publishedAt: hoursAgo(48) }));
  await store.putEvent(mk({ id: "r2", source: "openai", publishedAt: hoursAgo(36) }));
  await store.putEvent(mk({ id: "r3", source: "hn", publishedAt: hoursAgo(24) }));
  await store.putEvent(mk({ id: "r4", source: "bbc", publishedAt: hoursAgo(20) }));
  // 未选来源（bbc）出现在 sources 数组里，不能借道聚类的 primary=github 事件混入判定；
  // 该事件 primary=github 本身允许，仅验证 secondary 不参与过滤。
  await store.putEvent(mk({
    id: "r5", source: "github", publishedAt: hoursAgo(12),
    sources: [{ source: "bbc", url: "https://bbc.example/x", title: "bbc" }],
  }));
  // 无 http(s) 原文：即使来源已选也不返回。
  await store.putEvent(mk({ id: "r6", source: "github", url: "javascript:alert(1)", publishedAt: hoursAgo(6) }));
  await store.putEvent(mk({ id: "r7", source: "github", url: "", publishedAt: hoursAgo(4) }));
  // 带嵌入凭据的链接同样不安全。
  await store.putEvent(mk({ id: "r8", source: "github", url: "https://user:pass@example.com/r8", publishedAt: hoursAgo(2) }));
  // hidden 类内容不进订阅流。
  await store.putEvent(mk({ id: "r9", source: "github", category: "hidden", publishedAt: hoursAgo(1) }));
  // 老视图使用的非订阅来源条目。
  await store.putEvent(mk({ id: "old1", source: "weibo", publishedAt: hoursAgo(3) }));
}

/* ---------- 目录与访问策略 ---------- */

test("reader catalog: basic set first, exclusions, fields", () => {
  const catalog = readerCatalog();
  const ids = catalog.map((s) => s.id);
  assert.deepEqual(ids.slice(0, READER_BASIC_SOURCES.length), READER_BASIC_SOURCES);
  for (const banned of ["x", "import", "weibo", "baidu", "toutiao", "hot"]) {
    assert.ok(!ids.includes(banned), banned + " must not be subscribable");
  }
  for (const s of catalog) {
    assert.equal(typeof s.id, "string");
    assert.equal(typeof s.label, "string");
    assert.equal(typeof s.description, "string");
    assert.equal(typeof s.group, "string");
    assert.equal(typeof s.extended, "boolean");
  }
  assert.equal(catalog.find((s) => s.id === "github").extended, false);
  assert.equal(catalog.find((s) => s.id === "bbc").extended, true);
});

test("public GET reader routes, non-public PUT", () => {
  assert.equal(isPublicApi("GET", "/api/v1/reader/catalog"), true);
  assert.equal(isPublicApi("GET", "/api/v1/reader/settings"), true);
  assert.equal(isPublicApi("PUT", "/api/v1/reader/settings"), false);
  assert.equal(isPublicApi("POST", "/api/v1/reader/settings"), false);
});

test("reader settings GET is public (incl. OTP mode) and defaults are conservative", async () => {
  const store = createMemoryStore();
  // OTP 生产模式下未登录 GET 也必须 200（公开读，返回默认值）。
  const res = await call(store, "/api/v1/reader/settings");
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.reader, { selectedSources: [], moreSourcesEnabled: false, configured: false });
  const cat = await call(store, "/api/v1/reader/catalog");
  assert.equal(cat.status, 200);
  assert.ok((await cat.json()).sources.length >= READER_BASIC_SOURCES.length);
});

/* ---------- 写入鉴权与校验 ---------- */

test("guest and local cannot PUT reader settings", async () => {
  const store = createMemoryStore();
  const guest = await call(store, "/api/v1/reader/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ selectedSources: ["github"] }),
  });
  assert.equal(guest.status, 401);

  // 无 OTP 配置的本地开发环境（role=local，userId 为空）同样拒绝：
  const local = await handleApi(
    new Request("http://127.0.0.1/api/v1/reader/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ selectedSources: ["github"] }),
    }),
    { store, requireAuth: false }
  );
  assert.equal(local.status, 401);
});

test("PUT validates types, strings and whitelist; partial update keeps missing fields", async () => {
  const store = createMemoryStore();
  const token = await makeUser(store, "reader-a@example.com");

  const badArray = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: "github" }),
  });
  assert.equal(badArray.status, 400);

  // 非字符串元素（对象/数字）必须 400，不允许 String() 变形混入。
  const badElement = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["github", { toString: () => "openai" }] }),
  });
  assert.equal(badElement.status, 400);
  const badNumber = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: [42] }),
  });
  assert.equal(badNumber.status, 400);

  const badId = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["weibo"] }),
  });
  assert.equal(badId.status, 400);

  const badBool = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ moreSourcesEnabled: "yes" }),
  });
  assert.equal(badBool.status, 400);

  // 先选基础来源，再只补开关：selectedSources 必须保留。
  const first = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["github", "openai"] }),
  });
  assert.equal(first.status, 200);
  assert.deepEqual((await first.json()).reader, {
    selectedSources: ["github", "openai"], moreSourcesEnabled: false, configured: true,
  });

  const second = await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ moreSourcesEnabled: true }),
  });
  const reader = (await second.json()).reader;
  assert.deepEqual(reader.selectedSources, ["github", "openai"]);
  assert.equal(reader.moreSourcesEnabled, true);
  assert.equal(reader.configured, true);
});

test("reader prefs are per-account isolated", async () => {
  const store = createMemoryStore();
  const a = await makeUser(store, "iso-a@example.com");
  const b = await makeUser(store, "iso-b@example.com");
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(a), body: JSON.stringify({ selectedSources: ["github"] }),
  });
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(b), body: JSON.stringify({ selectedSources: ["openai"], moreSourcesEnabled: true }),
  });
  const ra = await (await call(store, "/api/v1/reader/settings", { headers: authHeaders(a) })).json();
  const rb = await (await call(store, "/api/v1/reader/settings", { headers: authHeaders(b) })).json();
  assert.deepEqual(ra.reader.selectedSources, ["github"]);
  assert.equal(ra.reader.moreSourcesEnabled, false);
  assert.deepEqual(rb.reader.selectedSources, ["openai"]);
  assert.equal(rb.reader.moreSourcesEnabled, true);
});

/* ---------- view=reader 过滤 ---------- */

test("logged-in reader view filters by effective sources, requires safe http(s) URL, sorts newest first", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "view1@example.com");
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["github", "openai"] }),
  });
  const res = await call(store, "/api/v1/events?view=reader&limit=10", { headers: authHeaders(token) });
  assert.equal(res.status, 200);
  const data = await res.json();
  // r5(12h) > r2(36h) > r1(48h)；r6/r7 无安全链接、r8 带凭据、r9 hidden 全部剔除。
  assert.deepEqual(data.items.map((it) => it.id), ["evt:r5", "evt:r2", "evt:r1"]);
  for (const it of data.items) {
    assert.match(it.url, /^https?:\/\//);
    assert.ok(!it.url.includes("@"));
    assert.notEqual(it.category, "hidden");
  }
});

test("empty selection means empty result, never a full-site fallback", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "empty@example.com");
  const res = await call(store, "/api/v1/events?view=reader", { headers: authHeaders(token) });
  const data = await res.json();
  assert.deepEqual(data.items, []);
  assert.equal(data.total, 0);
});

test("guest reader view: sources query limited to basic set, default empty", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  // 本地开发 env（无 OTP 头）→ guest 路径。
  const guestEnv = { store, requireAuth: false };
  const empty = await handleApi(new Request("http://127.0.0.1/api/v1/events?view=reader"), guestEnv);
  assert.deepEqual((await empty.json()).items, []);

  const basicOnly = await handleApi(
    new Request("http://127.0.0.1/api/v1/events?view=reader&sources=github,openai,hn,bbc"), guestEnv
  );
  const data = await basicOnly.json();
  // hn/bbc 是扩展来源，游客不带登录不能用；openai/github 属基础集。
  assert.deepEqual(data.items.map((it) => it.id), ["evt:r5", "evt:r2", "evt:r1"]);
});

test("moreSourcesEnabled=false keeps stored extended picks but filters them out", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "more@example.com");
  // 选 hn（扩展）+ github（基础），先开启扩展保存。
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token),
    body: JSON.stringify({ selectedSources: ["github", "hn"], moreSourcesEnabled: true }),
  });
  const on = await (await call(store, "/api/v1/events?view=reader", { headers: authHeaders(token) })).json();
  assert.deepEqual(on.items.map((it) => it.id), ["evt:r5", "evt:r3", "evt:r1"]);

  // 关闭更多来源：选择保留在存储里，但过滤后不再出现 hn。
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ moreSourcesEnabled: false }),
  });
  const off = await (await call(store, "/api/v1/events?view=reader", { headers: authHeaders(token) })).json();
  assert.deepEqual(off.items.map((it) => it.id), ["evt:r5", "evt:r1"]);
  const stored = await (await call(store, "/api/v1/reader/settings", { headers: authHeaders(token) })).json();
  assert.deepEqual(stored.reader.selectedSources, ["github", "hn"], "stored selection must survive toggle-off");
});

test("reader view ignores legacy blockedSources; legacy views keep applying it", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "blockreg@example.com");
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["github", "openai"] }),
  });
  // 旧设置屏蔽 github：订阅流不受影响（独立的来源选择字段）。
  await call(store, "/api/v1/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ blockedSources: ["github"] }),
  });
  const readerView = await (await call(store, "/api/v1/events?view=reader", { headers: authHeaders(token) })).json();
  assert.deepEqual(readerView.items.map((it) => it.id), ["evt:r5", "evt:r2", "evt:r1"]);
  // 旧 featured/latest 仍按旧规则过滤 blockedSources。
  const latest = await (await call(store, "/api/v1/events?view=latest", { headers: authHeaders(token) })).json();
  assert.ok(!latest.items.some((it) => it.source === "github"), "legacy latest must keep blockedSources filter");
});

test("reader view pagination happens after filtering", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "page@example.com");
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token),
    body: JSON.stringify({ selectedSources: ["github", "openai", "huggingface"] }),
  });
  const p1 = await (await call(store, "/api/v1/events?view=reader&limit=2", { headers: authHeaders(token) })).json();
  assert.equal(p1.items.length, 2);
  assert.equal(p1.total, 3, "total counts filtered set, not all events");
  assert.ok(p1.cursor);
  const p2 = await (await call(store, "/api/v1/events?view=reader&limit=2&cursor=" + encodeURIComponent(p1.cursor), { headers: authHeaders(token) })).json();
  const ids = [...p1.items, ...p2.items].map((it) => it.id);
  assert.deepEqual(ids, ["evt:r5", "evt:r2", "evt:r1"]);
});

/* ---------- 详情 reader 模式与旧 API 兼容 ---------- */

test("detail reader=1 enforces the same set; own favorite stays readable, guest gets no favorite fallback", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "detail@example.com");
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["openai"] }),
  });
  const allowed = await call(store, "/api/v1/events/evt:r2?reader=1", { headers: authHeaders(token) });
  assert.equal(allowed.status, 200);

  const denied = await call(store, "/api/v1/events/evt:r1?reader=1", { headers: authHeaders(token) });
  assert.equal(denied.status, 404);

  // 自己收藏过的未选来源快照仍可读。
  await call(store, "/api/v1/favorites", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ eventId: "evt:r1", snapshot: { id: "evt:r1", title: "收藏副本", url: "https://example.com/r1", source: "github" } }),
  });
  const fav = await call(store, "/api/v1/events/evt:r1?reader=1", { headers: authHeaders(token) });
  assert.equal(fav.status, 200);
  const favData = await fav.json();
  assert.equal(favData.fromFavorite, true);

  // 游客（无登录）不能借站点全局 favorites 兜底读私人快照。
  const guestAsk = await call(store, "/api/v1/events/evt:r1?reader=1&sources=openai");
  assert.equal(guestAsk.status, 404);
  const localAsk = await handleApi(
    new Request("http://127.0.0.1/api/v1/events/evt:r1?reader=1"),
    { store, requireAuth: false }
  );
  assert.equal(localAsk.status, 404, "local role must not read global favorites via reader mode");

  // 无 reader 参数的旧详情不受影响。
  const legacy = await call(store, "/api/v1/events/evt:r1", { headers: authHeaders(token) });
  assert.equal(legacy.status, 200);
  const legacyNoAuth = await call(store, "/api/v1/events/evt:r1");
  assert.equal(legacyNoAuth.status, 200);
});

test("old channels cannot inject reader prefs: settings PUT and sync/merge strip reader", async () => {
  const store = createMemoryStore();
  const token = await makeUser(store, "bypass@example.com");

  await call(store, "/api/v1/settings", {
    method: "PUT", headers: authHeaders(token),
    body: JSON.stringify({ reader: { selectedSources: ["weibo"], configured: true } }),
  });
  const afterSettings = await (await call(store, "/api/v1/reader/settings", { headers: authHeaders(token) })).json();
  assert.equal(afterSettings.reader.configured, false, "settings PUT must not create reader config");
  assert.deepEqual(afterSettings.reader.selectedSources, []);

  await call(store, "/api/v1/sync/merge", {
    method: "POST", headers: authHeaders(token),
    body: JSON.stringify({ prefs: { reader: { selectedSources: ["bbc"], configured: true } } }),
  });
  const afterMerge = await (await call(store, "/api/v1/reader/settings", { headers: authHeaders(token) })).json();
  assert.equal(afterMerge.reader.configured, false, "merge must not inject reader config");
  assert.deepEqual(afterMerge.reader.selectedSources, []);
});

test("legacy views unchanged by reader settings", async () => {
  const store = createMemoryStore();
  await seedEvents(store);
  const token = await makeUser(store, "legacy@example.com");
  await call(store, "/api/v1/reader/settings", {
    method: "PUT", headers: authHeaders(token), body: JSON.stringify({ selectedSources: ["openai"] }),
  });
  const featured = await (await call(store, "/api/v1/events?view=featured", { headers: authHeaders(token) })).json();
  assert.ok(featured.items.length >= 1, "featured still serves all sources (recent seeds)");
  const latest = await (await call(store, "/api/v1/events?view=latest", {})).json();
  assert.ok(latest.items.some((it) => it.source !== "openai"), "latest unaffected by reader selection");
});

/* ---------- 纯函数行为 ---------- */

test("normalizeReader and effectiveSources unit behaviour", () => {
  assert.deepEqual(normalizeReader(null), { selectedSources: [], moreSourcesEnabled: false, configured: false });
  const dirty = normalizeReader({ selectedSources: ["github", "nope", "github", 42, { toString: () => "openai" }], moreSourcesEnabled: 1, configured: "x" });
  assert.deepEqual(dirty.selectedSources, ["github"], "non-string elements must be dropped");
  assert.equal(dirty.moreSourcesEnabled, false);
  const withMore = normalizeReader({ selectedSources: ["github", "hn"], moreSourcesEnabled: true, configured: true });
  assert.deepEqual([...effectiveSources(withMore)].sort(), ["github", "hn"]);
  const withoutMore = normalizeReader({ selectedSources: ["github", "hn"], moreSourcesEnabled: false, configured: true });
  assert.deepEqual([...effectiveSources(withoutMore)], ["github"]);
});

test("sortReaderItems: articles use publication, repos use observation, ties use id", () => {
  const tie = hoursAgo(24);
  const items = [
    { id: "old", source: "openai", publishedAt: hoursAgo(100), seenAt: hoursAgo(1) },
    { id: "c", source: "hn", publishedAt: tie },
    { id: "b", source: "hn", publishedAt: tie },
    { id: "repo", source: "github", githubRepo: { observedAt: hoursAgo(2) }, publishedAt: hoursAgo(200), seenAt: hoursAgo(1) },
  ];
  assert.deepEqual(sortReaderItems(items).map((it) => it.id), ["repo", "b", "c", "old"]);
});

test("reader rejects username-only embedded credentials", () => {
  assert.equal(readerAllowed({ source: "github", url: "https://user@example.com/project" }, new Set(["github"])), false);
});
