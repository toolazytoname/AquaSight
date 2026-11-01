import { createFavorites } from "./favorites.js";
import { t, lang, isZh, setLang, onLanguageChange, applyStaticI18n } from "./i18n.js";
import { personalLinkId, normalizePersonalUrl } from "./urlnorm.js";
import { isHiddenCard, visibleCards, TOPIC_FILTERS, SOURCE_FILTERS, sourceLabel, cardBody, readingMarks, countCoverage, digestDateLine, pickLead, isOpensourceItem, repoMeta, opensourceViewItems } from "./rules.js";
import { buildMergeBody } from "./guest-merge.js";

const state = {
  view: "featured",
  eventId: "",
  items: [],
  digest: null,
  digestSummary: "",
  cursor: null,
  snapshotAt: "",
  stale: false,
  cached: false,
  sourceHealth: [],
  reads: {},
  saved: new Set(),
  q: "",
  topic: "",
  source: "",
  unreadOnly: false,
  libraryTag: "",
  rated: {},
  scroll: {},
  prefs: {},
  hideUndo: null,
  detailItem: null,
  detailMembers: [],
  feed: "live",
  hiddenIds: new Set(),
  savedItems: {},
  user: null,
  budgetStatus: null,
  // 订阅阅读器：目录缓存、账户侧订阅（登录后从 /reader/settings 取）、
  // 详情是否走 reader 模式（#/event/<id>?reader=1 显式携带）。
  readerCatalog: null,
  readerAccount: null,
  detailReader: false,
  // 账户私有 RSS 源（登录后从 /api/v1/feeds 拉取；null=尚未加载，
  // 账户切换即重置，绝不让上一账户的源元数据泄给下一身份）。
  userFeeds: null,
};

let loadGeneration = 0;
let authEpoch = 0;
const views = ["reader", "featured", "latest", "opensource", "digest", "saved"];
const VIEW_TITLES = {
  reader: { titleKey: "view.reader.title", subtitleKey: "view.reader.subtitle" },
  featured: { titleKey: "view.featured.title", subtitleKey: "view.featured.subtitle" },
  latest: { titleKey: "view.latest.title", subtitleKey: "view.latest.subtitle" },
  opensource: { titleKey: "view.opensource.title", subtitleKey: "view.opensource.subtitle" },
  digest: { titleKey: "view.digest.title", subtitleKey: "view.digest.subtitle" },
  saved: { titleKey: "view.saved.title", subtitleKey: "view.saved.subtitle" },
  review: { titleKey: "view.review.title", subtitleKey: "view.review.subtitle" },
  "reader-settings": { titleKey: "view.readerSettings.title", subtitleKey: "view.readerSettings.subtitle" },
};
const viewTitle = (view) => t((VIEW_TITLES[view] || VIEW_TITLES.reader).titleKey);
const viewSubtitle = (view) => t((VIEW_TITLES[view] || VIEW_TITLES.reader).subtitleKey);

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let toastTimer;
function toast(msg, onUndo) {
  const el = document.getElementById("toast");
  el.innerHTML = esc(msg) + (onUndo ? '<button type="button" id="toast-undo">' + esc(t("toast.undo")) + "</button>" : "");
  el.hidden = false;
  if (onUndo) {
    document.getElementById("toast-undo").addEventListener("click", () => {
      onUndo();
      el.hidden = true;
    });
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, onUndo ? 5000 : 2400);
}

function beijingParts(dateLike, opts) {
  const d = new Date(dateLike);
  if (!Number.isFinite(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat(isZh() ? "zh-CN" : "en-US", { timeZone: "Asia/Shanghai", ...opts }).formatToParts(d);
  return (type) => parts.find((p) => p.type === type)?.value || "";
}

function formatBeijing(iso) {
  if (!iso) return "";
  if (!isZh()) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    return d.toLocaleString("en-US", { timeZone: "Asia/Shanghai", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }
  const get = beijingParts(iso, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  if (!get) return "";
  return `${Number(get("month"))}月${Number(get("day"))}日 ${get("hour")}:${get("minute")}`;
}

function formatBeijingDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString(isZh() ? "zh-CN" : "en-US", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
}

function relativeTime(iso, now = Date.now()) {
  const parsed = Date.parse(iso || "");
  if (!Number.isFinite(parsed)) return "";
  const s = Math.max(0, Math.round((now - parsed) / 1000));
  if (s < 60) return t("time.justNow");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.minutesAgo", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.hoursAgo", { n: h });
  const d = Math.round(h / 24);
  if (d < 8) return t("time.daysAgo", { n: d });
  return "";
}

function todayLine() {
  if (!isZh()) {
    return new Date().toLocaleDateString("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long" });
  }
  const get = beijingParts(new Date(), { year: "numeric", month: "numeric", day: "numeric", weekday: "short" });
  if (!get) return "";
  return `${get("year")} 年 ${Number(get("month"))} 月 ${Number(get("day"))} 日，星期${get("weekday").replace("周", "").replace("星期", "")}`;
}

function readLocal(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota
  }
}

function persistHidden() {
  writeLocal("aquasight-hidden", [...state.hiddenIds]);
}

// ---- 个人链接（离线保存到 favorites snapshot，不抓取外部 URL）----
// URL 规范化/哈希与 iOS 共用同一手写算法，见 web/urlnorm.js。
const READER_TAG_MAX_LEN = 24;
const READER_TAG_MAX_COUNT = 12;
const READER_NOTE_MAX = 2000;
const LINK_TITLE_MAX = 200;
const LINK_EXCERPT_MAX = 2000;

function parseTagInput(raw) {
  return [...new Set(String(raw || "").split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean))]
    .slice(0, READER_TAG_MAX_COUNT)
    .map((t) => t.slice(0, READER_TAG_MAX_LEN));
}

/// 网址域名回退标题：URL 已过 personalLinkId 校验（http(s)），这里取
/// hostname 作为空标题的可靠兜底（与 iOS PersonalLink.fallbackTitle 同义）。
function domainFallbackTitle(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    return parsed.hostname || "";
  } catch {
    return "";
  }
}

const favorites = createFavorites({
  read: () => readLocal("aquasight-saved", {}),
  write: (data) => localStorage.setItem("aquasight-saved", JSON.stringify(data)),
  request: async (id, kind, snapshot) => {
    if (kind !== "remove") await requireLibrarySupport([snapshot]);
    return api(
      kind === "remove" ? "/api/v1/favorites/" + encodeURIComponent(id) : "/api/v1/favorites",
      kind === "remove" ? { method: "DELETE" } : {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: id, snapshot }),
      }
    );
  },
  onChange: syncSavedState,
});

function syncSavedState(renderSaved = true) {
  const sync = document.getElementById("sync-status");
  state.savedItems = favorites.items();
  state.saved = new Set(Object.keys(state.savedItems));
  const count = document.getElementById("saved-count");
  if (count) {
    count.textContent = state.saved.size || "";
    count.hidden = !state.saved.size;
  }
  if (sync && state.view === "saved") {
    const pending = favorites.pendingCount();
    sync.hidden = !favorites.isAvailable() || !pending;
    sync.textContent = t("sync.pending", { n: pending });
  }
  document.querySelectorAll("button[data-act=save]").forEach((btn) => {
    const id = btn.dataset.id || btn.closest("[data-id]")?.dataset.id;
    if (!id) return;
    const on = state.saved.has(id);
    btn.setAttribute("aria-pressed", String(on));
    const action = on ? t("story.unsave") : t("story.save");
    if (btn.querySelector(".bookmark")) btn.setAttribute("aria-label", t("story.saveAria", { action }));
    else btn.textContent = on ? t("story.saved") : t("story.save");
  });
  if (renderSaved && state.view === "saved") {
    state.items = Object.values(state.savedItems);
    renderList();
  }
}

function persistPrefs() {
  writeLocal("aquasight-prefs", state.prefs || {});
}

/* ---------- 订阅阅读器：游客本机来源选择 ---------- */

/// 游客（未登录）的订阅选择显式持久化在本机：与原生一致，默认空集 →
/// 首次进入展示来源引导，绝不静默替用户开启任何来源。
const GUEST_READER_KEY = "aquasight-reader-guest";

function guestReaderSelection() {
  const raw = readLocal(GUEST_READER_KEY, null);
  if (raw && Array.isArray(raw.selected)) {
    return { selected: raw.selected.filter((s) => typeof s === "string"), configured: raw.configured === true };
  }
  return { selected: [], configured: false };
}

function persistGuestReaderSelection(selected, configured = true) {
  writeLocal(GUEST_READER_KEY, { selected: [...new Set(selected)], configured });
}

/// 目录里被禁用（extended）的来源，与原生一致：目录不可用时退回静态基础集。
const READER_BASIC_FALLBACK = [
  "github",
  "github-trending",
  "github-trending-weekly",
  "github-maintained",
  "openai",
  "huggingface",
];

function readerBasicIds() {
  const basics = (state.readerCatalog || []).filter((s) => !s.extended).map((s) => s.id);
  return new Set(basics.length ? basics : READER_BASIC_FALLBACK);
}

/// 当前生效的订阅来源，与原生 ReaderModel.effectiveSources 同一规则：
/// 未开启「更多来源」时仅基础集可用（已选扩展来源保留在存储但被过滤）；
/// 游客永远只有基础集；未知 ID 一律过滤。
function effectiveReaderSources() {
  const catalog = state.readerCatalog || [];
  const basic = readerBasicIds();
  const extended = new Set(catalog.filter((s) => s.extended).map((s) => s.id));
  let selected;
  let allowExtended = false;
  if (state.user) {
    const r = state.readerAccount || {};
    selected = Array.isArray(r.selectedSources) ? r.selectedSources : [];
    allowExtended = r.moreSourcesEnabled === true;
  } else {
    selected = guestReaderSelection().selected;
  }
  return [...new Set(selected)]
    .filter((id) => basic.has(id) || (allowExtended && extended.has(id)))
    .sort();
}

/// 公开目录读取（带请求去重与结果缓存）：订阅门控和游客引导都依赖它。
let readerCatalogReq = null;
function loadReaderCatalog() {
  if (state.readerCatalog) return Promise.resolve(state.readerCatalog);
  if (readerCatalogReq) return readerCatalogReq;
  const p = api("/api/v1/reader/catalog")
    .then((d) => {
      state.readerCatalog = d.sources || [];
      return state.readerCatalog;
    })
    .catch(() => state.readerCatalog || [])
    .finally(() => {
      if (readerCatalogReq === p) readerCatalogReq = null;
    });
  readerCatalogReq = p;
  return p;
}

/// 登录后取账户订阅（带代际守卫与请求去重）。返回前不渲染订阅流，避免
/// 用空订阅误显示引导空态。
let readerAccountReq = null; // { epoch, promise }
async function loadReaderAccountSettings({ wait = true } = {}) {
  if (!state.user) return;
  const epoch = authEpoch;
  if (readerAccountReq && readerAccountReq.epoch === epoch) {
    if (wait) await readerAccountReq.promise;
    return;
  }
  const p = (async () => {
    const started = authEpoch;
    try {
      const set = await api("/api/v1/reader/settings");
      if (authEpoch !== started || !state.user) return;
      state.readerAccount = set.reader || {};
    } catch {
      // 阅读流会显示错误与重试，不能把读取失败当成尚未配置。
    } finally {
      if (readerAccountReq && readerAccountReq.promise === p) readerAccountReq = null;
    }
  })();
  readerAccountReq = { epoch, promise: p };
  if (wait) await p;
}

/// 与后端/原生一致的安全链接判定：仅 http(s)、有主机、无内嵌凭据。
function safeReaderUrl(u) {
  try {
    const parsed = new URL(String(u || ""));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    if (!parsed.host || parsed.username || parsed.password) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function persistReads() {
  writeLocal("aquasight-reads", state.reads || {});
}

function snapshotOf(item) {
  if (!item || typeof item !== "object") return null;
  if (!(item.title || item.titleZh || item.overviewZh || item.summary)) return null;
  return item;
}

function markRead(id) {
  if (!id || state.reads[id]) return;
  state.reads[id] = new Date().toISOString();
  persistReads();
  api("/api/v1/reads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventId: id, read: true }),
  }).catch(() => {});
}

function parseHash() {
  const raw = (location.hash || "#/featured").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  if (parts[0] === "event" && parts[1]) {
    // 订阅详情上下文显式编码在链接里（#/event/<id>?reader=1）：刷新、
    // 冷启动深链都保持 reader 模式；不带查询的普通发现链接不受影响。
    const [rawId, query] = String(parts[1]).split("?");
    const params = new URLSearchParams(query || "");
    return { view: "event", eventId: decodeURIComponent(rawId), readerDetail: params.get("reader") === "1" };
  }
  if (parts[0] === "review") return { view: "review", eventId: "" };
  if (parts[0] === "reader-settings") return { view: "reader-settings", eventId: "" };
  // The website opens the public edition; personal-reader deep links remain valid.
  const view = views.includes(parts[0]) ? parts[0] : "featured";
  return { view, eventId: "" };
}

function apiUrl(path, params) {
  const u = new URL(path, location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== "") u.searchParams.set(k, v);
    }
  }
  return u.toString();
}

async function api(path, opts = {}) {
  const { headers: extraHeaders, ...rest } = opts;
  const headers = { Accept: "application/json", ...extraHeaders };
  const res = await fetch(path, {
    signal: AbortSignal.timeout(12000),
    cache: "no-store",
    credentials: "same-origin",
    ...rest,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  const fromCache = String(res.headers.get("X-AquaSight-Cache") || "") === "1";
  if (!res.ok) {
    const err = new Error(data.error || "HTTP " + res.status);
    err.status = res.status;
    err.data = data;
    err.fromCache = fromCache;
    throw err;
  }
  if (data && typeof data === "object") data.__fromCache = fromCache;
  return data;
}

function takeCacheFlag(data) {
  const cached = Boolean(data && data.__fromCache);
  if (data && typeof data === "object") delete data.__fromCache;
  return cached;
}

/* ---------- 账户私有 RSS 源 ---------- */

async function loadUserFeeds() {
  if (!state.user) { state.userFeeds = []; return; }
  const epoch = authEpoch;
  try {
    const data = await api("/api/v1/feeds");
    if (authEpoch !== epoch) return; // 账户已切换：过期响应不得写入新身份
    state.userFeeds = Array.isArray(data.feeds) ? data.feeds : [];
  } catch {
    if (authEpoch !== epoch) return;
    state.userFeeds = [];
  }
}

/// RSS-only 阅读门：没有任何内置来源时，只要存在未暂停的私有源即可阅读。
function hasActiveCustomFeeds() {
  return Boolean(state.user && Array.isArray(state.userFeeds) && state.userFeeds.some((f) => f && !f.paused));
}

function customFeedsHtml() {
  if (!state.user) {
    return '<p class="subhead">' + esc(t("feeds.section")) + "</p>" +
      '<p class="reader-hint">' + esc(t("feeds.loginHint")) + "</p>";
  }
  const feeds = Array.isArray(state.userFeeds) ? state.userFeeds : [];
  const rows = feeds.map((f) => {
    // 只展示 host：完整 URL（可能带私有查询参数）不上屏。
    let host = "";
    try { host = new URL(f.url).host; } catch { host = ""; }
    const name = esc(f.name || host);
    const desc = esc(host +
      (f.itemCount ? " · " + t("feeds.itemCount", { n: f.itemCount }) : "") +
      (f.lastError ? " · " + t("feeds.lastError") : ""));
    return '<div class="setting-row custom-feed-row" data-feed="' + esc(f.feedId) + '">' +
      '<span class="reader-source-text"><span class="reader-source-name">' + name +
      (f.paused ? ' <span class="reader-lock">' + esc(t("feeds.paused")) + "</span>" : "") + "</span>" +
      '<span class="reader-source-desc">' + desc + "</span></span>" +
      '<span class="custom-feed-actions">' +
      '<button type="button" class="text-link" data-act="feed-pause" data-id="' + esc(f.feedId) + '" aria-label="' + esc((f.paused ? t("feeds.resume") : t("feeds.pause")) + " " + (f.name || host)) + '">' + esc(f.paused ? t("feeds.resume") : t("feeds.pause")) + "</button>" +
      '<button type="button" class="text-link" data-act="feed-refresh" data-id="' + esc(f.feedId) + '" aria-label="' + esc(t("feeds.refresh") + " " + (f.name || host)) + '">' + esc(t("feeds.refresh")) + "</button>" +
      '<button type="button" class="text-link danger-text" data-act="feed-remove" data-id="' + esc(f.feedId) + '" aria-label="' + esc(t("feeds.remove") + " " + (f.name || host)) + '">' + esc(t("feeds.remove")) + "</button>" +
      "</span></div>";
  }).join("");
  const aihotAdded = feeds.some(f => f.url === "https://aihot.news/feed.xml");
  return '<p class="subhead">' + esc(t("feeds.section")) + "</p>" +
    '<div class="setting-row"><span class="reader-source-text"><span class="reader-source-name">AIHOT</span><span class="reader-source-desc">' + esc(t("feeds.aihotDesc")) + '</span></span><button type="button" class="text-link" id="feed-add-aihot"' + (aihotAdded ? " disabled" : "") + ' >' + esc(t(aihotAdded ? "bundles.added" : "feeds.add")) + "</button></div>" +
    '<form id="feed-add-form" class="feed-add-form">' +
    '<label class="field-label sr-only" for="feed-add-url">' + esc(t("feeds.addPlaceholder")) + "</label>" +
    '<input id="feed-add-url" type="url" required placeholder="' + esc(t("feeds.addPlaceholder")) + '" autocomplete="off" spellcheck="false">' +
    '<button class="primary" type="submit" id="feed-add-btn">' + esc(t("feeds.add")) + "</button></form>" +
    '<p id="feed-add-status" class="form-error" role="alert" hidden></p>' +
    (rows || '<p class="reader-hint">' + esc(t("feeds.empty")) + "</p>") +
    '<p class="reader-hint">' + esc(t("feeds.note")) + "</p>";
}

async function refreshCustomFeedsSection() {
  const box = document.getElementById("custom-feeds");
  if (!box) return;
  const epoch = authEpoch;
  await loadUserFeeds();
  if (authEpoch !== epoch) return; // 账户切换：不渲染旧账户的源
  const target = document.getElementById("custom-feeds");
  if (!target) return; // 页面已切换
  target.innerHTML = customFeedsHtml();
}

function feedAddStatus(msg, isError = true) {
  const el = document.getElementById("feed-add-status");
  if (!el) return;
  if (!msg) { el.hidden = true; el.textContent = ""; return; }
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("form-error", isError);
}

async function submitAddFeed(url) {
  if (!state.user) { toast(t("feeds.loginHint")); return; }
  const epoch = authEpoch;
  const btn = document.getElementById("feed-add-btn");
  const input = document.getElementById("feed-add-url");
  feedAddStatus(t("feeds.checking"), false);
  if (btn) btn.disabled = true;
  try {
    await api("/api/v1/feeds", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (authEpoch !== epoch) return;
    feedAddStatus("");
    if (input) input.value = "";
    toast(t("feeds.added"));
    await refreshCustomFeedsSection();
    if (state.view === "reader") loadList(true);
  } catch (e) {
    if (authEpoch !== epoch) return;
    const code = String(e.message || "");
    const msg = /not a feed/.test(code) ? t("feeds.notAFeed")
      : /duplicate/.test(code) ? t("feeds.duplicate")
      : /limit/.test(code) ? t("feeds.limit")
      : /invalid url/.test(code) ? t("feeds.invalidUrl")
      : t("feeds.fetchFailed");
    feedAddStatus(msg);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleFeedAction(btn) {
  const act = btn.dataset.act;
  const id = btn.dataset.id;
  const feed = (Array.isArray(state.userFeeds) ? state.userFeeds : []).find((f) => f.feedId === id);
  if (!feed) return;
  btn.disabled = true;
  const epoch = authEpoch;
  try {
    if (act === "feed-refresh") {
      const data = await api("/api/v1/feeds/" + encodeURIComponent(id) + "/refresh", { method: "POST" });
      if (authEpoch !== epoch) return;
      if (data.wait && data.retryAfterSec) {
        const mins = Math.max(1, Math.ceil(data.retryAfterSec / 60));
        toast(t("feeds.waitHint", { n: mins }));
      } else if (data.feed && data.feed.lastError) {
        toast(t("feeds.refreshFailedKept"));
      } else {
        toast(t("feeds.refreshed"));
      }
    } else if (act === "feed-remove") {
      await api("/api/v1/feeds/" + encodeURIComponent(id), { method: "DELETE" });
      if (authEpoch !== epoch) return;
      toast(t("feeds.removed"));
    } else if (act === "feed-pause") {
      await api("/api/v1/feeds/" + encodeURIComponent(id) + "/pause", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: !feed.paused }),
      });
    }
  } catch (e) {
    if (authEpoch !== epoch) return;
    toast(t("feeds.actionFailed", { msg: e.message || t("toast.networkError") }));
  } finally {
    btn.disabled = false;
  }
  if (authEpoch !== epoch) return; // 账户切换：不再回写旧账户的区块
  await refreshCustomFeedsSection();
  if (state.view === "reader") loadList(true);
}

/// 自定义 RSS 条目的来源标签：优先服务端 feed 名称（已转义渲染）。
function itemSourceLabel(it) {
  if (it && it.sourceLabel) return String(it.sourceLabel);
  return sourceLabel(it && it.source, lang());
}


/// Locale-aware title: Chinese readers see the prepared Chinese title; the
/// original title leads for everyone else (original reading, no translation).
function displayTitle(it) {
  if (isZh()) return String(it.titleZh || it.title || t("untitled")).trim();
  return String(it.title || it.titleZh || t("untitled")).trim();
}

function overviewOf(it) {
  if (isZh()) return String(it.overviewZh || it.summaryZh || "").trim();
  return String(it.summary || (it.githubRepo && it.githubRepo.description) || it.overviewZh || it.summaryZh || "").trim();
}

function uniqueSources(item, members) {
  const raw = [];
  const initial = Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : [{ source: item.source, url: item.url, title: item.title }];
  for (const s of initial) if (s) raw.push(s);
  for (const m of members || []) {
    if (!m) continue;
    raw.push({ source: m.source, url: m.url || m.discussionUrl, title: m.title, discussionUrl: m.discussionUrl, publishedAt: m.publishedAt });
  }
  // Same URL = same article even when it arrived via two feeds (36kr and
  // 36kr-flash); outlet counting is separate (countCoverage).
  const seen = new Map();
  const out = [];
  for (const s of raw) {
    if (!s.url && !s.source) continue;
    const key = s.url ? "url:" + s.url : "src:" + s.source + "|" + String(s.title || "");
    if (seen.has(key)) {
      const previous = seen.get(key);
      if (!previous.discussionUrl) previous.discussionUrl = s.discussionUrl;
      if (!previous.publishedAt && s.publishedAt) previous.publishedAt = s.publishedAt;
      continue;
    }
    const copy = { ...s };
    seen.set(key, copy);
    out.push(copy);
  }
  return out;
}

function topicLabel(it) {
  const c = it.category || it.subject || "";
  if (c === "tech") return t("topic.tech");
  if (c === "business") return t("topic.business");
  if (c === "public") return t("topic.public");
  return t("topic.fallback");
}

function storyTime(it) {
  if (it.githubRepo?.observedAt) {
    const abs = formatBeijing(it.githubRepo.observedAt);
    const rel = relativeTime(it.githubRepo.observedAt) || abs;
    return { hasPublished: false, abs, rel, label: t("time.observed", { rel }) };
  }
  const hasPublished = Boolean(it.publishedAt);
  const base = it.publishedAt || it.firstSeenAt || it.seenAt;
  const abs = formatBeijing(base);
  const rel = relativeTime(base) || abs;
  return { hasPublished, rel, abs, label: hasPublished ? rel : base ? t("time.found", { rel }) : t("date.unknown") };
}

function aiNote(it) {
  const marks = readingMarks(it);
  if (marks.prepared) return '<span class="ai-mark">' + esc(t("story.aiReady")) + "</span>";
  if (marks.pending) return '<span class="pending-mark">' + esc(t("story.aiPending")) + "</span>";
  return "";
}

function storyHtml(it, { lead = false, compact = false } = {}) {
  const read = Boolean(state.reads[it.id]);
  const href = "#/event/" + encodeURIComponent(it.id);
  const sources = uniqueSources(it);
  const primary = sources[0] || { source: it.source };
  const when = storyTime(it);
  const body = compact ? { kind: "empty" } : cardBody(it, lang());
  const marks = readingMarks(it);
  const heat = Number.isFinite(it.points) && it.points >= 20
    ? '<span class="heat">▲ ' + it.points + "</span>"
    : "";
  const cov = countCoverage(sources);
  // A repo item's multiple GitHub listings are several signals about one
  // project, not several media outlets reporting a story.
  const repo = repoMeta(it);
  const countN = !repo && cov.media > 1
    ? '<span class="sep">·</span><span>' + esc(t("story.mediaCount", { n: cov.media })) + "</span>"
    : "";
  const repoBits = repo && repo.text ? '<span class="sep">·</span><span class="repo-meta">' + esc(repo.text) + "</span>" : "";
  const summary = body.kind === "empty"
    ? ""
    : '<p class="summary clamp">' + esc(body.text) + "</p>";
  return (
    '<article class="story' +
    (lead ? " lead" : "") +
    (read ? " read" : "") +
    '" data-id="' + esc(it.id) + '">' +
    (lead ? '<span class="lead-label">' + esc(t("story.lead")) + "</span>" : "") +
    '<div class="story-meta">' +
    (it.kind === "personal-link" ? "" : '<span class="topic">' + esc(topicLabel(it)) + '</span><span class="sep">·</span>') +
    "<span>" + esc(sourceLabel(primary.source || it.source, lang())) + "</span>" +
    '<span class="sep">·</span>' +
    '<time title="' + esc(t("time.beijingTitle", { abs: when.abs })) + '">' + esc(when.label) + "</time>" +
    countN +
    repoBits +
    heat +
    (body.kind === "overview" && marks.prepared && !compact ? '<span class="sep">·</span>' + aiNote(it) : "") +
    "</div>" +
    '<h2><a href="' + href + '">' + esc(displayTitle(it)) + "</a></h2>" +
    summary +
    '<button type="button" class="save-btn" data-act="save" data-id="' + esc(it.id) +
    '" aria-pressed="' + state.saved.has(it.id) + '" aria-label="' +
    esc(t("story.saveAria", { action: state.saved.has(it.id) ? t("story.unsave") : t("story.save") })) + '"><span class="bookmark" aria-hidden="true"></span></button>' +
    "</article>"
  );
}

/// 收藏卡片：与阅读流同一视觉语言的简单卡片；标签/备注数据保留在编辑
/// 与详情路径，不在列表做预览（简单收藏，不做笔记应用）。
function libraryCardHtml(it) {
  const tools =
    '<details class="library-more"><summary aria-label="' + esc(t("library.moreAria")) + '">' + esc(t("library.more")) + '</summary><div class="library-tools">' +
    '<button type="button" class="text-link" data-action="edit-meta" data-id="' + esc(it.id) + '">' + esc(t("library.note")) + "</button>" +
    '<button type="button" class="text-link" data-action="remove-item" data-id="' + esc(it.id) + '">' + esc(t("library.remove")) + "</button>" +
    "</div>";
  return '<div class="library-card">' + storyHtml(it) + tools + "</details></div>";
}

/// 订阅流卡片：标题进 reader 详情；原文链接只允许安全 http(s) URL（与
/// 原生 SafeLink 同规则），GitHub 元数据照常展示。
function readerCardHtml(it) {
  const read = Boolean(state.reads[it.id]);
  const href = "#/event/" + encodeURIComponent(it.id) + "?reader=1";
  const when = storyTime(it);
  const repo = repoMeta(it);
  const repoBits = repo && repo.text ? '<span class="sep">·</span><span class="repo-meta">' + esc(repo.text) + "</span>" : "";
  const original = safeReaderUrl(it.url);
  const originalLink = original
    ? '<a class="reader-original" target="_blank" rel="noreferrer" href="' + esc(original) + '">' +
      esc(t("reader.original", { source: itemSourceLabel(it) })) + "</a>"
    : '<span class="reader-original none">' + esc(t("reader.originalUnavailable")) + "</span>";
  const body = cardBody(it, lang());
  const summary = body.kind === "empty" ? "" : '<p class="summary clamp">' + esc(body.text) + "</p>";
  return (
    '<article class="story reader-story' + (read ? " read" : "") + '" data-id="' + esc(it.id) + '">' +
    '<div class="story-meta">' +
    sourceNameHtml(itemSourceLabel(it)) +
    '<span class="sep">·</span>' +
    '<time title="' + esc(t("time.beijingTitle", { abs: when.abs })) + '">' + esc(when.label) + "</time>" +
    repoBits +
    "</div>" +
    '<h2><a href="' + href + '">' + esc(displayTitle(it)) + "</a></h2>" +
    summary +
    '<div class="reader-card-foot">' + originalLink +
    '<button type="button" class="save-btn" data-act="save" data-id="' + esc(it.id) +
    '" aria-pressed="' + state.saved.has(it.id) + '" aria-label="' +
    esc(t("story.saveAria", { action: state.saved.has(it.id) ? t("story.unsave") : t("story.save") })) + '"><span class="bookmark" aria-hidden="true"></span></button>' +
    "</div></article>"
  );
}

/// 游客/未配置来源时的引导空态（与原生阅读 Tab 一致：默认空集，不静默
/// 开启任何来源；所有按钮都是用户显式选择）。
function readerOnboardingHtml() {
  const githubIds = (state.readerCatalog || [])
    .filter((s) => !s.extended && String(s.id).startsWith("github"))
    .map((s) => s.id);
  const githubStart = (githubIds.length ? githubIds : ["github"]).join(",");
  return (
    '<div class="empty reader-onboarding">' +
    '<img class="onboarding-mark" src="./icon.svg" width="56" height="56" alt="" />' +
    "<h2>" + esc(t("onboarding.title")) + "</h2>" +
    "<p>" + esc(t("onboarding.subtitle")) + "</p>" +
    '<div class="reader-onboarding-actions">' +
    '<button type="button" class="primary" data-action="reader-start" data-sources="' + esc(githubStart) + '">' + esc(t("onboarding.start")) + "</button>" +
    '<a class="text-link" href="#/reader-settings">' + esc(t("onboarding.pick")) + "</a>" +
    "</div>" +
    (state.user ? "" : '<p class="reader-hint">' + esc(t("onboarding.hint")) + "</p>") +
    '<ol class="onboarding-steps">' + ["onboarding.step1", "onboarding.step2", "onboarding.step3"].map((key) => '<li>' + esc(t(key)) + '</li>').join("") + '</ol>' +
    '<a class="onboarding-discover" href="#/featured">' + esc(t("onboarding.discover")) + '</a>' +
    "</div>"
  );
}

function sourceNameHtml(label) {
  return '<span class="source-name"><i class="source-monogram" aria-hidden="true" data-initial="' + esc(Array.from(label)[0] || "") + '"></i>' + esc(label) + '</span>';
}

function beijingDay(iso) {
    const t = Date.parse(iso || "");
    if (!Number.isFinite(t)) return null;
    return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function dateSections(items, { reader = false } = {}) {
  const today = beijingDay(new Date().toISOString());
  const yesterday = beijingDay(new Date(Date.now() - 864e5).toISOString());
  const groups = [];
  for (const it of items) {
    const timestamp = it.githubRepo?.observedAt || it.publishedAt || it.firstSeenAt || it.seenAt;
    const day = beijingDay(timestamp);
    let label = "";
    if (!day) label = t("date.unknown");
    else if (day === today) label = t("date.todayLabel", { date: formatBeijingDate(timestamp) });
    else if (day === yesterday) label = t("date.yesterdayLabel", { date: formatBeijingDate(timestamp) });
    else label = formatBeijingDate(timestamp) || t("date.earlier");
    if (groups.at(-1)?.day !== day) groups.push({ day, label, items: [] });
    groups.at(-1).items.push(it);
  }
  return groups.map(group => '<section class="day-group" aria-label="' + esc(group.label) + '"><div class="date-section"><span>' + esc(group.label) + '</span><span class="date-count">' + esc(t("reading.dayCount", { n: group.items.length })) + '</span></div>' + group.items.map(it => reader ? readerCardHtml(it) : storyHtml(it, { compact: true })).join("") + '</section>').join("");
}

function hasFilters() {
  return Boolean(state.q || state.topic || state.source || state.unreadOnly);
}

function filterCount() {
  return [state.q, state.topic, state.source, state.unreadOnly].filter(Boolean).length;
}

function renderTabs() {
  const topicEl = document.getElementById("topic-filters");
  if (topicEl) {
    topicEl.innerHTML = TOPIC_FILTERS.map(([id]) =>
      '<button type="button" class="' + (state.topic === id ? "active" : "") +
      '" aria-pressed="' + (state.topic === id) + '" data-topic="' + esc(id) + '">' + esc(t(id === "" ? "filters.topic.all" : "filters.topic." + id)) + "</button>"
    ).join("");
  }
  const trigger = document.getElementById("filter-trigger");
  if (trigger) {
    const n = filterCount();
    trigger.textContent = n ? t("filters.triggerCount", { n }) : t("filters.trigger");
    trigger.classList.toggle("has-filter", Boolean(n));
  }
}

function emptyHtml(kind) {
  if (kind === "filters") {
    return '<div class="empty"><h2>' + esc(t("empty.filters.title")) + "</h2><p>" + esc(t("empty.filters.body")) + '</p><button type="button" class="text-link" data-act="clear-filters">' + esc(t("filters.clear")) + "</button></div>";
  }
  if (kind === "saved") {
    return '<div class="empty"><h2>' + esc(t("empty.saved.title")) + "</h2><p>" + esc(t("empty.saved.body")) + "</p>" +
      '<a class="text-link" href="#/reader">' + esc(t("empty.saved.go")) + "</a>" +
      ' <button type="button" class="text-link" data-action="add-link">' + esc(t("empty.saved.add")) + "</button></div>";
  }
  if (kind === "digest") {
    return '<div class="empty"><h2>' + esc(t("empty.digest.title")) + "</h2><p>" + esc(t("empty.digest.body")) + '</p><a class="text-link" href="#/featured">' + esc(t("empty.digest.go")) + "</a></div>";
  }
  return '<div class="empty"><h2>' + esc(t("empty.plain.title")) + "</h2><p>" + esc(t("empty.plain.body")) + "</p></div>";
}

function feedEndHtml(view, count) {
  if (!count) return "";
  if (view === "reader") return '<footer class="feed-end"><span>' + esc(t("reader.end")) + '</span><a href="#/reader-settings">' + esc(t("reader.manage")) + "</a></footer>";
  if (view === "latest") return '<footer class="feed-end"><span>' + esc(t("reader.latest.end")) + '</span><a href="#/featured">' + esc(t("reader.latest.back")) + "</a></footer>";
  if (view === "saved") return '<footer class="feed-end"><span>' + esc(t("reader.saved.end")) + '</span><a href="#/reader">' + esc(t("reader.saved.go")) + "</a></footer>";
  return '<footer class="feed-end"><span>' + esc(t("reader.featured.end")) + '</span><a href="#/latest">' + esc(t("reader.featured.more")) + "</a></footer>";
}

function renderFilterNote() {
  const el = document.getElementById("filter-note");
  if (!el) return;
  const bits = [];
  if (state.q) bits.push("“" + esc(state.q) + "”");
  if (state.topic) bits.push(esc(t(state.topic === "" ? "filters.topic.all" : "filters.topic." + state.topic) !== "filters.topic." + state.topic ? t("filters.topic." + state.topic) : state.topic));
  if (state.source) bits.push(esc(sourceLabel(state.source, lang())));
  if (state.unreadOnly) bits.push(esc(t("filters.unreadOnly")));
  if (!bits.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = "notice";
  el.innerHTML = esc(t("filters.current", { list: bits.join(" · ") })) +
    ' <button type="button" data-act="clear-filters">' + esc(t("filters.clear")) + "</button>";
}

function renderList() {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const pager = document.querySelector(".pager");
  detail.hidden = true;
  list.hidden = false;
  if (pager) pager.hidden = false;
  renderTabs();
  renderFilterNote();
  renderReadingAside();
  const view = state.view;
  if (view === "digest") {
    list.innerHTML = digestHtml();
    syncSavedState();
    return;
  }
  if (view === "reader") {
    // 订阅流是独立的来源选择体系：不叠加旧 hidden/blocked 偏好，也不套
    // 精选页的话题/来源筛选（搜索 q 已在服务端生效）。
    const sources = effectiveReaderSources();
    if (!sources.length && !hasActiveCustomFeeds()) {
      list.innerHTML = readerOnboardingHtml();
      syncSavedState(false);
      return;
    }
    if (!state.items.length) {
      list.innerHTML = hasFilters() ? emptyHtml("filters") : emptyHtml("plain");
      return;
    }
    const body = dateSections(state.items, { reader: true });
    list.innerHTML = body + feedEndHtml("reader", state.items.length);
    syncSavedState(false);
    return;
  }
  const localFilter =
    state.feed === "snapshot" ||
    state.cached ||
    view === "saved" ||
    view === "review";
  const blocked = new Set((state.prefs.blockedSources || []).map((s) => String(s).trim()).filter(Boolean));
  const filtered = state.items.filter((it) => {
    if (state.hiddenIds.has(it.id)) return false;
    if (isHiddenCard(it)) return false;
    if (blocked.has(it.source)) return false;
    if (!localFilter) return true;
    if (state.topic && it.category !== state.topic && it.subject !== state.topic) return false;
    if (state.source && it.source !== state.source) return false;
    if (state.unreadOnly && state.reads[it.id]) return false;
    if (state.q) {
      const blob = [it.title, it.titleZh, it.overviewZh, it.summary, it.readerNote,
        Array.isArray(it.readerTags) ? it.readerTags.join(" ") : ""].join(" ").toLowerCase();
      if (!blob.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
  const undo = state.hideUndo
    ? '<p class="undo-bar">' + esc(t("toast.hidden")) + ' <button type="button" data-act="undo">' + esc(t("toast.undo")) + "</button></p>"
    : "";
  if (!filtered.length) {
    const kind = hasFilters() ? "filters" : view === "saved" ? "saved" : view === "digest" ? "digest" : "plain";
    list.innerHTML = undo + emptyHtml(kind);
    return;
  }
  let body;
  if (view === "latest") {
    body = dateSections(filtered);
  } else if (view === "saved") {
    // 简单收藏：不做标签筛选横条/数量与同步说明堆叠；待同步提醒由
    // #sync-status（syncSavedState）与「必要同步失败提醒」承担，数据
    // （标签/备注）保留在编辑与详情路径。
    body = filtered.map((it) => libraryCardHtml(it)).join("");
  } else if (view === "review") {
    body = filtered.map((it) => storyHtml(it) + reviewButtons(it)).join("");
  } else {
    // 今日关注 is earned by quality (pickLead), never by array position;
    // a list with no qualifying story simply has no lead.
    const leadItem = !hasFilters() && filtered.length > 1 ? pickLead(filtered) : null;
    body = filtered.map((it) => storyHtml(it, { lead: it === leadItem })).join("");
  }
  list.innerHTML = undo + body + feedEndHtml(view, filtered.length);
  syncSavedState(false);
}

function reviewButtons(it) {
  const rated = state.rated[it.id];
  if (rated) {
    return '<p class="story-meta" style="padding:4px 0 18px">' + esc(t("review.recorded", { kind: rated === "like" ? t("review.like") : t("review.dislike") })) + "</p>";
  }
  return (
    '<div class="detail-actions" style="padding:10px 0 18px;border:0;margin:0">' +
    '<button type="button" data-act="like" data-id="' + esc(it.id) + '">' + esc(t("review.like")) + "</button>" +
    '<button type="button" data-act="dislike" data-id="' + esc(it.id) + '">' + esc(t("review.dislike")) + "</button></div>"
  );
}

function digestHtml() {
  const digest = state.digest || {};
  const items = digest.items || [];
  if (!items.length || digest.missing) return emptyHtml("digest");
  const { showDate, weekday } = digestDateLine(digest.date || "", lang());
  const minutes = Math.max(1, Math.round(items.length * 0.4));
  const cutoff = state.snapshotAt ? esc(t("digest.cutoff", { time: formatBeijing(state.snapshotAt) })) : "";
  const groups = [
    ["tech", t("digest.group.tech"), digest.tech || []],
    ["business", t("digest.group.business"), digest.business || []],
    ["public", t("digest.group.public"), digest.public || []],
  ];
  let n = 0;
  const sections = groups
    .filter(([, , list]) => list.length)
    .map(([, label, list]) =>
      '<section class="digest-group"><h2 class="group-heading">' + label + "</h2>" +
      list.map((it) => {
        n += 1;
        const when = storyTime(it);
        return (
          '<article class="digest-story"><span class="digest-number">' + String(n).padStart(2, "0") + "</span><div>" +
          '<h2><a href="#/event/' + encodeURIComponent(it.id) + '">' + esc(displayTitle(it)) + "</a></h2>" +
          (cardBody(it, lang()).kind === "empty" ? "" : "<p>" + esc(cardBody(it, lang()).text) + "</p>") +
          "<small>" + esc(sourceLabel(it.source, lang())) + " · " + esc(when.label) + "</small>" +
          "</div></article>"
        );
      }).join("") +
      "</section>"
    ).join("");
  return (
    '<article class="edition">' +
    '<div class="edition-top"><span>' + esc((showDate + " · " + weekday).replace(/^ · | · $/g, "")) + "</span></div>" +
    "<h1>" + t("digest.morning") + "</h1>" +
    '<div class="edition-info">' + esc(t("digest.count", { n: items.length, m: minutes })) + cutoff + "</div>" +
    sections +
    '<footer class="feed-end"><span>' + esc(t("digest.end")) + '</span><a href="#/featured">' + esc(t("digest.continue")) + "</a></footer>" +
    "</article>"
  );
}

const INTERNAL_REASON = /[:：]\s*(pricing-missing|no-credential|model-unavailable|http-[a-z0-9-]*|timeout[a-z0-9-]*|extract-[a-z0-9-]*|invalid[:a-z0-9-]*|parse|budget[a-z0-9-]*|BUDGET_CANDIDATES)\s*$/i;

const NOTE_NOT_PREPARED = () => isZh() ? "这条还没有 AI 整理，下次采集会自动补上。" : "";
const NOTE_QUEUED = () => isZh() ? "正在排队等待 AI 整理。" : "";
const NOTE_INSUFFICIENT = () => isZh() ? "原始资料不足，暂时没有生成中文摘要。" : "";

function humanizedNotes(item) {
  if (!isZh()) return [];
  const marks = readingMarks(item);
  if (marks.state === "failed") return [NOTE_NOT_PREPARED()];
  if (marks.state === "queued") return [NOTE_QUEUED()];
  if (marks.state === "insufficient") return [NOTE_INSUFFICIENT()];
  const rawNotes = (item.uncertainty || []).filter((a) => typeof a === "string" && a.trim());
  if (!rawNotes.length) return [];
  const machineOnly = rawNotes.every((a) => INTERNAL_REASON.test(a));
  if (machineOnly) return [NOTE_NOT_PREPARED()];
  return rawNotes.map((a) => a.replace(INTERNAL_REASON, "").trim()).filter(Boolean);
}

function pendingIntro(item) {
  const marks = readingMarks(item);
  if (marks.state === "failed") return '<p class="detail-intro" style="font-size:16px;color:var(--sub)">这条还没有 AI 整理；下面是原始来源内容。</p>';
  if (marks.state === "queued") return '<p class="detail-intro" style="font-size:16px;color:var(--sub)">中文整理正在排队，稍后这里会补上。</p>';
  if (marks.state === "insufficient") return '<p class="detail-intro" style="font-size:16px;color:var(--sub)">原始资料不足，暂无中文摘要；不根据标题编造内容。</p>';
  return '<p class="detail-intro" style="font-size:16px;color:var(--sub)">这条还没有 AI 整理，下次采集会自动补上。</p>';
}

function renderDetail(item, members) {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const pager = document.querySelector(".pager");
  const heading = document.getElementById("feed-heading");
  const filtersRow = document.getElementById("filters-row");
  list.hidden = true;
  detail.hidden = false;
  if (pager) pager.hidden = true;
  if (heading) heading.hidden = true;
  if (filtersRow) filtersRow.hidden = true;
  state.detailItem = item;
  state.detailMembers = members || [];
  const zh = isZh();
  const facts = zh ? (Array.isArray(item.facts) ? item.facts.filter(Boolean) : []).slice(0, 3) : [];
  const sources = uniqueSources(item, members);
  const marks = readingMarks(item);
  const body = cardBody(item, lang());
  const when = storyTime(item);
  // English readers read the original: the original summary/repo description
  // leads; the Chinese AI overview may appear below, clearly marked Chinese.
  const originalBody = zh ? null : cardBody(item, "en");

  let intro = "";
  if (zh) {
    if (body.kind === "overview") {
      intro = '<p class="detail-intro">' + esc(body.text) + "</p>";
    } else if (body.kind === "excerpt") {
      intro =
        '<h2>' + esc(t("detail.quickLook")) + '</h2><p class="detail-intro" style="font-size:17px">' + esc(body.text) + "</p>" +
        '<p style="font-size:13px">' + esc(t("detail.excerptNote")) + "</p>";
    } else {
      intro = pendingIntro(item);
    }
  } else {
    intro = '<h2>' + esc(t("detail.summaryOriginal")) + "</h2>";
    if (originalBody && originalBody.kind !== "empty") {
      intro += '<p class="detail-intro">' + esc(originalBody.text) + "</p>";
    } else if (body.kind === "overview" && marks.prepared) {
      intro += '<h2>' + esc(t("detail.zhAiOverview")) + '</h2><p class="detail-intro">' + esc(body.text) + "</p>";
    } else {
      intro += '<p class="detail-intro">' + esc(t("detail.noSummary")) + "</p>";
    }
  }

  const factsHtml = facts.length
    ? "<h2>" + esc(t("detail.facts")) + "</h2><ol class='fact-list'>" +
      facts.map((f, i) => '<li><span class="fact-num">0' + (i + 1) + "</span><span>" + esc(f) + "</span></li>").join("") +
      "</ol>"
    : "";
  const impact = zh ? String(item.impact || "").trim() : "";
  const impactHtml = impact
    ? "<h2>" + esc(t("detail.impact")) + "</h2><span class='analysis-tag'>" + esc(t("detail.analysisTag")) + "</span><p>" + esc(impact) + "</p>"
    : "";
  const notes = zh ? humanizedNotes(item) : [];
  const notesHtml = notes.length
    ? "<h2>" + esc(t("detail.notes")) + "</h2>" + notes.map((n) => "<p>" + esc(n) + "</p>").join("")
    : "";

  const sourceItems = sources.map((s) => {
    const href = /^https?:\/\//i.test(s.url || "") ? s.url : "";
    const origTitle = s.title && s.title !== displayTitle(item) ? "<br>" + esc(s.title) : "";
    const when2 = formatBeijing(s.publishedAt || "");
    return href
      ? '<a href="' + esc(href) + '" target="_blank" rel="noreferrer">' +
        esc(sourceLabel(s.source || item.source, lang())) + ' <span class="out">↗</span>' + origTitle + "</a>" +
        (when2 ? "<small>" + esc(t("detail.publishedAt", { time: when2 })) + "</small>" : "<small>" + esc(t("detail.sourcePage")) + "</small>")
      : "<a>" + esc(sourceLabel(s.source || item.source, lang())) + origTitle + "</a><small>" + esc(t("detail.noLink")) + "</small>";
  }).join("");
  const attr = zh ? (item.attribution || [])
    .map((a) => '<p class="claim">' + esc(a.claim || a) + (a.source ? " — " + esc(a.source) : "") + "</p>")
    .join("") : "";

  // Repo project block: every row uses only metadata actually provided.
  // License shows 未知 when the source carries no license field; nothing
  // else (use cases, quality judgments) is invented here.
  const repoInfo = repoMeta(item);
  let repoBox = "";
  if (repoInfo) {
    const rows = ["<p>" + esc(repoInfo.fullName) + "</p>"];
    if (repoInfo.description) {
      const desc = zh ? String(item.overviewZh || item.summaryZh || repoInfo.description) : repoInfo.description;
      rows.push("<p>" + esc(desc) + "</p>");
    }
    const metaBits = [];
    if (repoInfo.language) metaBits.push(esc(t("repo.language", { lang: repoInfo.language })));
    if (repoInfo.stars != null) metaBits.push("★ " + repoInfo.stars);
    for (const w of repoInfo.growth) {
      if (!Number.isFinite(w.stars)) continue;
      metaBits.push(
        esc(t(w.window === "week" ? "repo.week" : "repo.day", { n: w.stars, source: sourceLabel(w.source, lang()) }))
      );
    }
    if (repoInfo.pushedAt) {
      const d = new Date(repoInfo.pushedAt);
      if (Number.isFinite(d.getTime())) {
        metaBits.push(esc(t("repo.pushed", { date: d.toLocaleDateString(zh ? "zh-CN" : "en-US", { timeZone: "Asia/Shanghai" }) })));
      }
    }
    metaBits.push(esc(t("repo.license", { name: repoInfo.license || t("repo.licenseUnknown") })));
    if (metaBits.length) rows.push('<p class="repo-meta-line">' + metaBits.join(" · ") + "</p>");
    const signalRows = zh ? repoInfo.signals
      .map((s) => "<p>" + esc(t("repo.signal", { source: sourceLabel(s.source, lang()), signal: s.signal })) + "</p>")
      .join("") : "";
    if (signalRows) rows.push(signalRows);
    repoBox = '<div class="source-box repo-box"><h2>' + esc(t("repo.box")) + "</h2>" + rows.join("") + "</div>";
  }

  const cov = countCoverage(sources);
  // For a project, GitHub listings are signal sources about one repo — never
  // counted as "multiple media" or flagged as "single media".
  const single = repoInfo
    ? sources.length > 1
      ? "<small>" + esc(t("detail.githubSources", { n: sources.length })) + "</small>"
      : ""
    : cov.media <= 1
    ? "<small>" + esc(t("detail.singleMedia")) + "</small>"
    : "<small>" +
      esc(t("detail.coverage", { articles: cov.articles, media: cov.media, origins: cov.origins })) +
      "</small>";
  const sourceBox =
    '<div class="source-box"><h2>' + esc(t("detail.sources")) + "</h2>" + sourceItems + single + attr + "</div>";

  // Original title line: for Chinese readers it surfaces the English
  // original; for English readers it marks the Chinese title when one exists.
  const origTitleLine = zh
    ? (item.title && displayTitle(item) !== item.title
        ? "<p>" + esc(t("detail.originalTitle", { title: item.title })) + "</p>"
        : "")
    : (item.titleZh && displayTitle(item) !== item.titleZh
        ? "<p>" + esc(t("detail.originalTitleZh", { title: item.titleZh })) + "</p>"
        : "");
  const rawMaterial = String(item.summary || "").trim();
  const rawHtml = body.kind !== "excerpt" && rawMaterial && rawMaterial !== body.text
    ? "<p>" + esc(rawMaterial.slice(0, 1200)) + "</p>"
    : "";
  const evidence = zh ? (item.evidence || [])
    .map((a) => "<li>" + esc(typeof a === "string" ? a : a.claim || a.url || "") + "</li>")
    .join("") : "";
  const evidenceHtml = evidence ? "<p>" + esc(t("detail.evidence")) + "</p><ul>" + evidence + "</ul>" : "";
  const detailsBlock = origTitleLine || rawHtml || evidenceHtml
    ? "<details><summary>" + esc(t("detail.rawMaterial")) + "</summary>" + origTitleLine + rawHtml + evidenceHtml + "</details>"
    : "";

  const attrLine = zh && marks.prepared
    ? '<p class="attribution">' + esc(t("detail.attrPrepared")) + "</p>"
    : '<p class="attribution">' + esc(t("detail.attrPlain")) + "</p>";

  // Only a validated http(s) URL may become a link; a javascript: or other
  // scheme in item.url or a fallback source URL is dropped, not rendered.
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");
  const primaryUrl = safeUrl(item.url) || safeUrl(sources[0] && sources[0].url);
  const readOriginal = primaryUrl
    ? '<a class="primary" target="_blank" rel="noreferrer" href="' + esc(primaryUrl) + '">' + esc(t("detail.readSource")) + "</a>"
    : "";
  const idx = state.items.findIndex((it) => it.id === item.id);
  const next = idx >= 0 && state.items.length > 1 ? state.items[(idx + 1) % state.items.length] : null;
  const nextHtml = next
    ? '<a class="detail-next" href="#/event/' + encodeURIComponent(next.id) +
      (state.detailReader ? "?reader=1" : "") +
      '"><small>' + esc(t("detail.next")) + "</small><span>" + esc(displayTitle(next)) + " →</span></a>"
    : "";

  detail.innerHTML =
    '<a class="back" id="back-link" href="#/' + (state.returnView || "reader") + '">' + esc(t("detail.back", { view: viewTitle(state.returnView || "reader") })) + "</a>" +
    '<div class="story-meta">' +
    '<span class="topic">' + esc(topicLabel(item)) + "</span>" +
    '<span class="sep">·</span><span>' + esc(sourceLabel(item.source, lang())) + "</span>" +
    '<span class="sep">·</span>' +
    '<time title="' + esc(t("time.beijingTitle", { abs: when.abs })) + '">' + esc(when.label) + "</time>" +
    (cov.media > 1 ? '<span class="sep">·</span><span>' + esc(t("story.mediaCount", { n: cov.media })) + "</span>" : "") +
    (zh && marks.prepared ? '<span class="sep">·</span>' + aiNote(item) : "") +
    "</div>" +
    "<h1>" + esc(displayTitle(item)) + "</h1>" +
    '<div class="detail-actions">' +
    readOriginal +
    '<button type="button" data-act="save" data-id="' + esc(item.id) + '" aria-pressed="' + state.saved.has(item.id) + '">' +
    (state.saved.has(item.id) ? esc(t("story.saved")) : esc(t("story.save"))) + "</button>" +
    '<button type="button" data-act="share" data-id="' + esc(item.id) + '">' + esc(t("detail.share")) + "</button>" +
    '<button type="button" data-act="more" data-id="' + esc(item.id) + '" aria-label="' + esc(t("detail.more")) + '">···</button>' +
    "</div>" +
    intro +
    factsHtml +
    impactHtml +
    notesHtml +
    repoBox +
    sourceBox +
    detailsBlock +
    attrLine +
    nextHtml;
  markRead(item.id);
  syncSavedState();
}

function setBanner(text, kind) {
  const el = document.getElementById("banner");
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  el.className = "notice" + (kind === "error" ? " error" : kind === "warn" ? " warn" : "");
  el.textContent = text;
}

function applyConnectionBanner(other) {
  const extra = String(other || "").trim();
  if (navigator.onLine === false || state.feed === "offline") {
    setBanner(t("banner.offline"), "warn");
    return;
  }
  if (state.feed === "snapshot") {
    setBanner(extra, extra ? "warn" : "");
    return;
  }
  if (state.feed === "error") {
    setBanner(extra || t("banner.error"), "error");
    return;
  }
  if (state.cached) {
    setBanner(extra || t("banner.cached"), "warn");
    return;
  }
  const stale = staleLabel();
  if (stale) {
    setBanner(t("banner.stale", { time: stale }), "warn");
    return;
  }
  setBanner(extra, extra ? "warn" : "");
}

function staleLabel() {
  if (state.feed !== "live" || (state.view !== "featured" && state.view !== "latest")) return "";
  let latest = 0;
  for (const it of state.items || []) {
    const t = Date.parse(it.publishedAt || it.firstSeenAt || it.seenAt || "");
    if (t > latest) latest = t;
  }
  if (!latest) return "";
  const hours = (Date.now() - latest) / 36e5;
  if (hours < 26) return "";
  return hours < 72 ? t("time.hoursAgo", { n: Math.round(hours) }) : t("time.daysAgo", { n: Math.round(hours / 24) });
}

function updateMeta() {
  const el = document.getElementById("meta");
  if (!el) return;
  const when = state.snapshotAt ? formatBeijing(state.snapshotAt) : "";
  el.textContent = when ? t("meta.updated", { time: when }) + (state.cached ? t("meta.cached") : "") : "";
}

// Internal operational detail (AI coverage, budget gate, source outages)
// rendered inside 设置 → 状态详情, not on the reading surface.
function statusDetailsBody() {
  const pool = (state.items || []).filter((it) => it && it.id);
  const ready = pool.filter((it) => readingMarks(it).prepared).length;
  const aiLine = pool.length
    ? t("status.ai", { ready, total: pool.length })
    : t("status.aiEmpty");
  const reasons = {
    "pricing-missing": t("status.reason.pricing-missing"),
    "pricing-invalid": t("status.reason.pricing-invalid"),
    "daily-cap": t("status.reason.daily-cap"),
    "monthly-cap": t("status.reason.monthly-cap"),
    "candidate-cap": t("status.reason.candidate-cap"),
  };
  const blocked = state.budgetStatus && state.budgetStatus.blockedReason;
  const budgetLine = blocked
    ? reasons[blocked] || t("status.budgetBlocked", { reason: blocked })
    : t("status.budgetOk");
  const failed = (state.sourceHealth || []).filter((s) => !s.ok);
  const partial = (state.sourceHealth || []).filter(s => s.ok && s.warnings?.length);
  const listJoin = isZh() ? "、" : ", ";
  const failLine = failed.length
    ? t("status.sourcesFailed", { n: failed.length, list: failed.map((s) => sourceLabel(s.source, lang()) || s.source).join(listJoin) })
    : partial.length ? t("status.sourcesPartialOk") : t("status.sourcesOk");
  return (
    "<details class='status-details'><summary>" + esc(t("status.details")) + "</summary>" +
    "<p>" + esc(aiLine) + "</p>" +
    "<p>" + esc(budgetLine) + "</p>" +
    "<p>" + esc(failLine) + "</p>" +
    (partial.length ? "<p>" + esc(t("status.partialList", { list: partial.map(s => sourceLabel(s.source, lang())).join(listJoin) })) + "</p>" : "") +
    "</details>"
  );
}

function renderReadingAside() {
  const el = document.getElementById("rail-sources");
  if (!el) return;
  const personal = state.view === "reader";
  document.getElementById("rail-title").textContent = t(personal ? "reading.sources" : "reading.publicTitle");
  document.querySelector(".rail-heading > a").hidden = !personal;
  if (!personal) {
    el.innerHTML = '<p class="rail-empty">' + esc(t("reading.publicBody")) + '</p><a class="text-link" href="#/reader">' + esc(t("reading.personalOpen")) + '</a>';
    return;
  }
  const sources = effectiveReaderSources().map(id => ({ name: sourceLabel(id, lang()) }));
  if (state.user) {
    for (const feed of state.userFeeds || []) {
      if (!feed || feed.paused) continue;
      let host = "";
      try { host = new URL(feed.url).hostname; } catch { /* use the feed name */ }
      sources.push({ name: feed.name || host || t("feeds.section") });
    }
  }
  el.innerHTML = sources.length
    ? '<p class="rail-count">' + esc(t("reading.sourceCount", { n: sources.length })) + '</p><ul class="rail-source-list">' + sources.slice(0, 6).map(source => '<li>' + sourceNameHtml(String(source.name)) + '</li>').join("") + '</ul>'
    : '<p class="rail-empty">' + esc(t("reading.noSources")) + '</p><a class="text-link" href="#/reader-settings">' + esc(t("onboarding.pick")) + '</a>';
}

function updateReadingDensity() {
  let compact = false;
  try { compact = localStorage.getItem("aquasight-density") === "compact"; } catch { /* browser storage may be unavailable */ }
  document.documentElement.dataset.density = compact ? "compact" : "comfortable";
  const button = document.getElementById("density-toggle");
  if (button) {
    button.setAttribute("aria-pressed", String(compact));
    button.textContent = t("reading.compact");
  }
}

function updateNav() {
  const readingView = ["reader", "featured", "latest", "opensource", "digest"].includes(state.view);
  const conf = VIEW_TITLES[state.view] || VIEW_TITLES.reader;
  document.getElementById("feed-navigation").hidden = !readingView;
  document.getElementById("reading-aside").hidden = !readingView;
  document.getElementById("density-toggle").hidden = state.view === "digest";
  updateReadingDensity();
  renderReadingAside();
  const modes = document.getElementById("reading-modes");
  if (modes) modes.hidden = !readingView;
  document.querySelectorAll("[data-reading-mode]").forEach(a => {
    a.hidden = a.dataset.readingMode === "reader" && state.view !== "reader";
    const on = a.dataset.readingMode === (state.view === "featured" ? "discover" : state.view);
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const title = document.getElementById("view-title");
  const subtitle = document.getElementById("view-subtitle");
  if (title) title.textContent = t(conf.titleKey);
  if (subtitle) subtitle.textContent = state.view === "event" ? "" : t(conf.subtitleKey);
  const heading = document.getElementById("feed-heading");
  if (heading) heading.hidden = state.view === "event";
  const filtersRow = document.getElementById("filters-row");
  if (filtersRow) filtersRow.hidden = ["event", "saved", "review", "digest", "reader", "reader-settings"].includes(state.view);
  document.querySelectorAll(".nav a, .bottom-nav a").forEach((a) => {
    const activeView = state.view === "event" ? (state.returnView || "featured") : state.view;
    const on = a.getAttribute("data-view") === activeView;
    if (on) {
      a.setAttribute("aria-current", "page");
      a.classList.add("active");
    } else {
      a.removeAttribute("aria-current");
      a.classList.remove("active");
    }
  });
  document.title = (state.view === "event" ? viewTitle("reader") : t(conf.titleKey)) + " · " + t("doc.titleSuffix");
  updateHeadingExtras();
}

function restoreScroll() {
  const y = state.scroll[state.view] || 0;
  window.scrollTo(0, y);
}

async function loadReads() {
  const local = readLocal("aquasight-reads", {}) || {};
  const epoch = authEpoch;
  try {
    const data = await api("/api/v1/reads");
    if (authEpoch !== epoch) return;
    state.reads = { ...local, ...(data.reads || {}) };
    persistReads();
  } catch {
    state.reads = local;
  }
}

async function loadSaved() {
  const revision = favorites.revision();
  const epoch = authEpoch;
  try {
    const data = await api("/api/v1/favorites");
    if (authEpoch !== epoch) return data;
    favorites.setRemoteAvailable(true);
    favorites.mergeRemote(data.items || [], revision);
    syncSavedState();
    return data;
  } catch (err) {
    if (authEpoch !== epoch) throw err;
    if (err.status === 404) favorites.setRemoteAvailable(false);
    syncSavedState();
    throw err;
  }
}

function loadLocalPrefs() {
  state.prefs = readLocal("aquasight-prefs", {}) || {};
  state.hiddenIds = new Set(readLocal("aquasight-hidden", []) || []);
}

async function loadList(reset) {
  const generation = ++loadGeneration;
  const current = () => generation === loadGeneration;
  if (state.view === "event") return;
  if (state.view === "reader-settings") { renderReaderSettings(); return; }
  const detail = document.getElementById("detail");
  const list = document.getElementById("list");
  const heading = document.getElementById("feed-heading");
  const filtersRow = document.getElementById("filters-row");
  detail.hidden = true;
  if (heading) heading.hidden = false;
  if (filtersRow) filtersRow.hidden = ["saved", "review", "digest", "reader", "reader-settings"].includes(state.view);
  list.hidden = false;
  if (reset) {
    list.innerHTML =
      '<div class="skeleton"><div class="bar w1"></div><div class="bar w2"></div><div class="bar w3"></div></div>'.repeat(3);
    state.items = [];
    state.cursor = null;
  }
  try {
    if (state.view === "reader") {
      if (state.user && !state.readerAccount) {
        await loadReaderAccountSettings();
        if (!current()) return;
        if (!state.readerAccount) throw new Error(t("readerSettings.readerUnavailable"));
      }
      if (state.user && !Array.isArray(state.userFeeds)) {
        await loadUserFeeds();
        if (!current()) return;
      }
      const sources = effectiveReaderSources();
      if (!sources.length && !hasActiveCustomFeeds()) {
        // 未配置来源：展示引导空态，不请求接口（服务端对空集也返回空）。
        state.items = [];
        state.cursor = null;
        document.getElementById("more-btn").hidden = true;
        renderList();
        applyConnectionBanner("");
        return;
      }
      const data = await api(
        apiUrl("/api/v1/events", {
          view: "reader",
          cursor: reset ? "" : state.cursor,
          q: state.q,
          ...(state.user ? {} : { sources: sources.join(",") }),
        })
      );
      if (!current()) return;
      // 旧生产后端不支持订阅视图：必须看到 reader:true 才算数，不做
      // 任何“用别的视图凑合显示”的假一致性回退。
      if (data.reader !== true) {
        state.feed = "error";
        list.innerHTML =
          '<div class="error-state"><p>' + esc(t("error.readerUnavailable")) + "</p>" +
          '<button type="button" class="text-link" id="retry-btn">' + esc(t("error.retry")) + "</button></div>";
        applyConnectionBanner();
        document.getElementById("retry-btn")?.addEventListener("click", () => loadList(true));
        return;
      }
      state.cached = takeCacheFlag(data);
      if (state.cached) state.stale = true;
      else state.feed = "live";
      state.snapshotAt = data.snapshotAt || "";
      state.items = reset ? data.items || [] : state.items.concat(data.items || []);
      state.cursor = data.cursor || null;
      document.getElementById("more-btn").hidden = !state.cursor;
      renderList();
      updateMeta();
      return;
    }
    if (state.view === "saved") {
      const data = await loadSaved();
      if (!current()) return;
      state.cached = data ? takeCacheFlag(data) : false;
      if (state.cached) state.stale = true;
      else state.feed = "live";
      state.items = Object.values(favorites.items());
      state.snapshotAt = (data && data.snapshotAt) || "";
      state.cursor = null;
      document.getElementById("more-btn").hidden = true;
      renderList();
      applyConnectionBanner();
      updateMeta();
      return;
    }
    if (state.view === "review") {
      const data = await api("/api/v1/review");
      if (!current()) return;
      state.cached = takeCacheFlag(data);
      if (state.cached) state.stale = true;
      state.items = data.items || [];
      renderReview(data.samples || []);
      applyConnectionBanner();
      return;
    }
    if (state.view === "digest") {
      const data = await api(
        apiUrl("/api/v1/digest", {
          q: state.q,
          category: state.topic,
          source: state.source,
          unread: state.unreadOnly ? "1" : "",
        })
      );
      if (!current()) return;
      state.cached = takeCacheFlag(data);
      if (state.cached) state.stale = true;
      else state.feed = "live";
      const digest = data.digest || {};
      state.digest = digest;
      state.items = digest.items || [];
      state.digestSummary = "";
      state.snapshotAt = data.snapshotAt || digest.snapshotAt || "";
      state.cursor = null;
      document.getElementById("more-btn").hidden = true;
      renderList();
      applyConnectionBanner();
      updateMeta();
      return;
    }
    const view = state.view;
    const data = await api(
      apiUrl("/api/v1/events", {
        view,
        cursor: reset ? "" : state.cursor,
        q: state.q,
        category: state.topic,
        source: state.source,
        unread: state.unreadOnly ? "1" : "",
      })
    );
    if (!current()) return;
    state.cached = takeCacheFlag(data);
    if (state.cached) state.stale = true;
    else state.feed = "live";
    state.snapshotAt = data.snapshotAt || "";
    state.items = reset ? data.items || [] : state.items.concat(data.items || []);
    state.cursor = data.cursor || null;
    document.getElementById("more-btn").hidden = !state.cursor;
    renderList();
    try {
      const st = await api("/api/v1/status/public");
      if (!current()) return;
      state.budgetStatus = st.budgetCaps;
      state.sourceHealth = st.sources || [];
      // Reader banner carries only what changes the reading experience;
      // budget and per-source operational detail lives in 设置 → 状态详情.
      const bits = [];
      if (st.emptyMeansFailure) bits.push(t("banner.collectFail"));
      applyConnectionBanner(bits.join(" · "));
    } catch {
      if (!current()) return;
      applyConnectionBanner();
    }
    updateMeta();
  } catch (e) {
    if (!current()) return;
    if (reset) {
      if (state.view === "saved") {
        state.items = Object.values(state.savedItems || {});
        state.feed = "snapshot";
        state.cached = false;
        applyConnectionBanner();
        updateMeta();
        renderList();
        return;
      }
      if (state.view === "reader") {
        // 订阅流绝不用全站公开快照兜底（那等于把整个公共流塞进个人订阅，
        // 也会绕过来源/安全链接过滤）：明确报错 + 重试，与原生一致。
        state.feed = navigator.onLine === false ? "offline" : "error";
        state.items = [];
        list.innerHTML =
          '<div class="error-state"><p>' + esc(t("error.readerLoad")) + "</p>" +
          '<button type="button" class="text-link" id="retry-btn">' + esc(t("error.retry")) + "</button></div>";
        applyConnectionBanner();
        document.getElementById("retry-btn")?.addEventListener("click", () => loadList(true));
        return;
      }
      const fallback =
        state.view === "digest" ? await loadDigestJson() : await loadEventsJson();
      if (!current()) return;
      if (fallback) {
        applySnapshot(fallback, state.view);
        applyConnectionBanner(e.status === 404 ? "" : t("banner.snapshot"));
        updateMeta();
        renderList();
        return;
      }
      if (state.view === "digest" && e.status === 404) {
        state.digest = { missing: true, items: [] };
        state.items = [];
        renderList();
        setBanner("");
        return;
      }
      if (state.view === "review" && e.status === 404) {
        list.innerHTML = '<p class="empty">' + esc(t("error.reviewOffline")) + "</p>";
        return;
      }
      state.feed = navigator.onLine === false ? "offline" : "error";
      list.innerHTML =
        '<div class="error-state"><p>' + esc(t("error.generic")) + '</p><button type="button" class="text-link" id="retry-btn">' + esc(t("error.retry")) + "</button></div>";
      applyConnectionBanner();
      updateMeta();
      document.getElementById("retry-btn")?.addEventListener("click", () => loadList(true));
    } else {
      toast(t("error.noMore"));
    }
  }
}

async function loadJsonFile(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000) });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && typeof data === "object") return data;
    } catch {
      // ignore
    }
  }
  return null;
}

async function loadEventsJson() {
  const data = await loadJsonFile(["./events.json", "../data/events.json"]);
  return data && Array.isArray(data.items) ? data : null;
}

async function loadDigestJson() {
  const data = await loadJsonFile(["./digest.json", "../data/digest.json"]);
  if (!data) return null;
  if (Array.isArray(data.items) || data.tech || data.business || data.public) return data;
  if (data.digest) return data.digest;
  return null;
}

function snapshotItems(data) {
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.items)) return data.items;
  return [].concat(data.tech || [], data.business || [], data.public || [], data.hot || [], data.other || []);
}

function applySnapshot(data, view) {
  state.budgetStatus = data.budget || state.budgetStatus;
  const items = visibleCards(snapshotItems(data));
  state.snapshotAt = data.snapshotAt || data.updatedAt || state.snapshotAt || "";
  state.feed = "snapshot";
  state.cached = false;
  state.stale = false;
  state.cursor = null;
  const more = document.getElementById("more-btn");
  if (more) more.hidden = true;
  if (view === "digest") {
    state.digest = data;
    state.items = data.items || [];
    state.digestSummary = "";
    return;
  }
  const featuredIds = Array.isArray(data.featured) ? data.featured : [];
  if (view === "featured") {
    if (featuredIds.length) {
      const map = new Map(items.map((it) => [it.id, it]));
      const picked = featuredIds.map((id) => map.get(id)).filter(Boolean);
      state.items = picked.length ? picked : items.slice(0, 30);
    } else {
      state.items = items.slice(0, 30);
    }
  } else if (view === "latest") {
    state.items = items.slice().sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  } else if (view === "opensource") {
    // Static fallback keeps the project entry usable without the API, with
    // the same observation window/ordering rules as the server view.
    state.items = opensourceViewItems(items);
  } else {
    state.items = items;
  }
}

async function findSnapshotEvent(id) {
  const data = await loadEventsJson();
  state.budgetStatus = data?.budget || state.budgetStatus;
  const fromEvents = snapshotItems(data).find((it) => it && it.id === id);
  if (fromEvents) return fromEvents;
  return snapshotItems(await loadDigestJson()).find((it) => it && it.id === id) || null;
}

/// 订阅详情本地复核（网络结果与本机副本一视同仁）：primary source 必须在
/// 当前订阅中、原文链接必须是安全 http(s)、hidden 类内容一律不放行。
function readerDetailAllowed(item, readerSources) {
  if (!item) return false;
  // 自定义 RSS 条目（owner-private）不受内置白名单门控，只要求安全链接。
  if (item.personalFeed === true || item.source === "rss") {
    return safeReaderUrl(item.url) !== "";
  }
  if (!readerSources.includes(String(item.source || ""))) return false;
  if (item.category === "hidden") return false;
  return safeReaderUrl(item.url) !== "";
}

async function loadEvent(id) {
  const generation = ++loadGeneration;
  const current = () => generation === loadGeneration;
  state.returnView = state.returnView || (state.detailReader ? "reader" : "featured");
  const readerMode = state.detailReader === true;
  const readerSources = readerMode ? effectiveReaderSources() : null;
  const detail = document.getElementById("detail");
  const showDetailError = (title, body, cta) => {
    document.getElementById("list").hidden = true;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="empty"><h2>' + esc(title) + "</h2><p>" + esc(body) + "</p>" +
      (cta || '<a class="text-link" href="#/reader">' + esc(t("error.backReader")) + "</a>") + "</div>";
  };
  detail.innerHTML =
    '<div class="skeleton"><div class="bar w1"></div><div class="bar w2"></div><div class="bar w3"></div></div>';
  try {
    // 订阅详情走 reader=1：服务端按有效来源 + 安全原文链接把关；游客附
    // 带本机选择的 sources（仅基础集，服务端仍会过滤）。
    const query = new URLSearchParams();
    if (readerMode) {
      query.set("reader", "1");
      if (!state.user) query.set("sources", readerSources.join(","));
    }
    const qs = query.toString();
    const data = await api("/api/v1/events/" + encodeURIComponent(id) + (qs ? "?" + qs : ""));
    if (!current()) return;
    if (readerMode && !readerDetailAllowed(data.item, readerSources)) {
      showDetailError(t("error.notInSubscription"), t("error.notInSubscriptionBody"), '<a class="text-link" href="#/reader-settings">' + esc(t("error.manageSubs")) + "</a>");
      return;
    }
    renderDetail(data.item, data.members || []);
    if (data.snapshotAt) state.snapshotAt = data.snapshotAt;
    updateMeta();
  } catch (e) {
    if (!current()) return;
    const authoritative = e.status === 404 || e.status === 401 || e.status === 403;
    if (readerMode) {
      // 服务端明确拒绝（404/401/403）时不得用本机副本“复活”被订阅规则
      // 排除或不安全的内容；仅网络类失败允许本机已保存副本兜底（同原生
      // offline 副本），且兜底同样过订阅/安全链接复核。
      const local = authoritative ? null : state.savedItems[id] || state.items.find((it) => it.id === id);
      if (local && readerDetailAllowed(local, readerSources)) {
        renderDetail(local, local.sources || []);
        return;
      }
      showDetailError(
        local ? t("error.notInSubscription") : t("error.cannotOpen"),
        local ? t("error.notInSubscriptionBody") : t("error.cannotOpenBody")
      );
      return;
    }
    const local = state.savedItems[id] || state.items.find((it) => it.id === id);
    if (local) {
      renderDetail(local, local.sources || []);
      return;
    }
    const snap = await findSnapshotEvent(id);
    if (!current()) return;
    if (snap) {
      state.feed = "snapshot";
      renderDetail(snap, snap.sources || []);
      updateMeta();
      return;
    }
    showDetailError(t("error.notFound"), t("error.notFoundBody"), '<a class="text-link" href="#/featured">' + esc(t("error.backFeatured")) + "</a>");
  }
}

function renderReview(samples) {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  detail.hidden = true;
  list.hidden = false;
  list.innerHTML =
    '<p class="notice">' + esc(t("review.note", { n: samples.length })) + "</p>" +
    state.items.map((it) => storyHtml(it) + reviewButtons(it)).join("");
}

async function act(id, kind, item) {
  try {
    if (kind === "save") {
      const save = !favorites.has(id);
      const snap = snapshotOf(item) || snapshotOf(state.detailItem?.id === id ? state.detailItem : null);
      if (save && !snap) { toast(t("toast.nothingToSave")); return; }
      favorites.set(id, save ? snap : null);
      const feedbackSeq = state.favoriteAction = (state.favoriteAction || 0) + 1;
      const localMessage = save ? t("toast.saved") : t("toast.unsaved");
      toast(localMessage + (favorites.isAvailable() && favorites.pending(id) ? t("toast.pendingSync") : ""));
      if (favorites.isAvailable()) {
        await favorites.sync();
        if (state.favoriteAction === feedbackSeq) {
          toast(favorites.pending(id) ? localMessage + t("toast.pendingSync") : localMessage);
        }
      }
      return;
    } else if (kind === "share") {
      const url = location.origin + location.pathname + "#/event/" + encodeURIComponent(id);
      if (navigator.share) await navigator.share({ title: displayTitle(item || { title: url }), url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t("toast.linkCopied"));
      }
    } else if (kind === "read") {
      const next = !state.reads[id];
      if (next) state.reads[id] = new Date().toISOString();
      else delete state.reads[id];
      persistReads();
      try {
        await api("/api/v1/reads", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId: id, read: next }),
        });
      } catch {
        // kept on this device
      }
    } else if (kind === "hide" || kind === "like" || kind === "dislike") {
      if (kind === "hide") {
        state.hiddenIds.add(id);
        persistHidden();
        state.hideUndo = { id };
      }
      try {
        const data = await api("/api/v1/feedback", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, eventId: id, topic: item && item.subject, source: item && item.source }),
        });
        state.lastFeedbackId = data.feedback && data.feedback.id;
        if (kind === "hide") state.hideUndo = { id, feedbackId: state.lastFeedbackId };
      } catch {
        state.lastFeedbackId = "";
      }
      if (kind === "like" || kind === "dislike") state.rated[id] = kind;
      toast(kind === "hide" ? t("toast.hidden") : kind === "like" ? t("toast.liked") : t("toast.disliked"));
      if (kind === "hide") {
        if (state.view === "event") {
          location.hash = "#/" + (state.returnView || "featured");
          return;
        }
        renderList();
        return;
      }
      if (state.view === "review") {
        try {
          const review = await api("/api/v1/review");
          renderReview(review.samples || []);
        } catch {
          renderReview([]);
        }
        return;
      }
    } else if (kind === "undo") {
      const undoId = state.hideUndo && state.hideUndo.id;
      if (undoId) state.hiddenIds.delete(undoId);
      persistHidden();
      if (state.lastFeedbackId) {
        try {
          await api("/api/v1/feedback", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ undoId: state.lastFeedbackId }),
          });
        } catch {
          // local undo still applied
        }
      }
      state.hideUndo = null;
      state.lastFeedbackId = "";
      toast(t("toast.undone"));
      renderList();
      return;
    }
    if (state.view === "event" && state.detailItem && kind !== "share") {
      renderDetail(state.detailItem, state.detailMembers || []);
      return;
    }
    if (state.view !== "event" && state.view !== "review" && kind !== "share") renderList();
  } catch (e) {
    toast(t("toast.actionFailed", { msg: e.message || t("toast.networkError") }));
  }
}

async function route() {
  loadGeneration++; // Navigation invalidates in-flight lists before they can replace the settings form.
  state.scroll[state.view] = window.scrollY;
  // Public content is the default for guests and signed-in readers alike.
  if (!location.hash) history.replaceState(null, "", "#/featured");
  const parsed = parseHash();
  if (parsed.view !== "event") state.returnView = parsed.view;
  // reader 详情只由 URL 显式声明（?reader=1）：与内存状态无关，刷新/深链
  // 语义稳定；从精选等普通入口进来的详情不受订阅上下文影响。
  state.detailReader = parsed.view === "event" ? parsed.readerDetail === true : false;
  state.view = parsed.view;
  state.eventId = parsed.eventId;
  updateNav();
  if (parsed.view === "event") {
    await loadEvent(parsed.eventId);
    if (state.eventId === parsed.eventId) window.scrollTo(0, 0);
    return;
  }
  if (parsed.view === "reader-settings") {
    renderReaderSettings();
    window.scrollTo(0, 0);
    return;
  }
  await loadList(true);
  if (state.view === parsed.view) restoreScroll();
}

/* ---------- 个人订阅（阅读器）设置页 ---------- */

// 草稿绑定账户：内存草稿带 owner（账户邮箱）；账户切换/退出时清空内存，
// 持久化草稿按 owner 分 key 保留，A 未保存的选择不会进入 B。
let readerDraft = null; // { owner, selected:Set, more:Bool }
let readerRenderGeneration = 0;

const readerDraftKey = (owner) => "aquasight-reader-draft:" + owner;

function readerDraftOwner() {
  return state.user?.email || "guest";
}

function readerDraftLoad() {
  const owner = readerDraftOwner();
  if (readerDraft && readerDraft.owner === owner) return readerDraft;
  try {
    const raw = readLocal(readerDraftKey(owner), null);
    if (raw && Array.isArray(raw.selected)) {
      readerDraft = { owner, selected: new Set(raw.selected), more: raw.more === true };
      return readerDraft;
    }
  } catch {}
  readerDraft = null;
  return null;
}

function readerDraftPersist(draft) {
  readerDraft = draft;
  const owner = readerDraftOwner();
  try {
    if (draft && draft.owner === owner) {
      localStorage.setItem(readerDraftKey(owner), JSON.stringify({ selected: [...draft.selected], more: draft.more }));
    } else {
      localStorage.removeItem(readerDraftKey(owner));
    }
  } catch {}
}

/// 账户切换/登出时调用：清内存草稿（持久化按 owner 隔离保留）并作废渲染。
function readerDraftOnAuthChanged() {
  readerDraft = null;
  readerRenderGeneration++;
}

function renderReaderSettings() {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const pager = document.querySelector(".pager");
  if (detail) detail.hidden = true;
  if (pager) pager.hidden = true;
  if (list) list.hidden = false;
  const digestSummary = document.getElementById("digest-summary");
  if (digestSummary) digestSummary.hidden = true;
  // 重新打开页面时作废上一代未完成的渲染，旧请求不得写进新 DOM。
  readerRenderGeneration++;

  if (!state.user) {
    // 游客也可以选来源：与原生一致，选择显式保存在本机（仅基础集），
    // 登录后可同步为账户订阅。
    if (list) {
      list.innerHTML =
        '<div class="reader-page" id="reader-root">' +
        '<p class="reader-intro">' + esc(t("readerSettings.guestIntro")) + "</p>" +
        '<p class="reader-status" id="reader-status">' + esc(t("readerSettings.loading")) + "</p>" +
        '<div id="reader-body"></div>' +
        '<p id="reader-error" class="form-error" hidden></p>' +
        '<div class="reader-actions" id="reader-actions">' +
        '<button type="button" class="primary" id="reader-save" disabled>' + esc(t("readerSettings.save")) + "</button>" +
        '<button type="button" class="text-link" data-action="back-home">' + esc(t("readerSettings.back")) + "</button></div>" +
        '<p class="reader-hint">' + t("readerSettings.loginHint") + "</p></div>";
    }
    loadReaderSettings();
    return;
  }

  if (list) {
    list.innerHTML =
      '<div class="reader-page" id="reader-root">' +
      '<p class="reader-status" id="reader-status">' + esc(t("readerSettings.loading")) + "</p>" +
      '<div id="reader-body"></div>' +
      '<p id="reader-error" class="form-error" hidden></p>' +
      '<div class="reader-actions" id="reader-actions">' +
      '<button type="button" class="primary" id="reader-save" disabled>' + esc(t("readerSettings.save")) + "</button>" +
      '<button type="button" class="text-link" data-action="back-home">' + esc(t("readerSettings.back")) + "</button></div>" +
      '<p class="reader-hint">' + esc(t("readerSettings.userHint")) + "</p></div>";
  }
  loadReaderSettings();
}

async function loadReaderSettings() {
  const body = document.getElementById("reader-body");
  const status = document.getElementById("reader-status");
  const error = document.getElementById("reader-error");
  const saveBtn = document.getElementById("reader-save");
  if (!body) return;
  const epoch = authEpoch;
  const renderGen = readerRenderGeneration;
  let catalog = null;
  let reader = null;
  try {
    if (state.user) {
      const [cat, set] = await Promise.all([
        api("/api/v1/reader/catalog"),
        api("/api/v1/reader/settings"),
      ]);
      if (authEpoch !== epoch) return;            // 账户切换：过期响应不更新 UI
      if (renderGen !== readerRenderGeneration) return; // 离开又返回：旧响应不写新 DOM
      catalog = cat.sources || [];
      reader = set.reader || {};
      state.readerAccount = reader; // 订阅详情/阅读流要用的账户侧来源
    } else {
      const cat = await api("/api/v1/reader/catalog");
      if (authEpoch !== epoch) return;
      if (renderGen !== readerRenderGeneration) return;
      catalog = cat.sources || [];
      state.readerCatalog = catalog; // 订阅门控（基础/扩展）依赖真实目录
      const guest = guestReaderSelection();
      reader = { selectedSources: guest.selected, moreSourcesEnabled: false, configured: guest.configured };
    }
  } catch (e) {
    if (authEpoch !== epoch) return;
    if (renderGen !== readerRenderGeneration) return;
    if (status) status.textContent = "";
    if (error) {
      error.hidden = false;
      error.textContent = t("readerSettings.loadFailed", { msg: e.message || t("toast.networkError") });
    }
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = t("readerSettings.retryLoad");
      saveBtn.onclick = () => {
        if (error) error.hidden = true;
        if (status) status.textContent = t("readerSettings.loading");
        if (saveBtn) {
          saveBtn.textContent = t("readerSettings.save");
          saveBtn.disabled = true;
        }
        loadReaderSettings();
      };
    }
    return;
  }
  if (status) status.textContent = "";
  const draft = readerDraftLoad();
  const selected = draft ? draft.selected : new Set(reader.selectedSources || []);
  const more = draft ? draft.more : reader.moreSourcesEnabled === true;
  renderReaderBody(catalog, selected, more, reader.configured === true);
  if (draft) {
    if (error) {
      error.hidden = false;
      error.textContent = t("readerSettings.unsavedDraft");
    }
  }
}

function renderReaderBody(catalog, selected, more, configured, opts = {}) {
  const body = document.getElementById("reader-body");
  const saveBtn = document.getElementById("reader-save");
  if (!body) return;
  const restoreFocus = opts.restoreFocus === true || opts.restoreFocus === "more";
  // 分组以 sources.extended 判定，不依赖 group 字符串。
  const basicGroups = new Map();
  const extended = [];
  for (const s of catalog) {
    if (s.extended) { extended.push(s); continue; }
    if (!["github", "openai"].includes(s.id) && !selected.has(s.id)) continue;
    if (!basicGroups.has(s.group)) basicGroups.set(s.group, []);
    basicGroups.get(s.group).push(s);
  }
  const row = (s, locked) =>
    '<label class="setting-row reader-source' + (locked ? " locked" : "") + '">' +
    '<span class="reader-source-text"><span class="reader-source-name">' + esc(localizedSourceName(s)) +
    (locked ? ' <span class="reader-lock">' + esc(t("readerSettings.locked")) + "</span>" : "") + "</span>" +
    '<span class="reader-source-desc">' + esc(localizedSourceDesc(s)) + "</span></span>" +
    '<input type="checkbox" data-reader-source value="' + esc(s.id) + '"' +
    (selected.has(s.id) ? " checked" : "") + (locked ? " disabled" : "") + "></label>";
  const guest = !state.user;
  let html = "";
  if (!guest) {
    html +=
      '<label class="setting-row reader-more-row" for="reader-more">' +
      '<span class="reader-source-text"><span class="reader-source-name">' + esc(t("readerSettings.moreSources")) + "</span>" +
      '<span class="reader-source-desc">' + esc(t("readerSettings.moreSourcesDesc")) + "</span></span>" +
      '<input type="checkbox" id="reader-more"' + (more ? " checked" : "") + "></label>";
  }
  for (const [group, sources] of basicGroups) {
    html += '<p class="subhead">' + esc(localizedGroupName(group)) + "</p>" + sources.map((s) => row(s, false)).join("");
  }
  if (guest) {
    // 游客与原生一致：只能选基础集；扩展来源需登录后开启。
    html += '<p class="subhead">' + esc(t("readerSettings.moreGroup")) + "</p>" +
      '<p class="reader-hint">' + esc(t("readerSettings.guestMoreHint", { list: extended.map((s) => esc(localizedSourceName(s))).join(isZh() ? "、" : ", ") })) + "</p>";
  } else {
    html += '<p class="subhead">' + esc(more ? t("readerSettings.moreGroup") : t("readerSettings.moreGroupOff")) + "</p>";
    if (!more) {
      html += '<p class="reader-hint">' + esc(t("readerSettings.moreHint", { list: extended.map((s) => esc(localizedSourceName(s))).join(isZh() ? "、" : ", ") })) + "</p>";
      // 保留已选扩展来源（锁定展示），关闭开关不清空选择。
      const chosen = extended.filter((s) => selected.has(s.id));
      html += chosen.length ? chosen.map((s) => row(s, true)).join("") : "";
    } else {
      html += extended.map((s) => row(s, false)).join("");
    }
    // 推荐组合（仅登录用户可见，显式一键加入；游客不显示组合卡片）。
    html += bundleCardsHtml(selected);
  }
  body.innerHTML = html;
  // 自定义 RSS 区块与目录区块分开渲染（独立加载与刷新）。
  const feedsBox = document.getElementById("custom-feeds");
  if (!feedsBox) {
    const extra = document.createElement("div");
    extra.id = "custom-feeds";
    body.appendChild(extra);
  }
  void refreshCustomFeedsSection();

  const moreToggle = document.getElementById("reader-more");
  if (moreToggle) {
    moreToggle.addEventListener("change", () => {
      collectReaderDraft();
      // 重建后恢复 toggle 的键盘焦点，键盘/读屏用户不丢位置。
      renderReaderBody(catalog, readerDraft.selected, moreToggle.checked, configured, { restoreFocus: true });
    });
    if (restoreFocus) moreToggle.focus();
  }
  const wantedBundle = opts.refocusBundle;
  if (wantedBundle) body.querySelector('[data-bundle="' + wantedBundle + '"]')?.focus();
  body.querySelectorAll("[data-reader-source]").forEach((el) => {
    el.addEventListener("change", collectReaderDraft);
  });
  body.querySelectorAll("[data-bundle]").forEach((el) => {
    el.addEventListener("click", () => {
      const ids = String(el.dataset.ids || "").split(",").map((x) => x.trim()).filter(Boolean);
      collectReaderDraft();
      for (const id of ids) readerDraft.selected.add(id);
      // 重建以勾选组合来源；焦点回到组合按钮。
      renderReaderBody(catalog, readerDraft.selected, more, configured, { restoreFocus: true, refocusBundle: el.dataset.bundle });
    });
  });
  if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = t("readerSettings.save");
    saveBtn.onclick = () => saveReaderSettings(catalog);
  }
}

/// Localize server catalog entries for non-Chinese readers; the Chinese
/// catalog text stays the fallback for unknown ids/groups.
function localizedSourceName(s) {
  if (isZh()) return s.label || "";
  return sourceLabel(s.id, "en") !== s.id ? sourceLabel(s.id, "en") : (s.label || "");
}
function localizedSourceDesc(s) {
  if (isZh()) return s.description || "";
  return ({ github: "Discover useful open-source projects", "github-trending": "Repositories trending today", "github-trending-weekly": "Repositories gaining interest this week", "github-maintained": "Actively maintained open-source projects", openai: "Official OpenAI updates", huggingface: "Research papers and popular models" })[s.id] || s.descriptionEn || s.label || "";
}
function localizedGroupName(group) {
  if (isZh()) return group;
  const map = { "开源项目": "Open source", "技术与研究": "Tech & research", "更多来源": "More sources", "科技媒体": "Tech media", "中文媒体": "Chinese media" };
  return map[group] || group;
}

/// 登录用户的推荐组合卡：一键勾选一组来源（仍走显式保存流程）。
function bundleCardsHtml(selected) {
  if (!state.user) return "";
  const bundles = [
    { key: "opensource", ids: ["github", "github-trending", "github-trending-weekly", "github-maintained"] },
    { key: "research", ids: ["openai", "huggingface"] },
  ];
  return bundles.map((b) => {
    const all = b.ids.every((id) => selected.has(id));
    return '<div class="setting-row bundle-row">' +
      '<span class="reader-source-text"><span class="reader-source-name">' + esc(t("bundles." + b.key + ".title")) + "</span>" +
      '<span class="reader-source-desc">' + esc(t("bundles." + b.key + ".desc")) + "</span></span>" +
      '<button type="button" class="text-link" data-bundle="' + esc(b.key) + '" data-ids="' + esc(b.ids.join(",")) + '"' + (all ? " disabled" : "") + '>' +
      esc(all ? t("bundles.added") : t("bundles.add")) + "</button></div>";
  }).join("");
}

function collectReaderDraft() {
  const selected = new Set(
    [...document.querySelectorAll("[data-reader-source]")].filter((el) => el.checked).map((el) => el.value)
  );
  const moreEl = document.getElementById("reader-more");
  readerDraftPersist({ owner: readerDraftOwner(), selected, more: moreEl ? moreEl.checked : false });
}

async function saveReaderSettings(catalog) {
  const saveBtn = document.getElementById("reader-save");
  const error = document.getElementById("reader-error");
  const body = document.getElementById("reader-body");
  if (!saveBtn || saveBtn.disabled) return;
  collectReaderDraft();
  const draft = readerDraft || { owner: readerDraftOwner(), selected: new Set(), more: false };
  const epoch = authEpoch;
  const renderGen = readerRenderGeneration;
  // 保存期间禁用整页编辑控件，防止旧成功回调覆盖保存中新做的修改。
  saveBtn.disabled = true;
  saveBtn.textContent = t("readerSettings.saving");
  if (body) body.querySelectorAll("input[type=checkbox]").forEach((el) => { el.disabled = true; });
  if (!state.user) {
    // 游客：显式保存在本机（仅基础集）。返回「阅读」时 route() 会重新拉
    // 取订阅流，立即按新来源渲染。
    const basicIds = new Set(catalog.filter((s) => !s.extended).map((s) => s.id));
    const selected = [...draft.selected].filter((id) => basicIds.has(id));
    persistGuestReaderSelection(selected, true);
    readerDraftPersist(null);
    if (authEpoch !== epoch) return;
    if (renderGen !== readerRenderGeneration) return;
    toast(t("toast.readerSavedGuest"));
    if (error) error.hidden = true;
    renderReaderBody(catalog, new Set(selected), false, true);
    if (state.view === "reader") loadList(true);
    return;
  }
  try {
    const data = await api("/api/v1/reader/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        selectedSources: [...draft.selected],
        moreSourcesEnabled: draft.more,
      }),
    });
    if (authEpoch !== epoch) return;                 // 保存期间账户切换
    if (renderGen !== readerRenderGeneration) return; // 保存期间离开页面：不回写新 DOM
    readerDraftPersist(null); // 保存成功才清草稿
    toast(t("toast.readerSavedUser"));
    if (error) error.hidden = true;
    // 成功响应回带 reader：既驱动 UI，也更新账户侧来源（订阅详情要用）。
    state.readerAccount = data.reader || state.readerAccount;
    renderReaderBody(catalog, new Set(data.reader?.selectedSources || []), data.reader?.moreSourcesEnabled === true, true);
    if (state.view === "reader") loadList(true);
  } catch (e) {
    if (authEpoch !== epoch) return;
    if (renderGen !== readerRenderGeneration) return;
    // 失败：恢复控件可用，保留草稿与当前选择，可重试。
    if (body) body.querySelectorAll("input[type=checkbox]").forEach((el) => {
      const lockedRow = el.closest(".reader-source.locked");
      if (!lockedRow) el.disabled = false;
    });
    if (error) {
      error.hidden = false;
      error.textContent = t("readerSettings.saveFailed", { msg: e.message || t("toast.networkError") });
    }
    saveBtn.disabled = false;
    saveBtn.textContent = t("readerSettings.retrySave");
    saveBtn.onclick = () => saveReaderSettings(catalog);
  }
}

/* ---------- dialogs ---------- */

const modal = () => document.getElementById("modal");
let lastFocus = null;
let loginResendTimer = null;

function openDialog(title, bodyHtml) {
  const m = modal();
  if (!m.open) lastFocus = document.activeElement;
  m.setAttribute("aria-labelledby", "dialog-title");
  m.innerHTML =
    '<div class="dialog-heading"><h2 id="dialog-title">' + esc(title) + '</h2><button type="button" class="close" data-close>' + esc(t("dialog.close")) + "</button></div>" +
    bodyHtml;
  if (!m.open) m.showModal();
  return m;
}
/// 登录请求 pending 期间禁止关闭/切模式（防晚到响应写错上下文）。
/// 成功路径用 closeDialog(true) 强制关闭。
let loginBusy = false;

function wipeSecretInputs(root) {  // 关闭即销毁：清空所有密码/验证码字段并移除表单 DOM，保证没有任何输
  // 入残留在文档里（原生 Escape/cancel 同样走这里）。
  root?.querySelectorAll("input[type=password], input#login-code").forEach((el) => { el.value = ""; });
  root?.querySelectorAll("form").forEach((f) => f.remove());
}

function closeDialog(force = false) {
  const m = modal();
  if (loginBusy && !force) return;   // pending 请求期间锁定弹窗
  if (loginResendTimer) { clearInterval(loginResendTimer); loginResendTimer = null; }
  // 登录流程的暂态（邮箱步骤、模式）随弹窗关闭清空；密码/验证码字段
  // 先清空再连同表单 DOM 一起销毁，不落入 state/localStorage。
  state.loginEmail = "";
  state.loginMode = "";
  wipeSecretInputs(m);
  if (m.open) m.close();
  m.innerHTML = "";
  lastFocus?.focus?.({ preventScroll: true });
}

function bindDialogHygiene() {
  const m = modal();
  // 原生 Escape / cancel 事件同样要清空敏感字段。
  m?.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeDialog();
  });
  // 「关闭」按钮在 pending 期间禁用由 openDialog 渲染后统一处理。
  m?.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]") && loginBusy) { e.preventDefault(); e.stopImmediatePropagation(); }
  });
}

function paintAccount() {
  const label = document.getElementById("account-label");
  const avatar = document.querySelector("#account-btn .avatar");
  if (state.user && state.user.email) {
    if (label) label.textContent = state.user.email;
    if (avatar) avatar.textContent = state.user.email[0].toUpperCase();
  } else {
    if (label) label.textContent = t("side.login");
    if (avatar) avatar.textContent = t("side.avatarGuest");
  }
}

async function refreshMe() {
  const epoch = authEpoch;
  try {
    const data = await api("/api/v1/me");
    if (authEpoch !== epoch) return;
    state.user = data.guest ? null : data.user;
  } catch {
    if (authEpoch !== epoch) return;
    state.user = null;
  }
  paintAccount();
}

async function purgeUserCaches() {
  try {
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("aquasight-")).map((k) => caches.delete(k)));
    }
  } catch {
    // ignore
  }
}

async function onAuthChanged() {
  authEpoch++;
  loadGeneration++;
  // 订阅草稿绑定账户：切换/退出后清内存草稿（持久化按账户隔离保留），
  // 并作废 reader 设置页在途渲染。
  readerDraftOnAuthChanged();
  // 账户侧订阅与订阅流数据立即作废：登出回到游客本机选择，登录换用
  // 新账户的订阅；旧账户的条目不得残留。
  state.readerAccount = null;
  state.userFeeds = null;
  state.items = [];
  state.cursor = null;
  state.detailReader = false;
  await purgeUserCaches();
  await refreshMe();
  await loadReaderCatalog();
  if (state.user) await loadReaderAccountSettings();
  syncSavedState();
  // 登录态变化后当前页若是订阅设置，立即按新身份重渲染（登出后可看到
  // 登录入口，登录后直接显示该账户的订阅）。
  if (state.view === "reader-settings") renderReaderSettings();
}

function settingsBody() {
  const account = state.user
    ? '<div class="setting-row"><span>' + esc(t("settings.accountRow")) + '</span><span>' + esc(state.user.email) + "</span></div>" +
      '<button type="button" class="text-link" data-action="login" style="text-align:left">' + esc(t("settings.manageLogin")) + "</button>"
    : '<div class="setting-row"><span>' + esc(t("settings.account")) + '</span><button type="button" class="text-link" data-action="login">' + esc(t("settings.login")) + "</button></div>" +
      "<p>" + esc(t("settings.loginHint")) + "</p>";
  const langRow =
    '<p class="subhead">' + esc(t("settings.language")) + "</p>" +
    '<div class="setting-row language-row"><span>' + esc(t("settings.languageHint")) + '</span><span class="language-options">' +
    '<button type="button" class="text-link" data-action="language-zh" aria-pressed="' + (lang() === "zh") + '">中文</button>' +
    '<button type="button" class="text-link" data-action="language-en" aria-pressed="' + (lang() === "en") + '">English</button>' +
    "</span></div>";
  return (
    '<p class="subhead">' + esc(t("settings.appearance")) + "</p>" +
    '<div class="setting-row"><label for="theme-select">' + esc(t("settings.theme")) + '</label><select id="theme-select">' +
    '<option value="system">' + esc(t("settings.theme.system")) + '</option><option value="light">' + esc(t("settings.theme.light")) + '</option><option value="dark">' + esc(t("settings.theme.dark")) + "</option>" +
    "</select></div>" +
    langRow +
    '<div class="setting-row"><span>' + esc(t("settings.sources")) + '</span><button type="button" class="text-link" data-action="reader-settings">' + esc(t("settings.manage")) + "</button></div>" +
    '<details class="optional-settings"><summary>' + esc(t("settings.digestPrefs")) + "</summary><p>" + esc(t("settings.digestPrefsBody")) + "</p>" +
    '<button type="button" class="text-link" data-action="review">' + esc(t("settings.digestPrefsBtn")) + "</button></details>" +
    '<p class="subhead">' + esc(t("settings.accountSection")) + "</p>" + account +
    '<p class="subhead">' + esc(t("settings.data")) + "</p>" +
    '<div class="setting-row"><span>' + esc(t("settings.cache")) + '</span><button type="button" class="text-link" data-action="clear-cache">' + esc(t("settings.clearCache")) + "</button></div>" +
    '<div class="setting-row"><span>' + esc(t("settings.localData")) + '</span><button type="button" class="text-link danger-text" data-action="reset-data">' + esc(t("settings.reset")) + "</button></div>" +
    statusDetailsBody() +
    '<p id="settings-save-note" class="form-error" hidden></p>'
  );
}

/// 登录弹窗：默认邮箱 + 密码；注册 / 找回密码（含老账户首次设置密码）
/// 走 邮箱 → 验证码 → 新密码 的共用流程。密码与验证码只存在表单里，
/// 不写入 state/localStorage/日志，切换模式或关闭弹窗即随 DOM 销毁。
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;
/// 与服务器一致：按 Unicode codepoints 计数（[...str].length）。
const codepoints = (s) => [...String(s || "")].length;
const validPasswordInput = (s) => {
  const n = codepoints(s);
  return n >= PASSWORD_MIN && n <= PASSWORD_MAX && new Blob([s]).size <= 512;
};

/// 登录/发码/重置请求 pending 期间统一锁定：输入、模式切换入口、关闭
/// 按钮、Escape/点击外部（closeDialog/busy 卫生统一兜底）。成功路径用
/// closeDialog(true) 强制关闭。
function setLoginBusy(on) {
  loginBusy = on;
  const m = modal();
  if (!m) return;
  m.querySelectorAll("#login-form input, #login-form button, #code-email-form input, #code-email-form button, #code-password-form input, #code-password-form button, .login-alt .text-link, #login-change-email")
    .forEach((el) => {
      if (el.dataset.busyLock === undefined) el.dataset.busyLock = el.disabled ? "1" : "";
      if (on) el.disabled = true;
      else if (el.dataset.busyLock === "") el.disabled = false;
    });
  m.querySelector("[data-close]")?.toggleAttribute("disabled", on);
  if (!on) m.querySelectorAll("[data-busy-lock]").forEach((el) => delete el.dataset.busyLock);
}

function loginPasswordBody() {
  return (
    '<p class="login-explain">' + esc(t("login.explain")) + "</p>" +
    '<form id="login-form" novalidate>' +
    '<label class="field-label" for="login-email">' + esc(t("login.email")) + "</label>" +
    '<input id="login-email" type="email" required placeholder="you@example.com" autocomplete="username" inputmode="email" spellcheck="false">' +
    '<label class="field-label" for="login-password">' + esc(t("login.password")) + "</label>" +
    '<div class="pw-wrap">' +
    '<input id="login-password" type="password" required autocomplete="current-password" placeholder="' + esc(t("login.passwordPlaceholder")) + '" spellcheck="false">' +
    '<button type="button" class="pw-toggle" data-pw-for="login-password" aria-label="' + esc(t("login.showAria")) + '">' + esc(t("login.show")) + '</button></div>' +
    '<p id="login-error" class="form-error" role="alert" hidden></p>' +
    '<button class="primary wide" type="submit" id="login-do">' + esc(t("login.submit")) + "</button>" +
    '<div class="login-alt"><button type="button" class="text-link" data-action="login-register">' + esc(t("login.register")) + "</button>" +
    '<button type="button" class="text-link" data-action="login-reset">' + esc(t("login.reset")) + "</button></div>" +
    '<p class="login-legal">' + t("login.legal") + "</p></form>"
  );
}

function loginCodeEmailBody(mode) {
  const copy = mode === "register"
    ? { title: t("login.registerTitle"), line: t("login.registerLine"), btn: t("login.sendCode") }
    : { title: t("login.resetTitle"), line: t("login.resetLine"), btn: t("login.sendCode") };
  return (
    '<p class="login-explain">' + esc(copy.line) + "</p>" +
    '<form id="code-email-form" novalidate>' +
    '<label class="field-label" for="login-email">' + esc(t("login.emailLabel")) + "</label>" +
    '<input id="login-email" type="email" required placeholder="you@example.com" autocomplete="username" inputmode="email" spellcheck="false">' +
    '<p id="login-error" class="form-error" role="alert" hidden></p>' +
    '<button class="primary wide" type="submit" id="login-send">' + esc(copy.btn) + "</button></form>" +
    '<div class="login-alt"><button type="button" class="text-link" data-action="login-password">' + esc(t("login.backToPassword")) + "</button></div>" +
    '<p class="login-legal">' + t("login.supportLink") + "</p>"
  );
}

function loginCodePasswordBody(mode, email) {
  const copy = mode === "register"
    ? { title: t("login.registerTitle"), pwLabel: t("login.setPassword"), btn: t("login.registerBtn"), done: t("login.registerDone") }
    : { title: t("login.resetTitle"), pwLabel: t("login.setNewPassword"), btn: t("login.resetBtn"), done: t("login.resetDone") };
  return (
    '<div class="login-email-line">' +
    '<span class="login-email-chip">' + esc(email) + "</span>" +
    '<button type="button" class="text-link" id="login-change-email">' + esc(t("login.changeEmail")) + "</button></div>" +
    '<form id="code-password-form" novalidate>' +
    '<label class="field-label" for="login-code">' + esc(t("login.codeLabel")) + "</label>" +
    '<input id="login-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="••••••" pattern="[0-9]{6}" spellcheck="false" required>' +
    '<p class="login-hint">' + esc(t("login.codeHint")) + "</p>" +
    '<label class="field-label" for="login-new-password">' + esc(copy.pwLabel + " " + t("login.passwordRange", { min: PASSWORD_MIN, max: PASSWORD_MAX })) + "</label>" +
    '<div class="pw-wrap">' +
    '<input id="login-new-password" type="password" required autocomplete="new-password" aria-describedby="password-validation" placeholder="' + esc(t("login.passwordPlaceholder2", { min: PASSWORD_MIN })) + '" spellcheck="false">' +
    '<button type="button" class="pw-toggle" data-pw-for="login-new-password" aria-label="' + esc(t("login.showAria")) + '">' + esc(t("login.show")) + '</button></div>' +
    '<label class="field-label" for="login-new-password2">' + esc(t("login.confirm")) + "</label>" +
    '<input id="login-new-password2" type="password" required autocomplete="new-password" placeholder="' + esc(t("login.confirmPlaceholder")) + '" spellcheck="false">' +
    '<p id="password-validation" class="login-hint" aria-live="polite"></p>' +
    '<p id="code-error" class="form-error" role="alert" hidden></p>' +
    '<button class="primary wide" type="submit" id="login-verify" disabled>' + esc(copy.btn) + "</button></form>" +
    '<div class="resend-line"><span id="resend-countdown" aria-live="polite"></span>' +
    '<a href="' + (isZh() ? "/support.html?lang=zh" : "/support-en.html?lang=en") + '" target="_blank" rel="noopener">' + esc(isZh() ? "收不到邮件？" : "No email?") + "</a></div>"
  );
}

function openLoginDialog(mode) {
  state.loginMode = mode || "password";
  if (mode === "register" || mode === "reset") {
    openDialog(mode === "register" ? t("login.registerTitle") : t("login.resetTitle"), loginCodeEmailBody(mode));
  } else {
    openDialog(t("login.dialogTitle"), loginPasswordBody());
  }
  const emailInput = document.getElementById("login-email");
  if (emailInput && state.loginLastEmail) emailInput.value = state.loginLastEmail;
  emailInput?.focus();
  bindPwToggles();
}

function bindPwToggles() {
  document.querySelectorAll(".pw-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.pwFor);
      if (!input) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? t("login.hide") : t("login.show");
      btn.setAttribute("aria-label", show ? t("login.hideAria") : t("login.showAria"));
    });
  });
}

function loginError(el, message) {
  if (el) {
    el.hidden = false;
    el.textContent = message;
  }
}

async function submitPasswordLogin() {
  const emailInput = document.getElementById("login-email");
  const email = emailInput?.value.trim();
  const password = document.getElementById("login-password")?.value;
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-do");
  if (!email || !password) {
    loginError(errEl, t("login.err.needEmailPw"));
    return;
  }
  if (emailInput && !emailInput.validity.valid) {
    loginError(errEl, t("login.err.invalidEmail"));
    emailInput.focus();
    return;
  }
  if (btn) { btn.textContent = t("login.submitting"); }
  setLoginBusy(true);
  if (errEl) errEl.hidden = true;
  try {
    await api("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    state.loginLastEmail = email;
    await completeLogin();
  } catch (err) {
    const code = err.data && err.data.error;
    if (err.status === 429 || code === "rate-limited") {
      const wait = Math.ceil(((err.data && err.data.retryAfterSec) || 900) / 60);
      loginError(errEl, t("login.err.rateLimited", { n: wait }));
    } else if (code === "invalid-credentials") {
      loginError(errEl, t("login.err.invalidCredentials"));
    } else if (err.status === 401) {
      // 旧生产端点尚未部署密码登录：401 unauthorized 不是“密码错”。
      loginError(errEl, t("login.err.serviceUpdating"));
    } else {
      loginError(errEl, t("login.err.failed"));
    }
    if (btn) { btn.textContent = t("login.submit"); }
    setLoginBusy(false);
    document.getElementById("login-password")?.focus();
  }
}

async function sendLoginCode(mode) {
  mode = mode || state.loginMode || "register";
  const emailInput = document.getElementById("login-email");
  const email = emailInput?.value.trim();
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-send");
  if (!email) return;
  if (emailInput && !emailInput.validity.valid) {
    loginError(errEl, t("login.err.invalidEmail"));
    emailInput.focus();
    return;
  }
  if (btn) { btn.textContent = t("login.sending"); }
  setLoginBusy(true);
  if (errEl) errEl.hidden = true;
  let delivered = false;
  try {
    const data = await api("/api/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    // 邮件不可用必须如实停留在第一步，不冒充发送成功。
    if (data.delivery === "unavailable") {
      loginError(errEl, t("login.err.mailUnavailable"));
    } else {
      delivered = true;
      state.loginEmail = email;
      state.loginLastEmail = email;
      state.loginMode = mode;
      openDialog(mode === "register" ? t("login.registerTitle") : t("login.resetTitle"), loginCodePasswordBody(mode, email));
      bindCodePasswordForm(mode);
      bindPwToggles();
      document.getElementById("login-code")?.focus();
      startResendCountdown(mode);
    }
  } catch {
    loginError(errEl, t("login.err.sendFailed"));
  } finally {
    if (!delivered) {
      if (btn) { btn.textContent = t("login.sendCode"); }
      setLoginBusy(false);
      emailInput?.focus();
    } else {
      setLoginBusy(false); // 新一屏已渲染，恢复其可编辑状态
    }
  }
}

/// 6 位数字输入过滤 + 满 6 位且两次密码一致才允许提交。
function bindCodePasswordForm(mode) {
  const codeInput = document.getElementById("login-code");
  const pw = document.getElementById("login-new-password");
  const pw2 = document.getElementById("login-new-password2");
  const btn = document.getElementById("login-verify");
  const errEl = document.getElementById("code-error");
  const refresh = () => {
    if (codeInput) {
      const digits = codeInput.value.replace(/\D+/g, "").slice(0, 6);
      if (codeInput.value !== digits) codeInput.value = digits;
    }
    if (btn && !btn.dataset.busy) {
      const codeOk = (codeInput?.value || "").length === 6;
      const pwOk = validPasswordInput(pw?.value || "");
      const same = pw?.value === pw2?.value;
      btn.disabled = !(codeOk && pwOk && same);
      const hint = document.getElementById("password-validation");
      if (hint) {
        const length = Array.from(pw?.value || "").length;
        hint.textContent = !pwOk
          ? t("login.hint.passwordRange", { min: PASSWORD_MIN, max: PASSWORD_MAX, n: length })
          : !same ? t("login.err.mismatchCheck")
          : !codeOk ? t("hint.codeShort") : t("login.hint.complete");
      }
    }
  };
  [codeInput, pw, pw2].forEach((el) => el?.addEventListener("input", refresh));
  refresh();
  document.getElementById("login-change-email")?.addEventListener("click", () => {
    state.loginEmail = "";
    if (loginResendTimer) { clearInterval(loginResendTimer); loginResendTimer = null; }
    openDialog(mode === "register" ? t("login.registerTitle") : t("login.resetTitle"), loginCodeEmailBody(mode));
    const emailInput = document.getElementById("login-email");
    if (emailInput && state.loginLastEmail) emailInput.value = state.loginLastEmail;
    emailInput?.focus();
  });
  pw2?.addEventListener("blur", () => {
    if (pw2.value && pw.value !== pw2.value) {
      loginError(errEl, t("login.err.mismatch"));
    } else if (errEl && errEl.textContent === t("login.err.mismatch")) {
      errEl.hidden = true;
    }
  });
}

async function submitCodePassword(mode) {
  mode = mode || state.loginMode || "register";
  const email = state.loginEmail;
  const code = document.getElementById("login-code")?.value.replace(/\D+/g, "").slice(0, 6);
  const password = document.getElementById("login-new-password")?.value;
  const password2 = document.getElementById("login-new-password2")?.value;
  const errEl = document.getElementById("code-error");
  const btn = document.getElementById("login-verify");
  if (!email || code.length !== 6) {
    loginError(errEl, t("login.err.codeNeeded"));
    return;
  }
  if (!validPasswordInput(password)) {
    loginError(errEl, t("login.err.passwordRange", { min: PASSWORD_MIN, max: PASSWORD_MAX }));
    return;
  }
  if (password !== password2) {
    loginError(errEl, t("login.err.mismatch"));
    return;
  }
  if (btn) { btn.textContent = t("login.submitting"); }
  setLoginBusy(true);
  if (errEl) errEl.hidden = true;
  try {
    await api("/api/v1/auth/password-reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code, password }),
    });
    state.loginLastEmail = email;
    state.loginEmail = "";
    await completeLogin(mode === "register" ? t("login.registerDone") : t("login.resetDone"));
  } catch (err) {
    const codeErr = err.data && err.data.error;
    if (err.status === 429 || codeErr === "rate-limited") {
      const wait = Math.ceil(((err.data && err.data.retryAfterSec) || 900) / 60);
      loginError(errEl, t("login.err.rateLimited", { n: wait }));
    } else if (err.status === 401 || codeErr === "invalid-code") {
      loginError(errEl, t("login.err.codeInvalid"));
      document.getElementById("login-code")?.focus();
    } else if (codeErr === "invalid-password" || err.status === 400) {
      loginError(errEl, t("login.err.passwordRange", { min: PASSWORD_MIN, max: PASSWORD_MAX }));
      document.getElementById("login-new-password")?.focus();
    } else {
      loginError(errEl, t("login.err.submitFailed"));
    }
    if (btn) { btn.textContent = mode === "register" ? t("login.registerBtn") : t("login.resetBtn"); }
    setLoginBusy(false);
  }
}

/// 登录后把游客本机选择的来源播种到未配置订阅的账户（与原生 guestSeed
/// 一致）；账户已有订阅则绝不覆盖。
async function seedGuestReaderSelection() {
  if (!state.user) return;
  const guest = guestReaderSelection();
  if (!guest.selected.length) return;
  const epoch = authEpoch;
  let remote = state.readerAccount;
  if (!remote) {
    try {
      remote = (await api("/api/v1/reader/settings")).reader || {};
    } catch {
      return;
    }
    if (authEpoch !== epoch || !state.user) return;
    state.readerAccount = remote;
  }
  if (remote.configured) return;
  try {
    const data = await api("/api/v1/reader/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      // 只写来源选择，不越权触碰网站的扩展开关。
      body: JSON.stringify({ selectedSources: guest.selected }),
    });
    if (authEpoch !== epoch || !state.user) return;
    state.readerAccount = data.reader || state.readerAccount;
  } catch {
    // 播种失败不影响登录；可在订阅页手动保存
  }
}

/// 登录完成后：必须真实拿到登录态（/me 确认）才算成功；拿不到时保留
/// 弹窗与错误可重试，不提前 toast「已登录」。
async function completeLogin(message) {
  state.loginMode = "";
  try {
    await onAuthChanged();
  } catch {
    loginError(document.getElementById("login-error") || document.getElementById("code-error"), t("login.err.confirmFailed"));
    setLoginBusy(false);
    return;
  }
  if (!state.user || !state.user.email) {
    loginError(document.getElementById("login-error") || document.getElementById("code-error"), t("login.err.notEffective"));
    setLoginBusy(false);
    return;
  }
  await mergeGuest();
  await seedGuestReaderSelection();
  await loadSaved().catch(() => {});
  await favorites.sync();
  await loadReads();
  closeDialog(true);
  loginBusy = false;
  toast(message || t("toast.loginOk"));
  if (state.view === "reader-settings") renderReaderSettings();
  else loadList(true);
}

function startResendCountdown(mode) {
  const el = () => document.getElementById("resend-countdown");
  if (!el()) return;
  let left = 60;
  if (loginResendTimer) clearInterval(loginResendTimer);
  const tick = () => {
    const node = el();
    if (!node) { clearInterval(loginResendTimer); loginResendTimer = null; return; }
    if (left > 0) {
      node.textContent = t("login.resend", { n: left });
      left -= 1;
    } else {
      node.textContent = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "login-resend";
      btn.textContent = t("login.resendNow");
      node.replaceWith(btn);
      btn.addEventListener("click", () => sendLoginCode(mode));
      clearInterval(loginResendTimer);
      loginResendTimer = null;
    }
  };
  tick();
  loginResendTimer = setInterval(tick, 1000);
}

function accountBody() {
  return (
    '<div class="setting-row"><span>' + esc(t("account.current")) + '</span><span>' + esc(state.user.email) + "</span></div>" +
    "<p>" + esc(t("account.synced")) + "</p>" +
    '<p id="logout-error" class="form-error" hidden></p>' +
    '<button type="button" class="text-link" data-action="logout" style="text-align:left">' + esc(t("account.logout")) + "</button>" +
    '<button type="button" class="text-link" data-action="logout-all" style="text-align:left">' + esc(t("account.logoutAll")) + "</button>" +
    '<div class="danger-zone"><button type="button" data-action="delete-account">' + esc(t("account.delete")) + "</button></div>"
  );
}

// Server-side revocation must succeed (and /me must confirm the session is
// gone) before we claim the user is signed out; a failed POST shows an error
// and leaves the account sheet open for a retry.
function clearAccountLocalData() {
  favorites.setRemoteAvailable(false);
  favorites.reset();
  state.reads = {};
  state.prefs = {};
  state.hiddenIds = new Set();
  for (const key of ["aquasight-reads", "aquasight-prefs", "aquasight-hidden"]) localStorage.removeItem(key);
}

async function performLogout(path, successMsg) {
  const errEl = document.getElementById("logout-error");
  const fail = (msg) => {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = msg;
    }
    toast(t("toast.logoutFailed"));
  };
  try {
    await api(path, { method: "POST" });
  } catch {
    fail(t("account.err.revoke"));
    return;
  }
  try {
    const me = await api("/api/v1/me");
    // A live OTP session carries the account email; local-mode /me answers
    // 200 with a guest local user, which is not a session to confirm.
    if (me && me.user && me.user.email) {
      fail(t("account.err.still"));
      return;
    }
  } catch {
    // 401 from /me is the expected confirmation of a dead session.
  }
  localStorage.removeItem("aquasight-token");
  clearAccountLocalData();
  await onAuthChanged();
  closeDialog();
  toast(successMsg);
  // 订阅流/其他列表立即按游客身份重载，不显示已退出账户的内容。
  if (state.view !== "event" && state.view !== "reader-settings") loadList(true);
}

function filterBody() {
  const sourceRadios = SOURCE_FILTERS.map(([id]) =>
    '<label class="setting-row"><span>' + esc(sourceLabel(id, lang())) + "</span>" +
    '<input type="radio" name="source-pick" value="' + esc(id) + '"' + (state.source === id ? " checked" : "") + "></label>"
  ).join("");
  return (
    '<p class="subhead">' + esc(t("filters.sources")) + "</p>" + sourceRadios +
    '<p class="subhead">' + esc(t("filters.readState")) + "</p>" +
    '<label class="setting-row"><span>' + esc(t("filters.unreadOnly")) + '</span><input type="checkbox" id="unread-toggle"' + (state.unreadOnly ? " checked" : "") + "></label>" +
    '<button type="button" class="primary wide" data-action="apply-filter">' + esc(t("filters.apply")) + "</button>"
  );
}

function searchBody() {
  return (
    '<label class="field-label" for="search-input">' + esc(t("search.label")) + "</label>" +
    '<form id="search-form"><input id="search-input" type="search" placeholder="' + esc(t("search.placeholder")) + '" autocomplete="off"></form>' +
    '<div id="search-results"></div>'
  );
}

function shareBody(id, item) {
  const url = location.origin + location.pathname + "#/event/" + encodeURIComponent(id);
  return (
    "<p>" + esc(t("share.body")) + "</p>" +
    '<label class="field-label" for="share-url">' + esc(t("share.label")) + "</label>" +
    '<input id="share-url" type="text" readonly value="' + esc(url) + '">' +
    '<button type="button" class="primary wide" data-action="copy-link">' + esc(t("share.copy")) + "</button>"
  );
}

function addLinkBody() {
  return (
    "<p>" + esc(t("addlink.intro")) + "</p>" +
    '<form id="add-form">' +
    '<label class="field-label" for="add-url">' + esc(t("addlink.url")) + "</label>" +
    '<input id="add-url" type="url" required placeholder="https://">' +
    '<label class="field-label" for="add-title" style="margin-top:12px">' + esc(t("addlink.title")) + "</label>" +
    '<input id="add-title" type="text" maxlength="200" placeholder="' + esc(t("addlink.titleFallback")) + '">' +
    '<details style="margin-top:12px"><summary>' + esc(t("addlink.optional")) + "</summary>" +
    '<label class="field-label" for="add-excerpt" style="margin-top:12px">' + esc(t("addlink.excerpt")) + "</label>" +
    '<textarea id="add-excerpt" rows="3" placeholder="' + esc(t("addlink.excerptPlaceholder")) + '"></textarea>' +
    '<label class="field-label" for="add-tags" style="margin-top:12px">' + esc(t("addlink.tags")) + "</label>" +
    '<input id="add-tags" type="text" placeholder="' + esc(t("addlink.tagsPlaceholder")) + '">' +
    '<label class="field-label" for="add-note" style="margin-top:12px">' + esc(t("addlink.note")) + "</label>" +
    '<textarea id="add-note" rows="4" maxlength="2000" placeholder="' + esc(t("addlink.notePlaceholder")) + '"></textarea>' +
    "</details>" +
    '<p id="add-error" class="form-error" hidden></p>' +
    '<button class="primary wide" type="submit">' + esc(t("addlink.submit")) + "</button></form>"
  );
}

function editMetaBody(item) {
  const tags = Array.isArray(item.readerTags) ? item.readerTags.join(" ") : "";
  const note = typeof item.readerNote === "string" ? item.readerNote : "";
  return (
    "<p>" + esc(t("metaedit.intro")) + "</p>" +
    '<form id="edit-meta-form">' +
    '<label class="field-label" for="edit-tags">' + esc(t("metaedit.tags")) + "</label>" +
    '<input id="edit-tags" type="text" value="' + esc(tags) + '">' +
    '<label class="field-label" for="edit-note" style="margin-top:12px">' + esc(t("metaedit.note")) + "</label>" +
    '<textarea id="edit-note" rows="6" maxlength="2000">' + esc(note) + "</textarea>" +
    '<p id="edit-error" class="form-error" hidden></p>' +
    '<button class="primary wide" type="submit">' + esc(t("metaedit.submit")) + "</button></form>"
  );
}

function moreBody(id) {
  return (
    '<div class="sheet-menu">' +
    '<button type="button" data-action="hide-story" data-id="' + esc(id) + '">' + esc(t("more.hide")) + "</button>" +
    '<button type="button" data-action="dislike-story" data-id="' + esc(id) + '">' + esc(t("more.dislike")) + "</button>" +
    "</div>"
  );
}

function bindDialogActions(root = document) {
  root.addEventListener("click", async (e) => {
    const el = e.target.closest("button, a, input, label");
    if (!el) return;
    if (el.hasAttribute("data-close")) { closeDialog(); return; }
    const action = el.dataset ? el.dataset.action : "";
    const id = el.dataset ? el.dataset.id : "";
    const itemFor = (kid) =>
      state.items.find((it) => it.id === kid) ||
      (state.detailItem && state.detailItem.id === kid ? state.detailItem : null);
    if (!action) return;
    switch (action) {
      case "reading-density": {
        const compact = document.documentElement.dataset.density !== "compact";
        try { localStorage.setItem("aquasight-density", compact ? "compact" : "comfortable"); } catch { /* keep the current session usable */ }
        updateReadingDensity();
        break;
      }
      case "language-zh":
      case "language-en": {
        const next = action === "language-zh" ? "zh" : "en";
        if (setLang(next)) {
          applyStaticI18n();
          document.getElementById("today-line").textContent = todayLine();
          updateNav();
          // Re-render the open settings dialog and the active page in the
          // new language; account/subscription data is untouched.
          if (modal().open && modal().querySelector("#theme-select")) {
            openDialog(t("settings.title"), settingsBody());
            const sel = document.getElementById("theme-select");
            const saved = localStorage.getItem("aquasight-theme") || "system";
            if (sel) {
              sel.value = saved;
              sel.addEventListener("change", () => {
                localStorage.setItem("aquasight-theme", sel.value);
                bootTheme();
                saveSettings();
              });
            }
          } else if (modal().open) {
            closeDialog();
          }
          if (state.view === "event") loadEvent(state.eventId);
          else if (state.view === "reader-settings") renderReaderSettings();
          else loadList(true);
        }
        break;
      }
      case "theme": {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem("aquasight-theme", next);
        bootTheme();
        break;
      }
      case "settings":
        closeDialog();
        openDialog(t("settings.title"), settingsBody());
        {
          const sel = document.getElementById("theme-select");
          const saved = localStorage.getItem("aquasight-theme") || "system";
          if (sel) {
            sel.value = saved;
            sel.addEventListener("change", () => {
              localStorage.setItem("aquasight-theme", sel.value);
              bootTheme();
              saveSettings();
            });
          }
        }
        break;
      case "review":
        closeDialog();
        location.hash = "#/review";
        break;
      case "reader-settings":
        closeDialog();
        location.hash = "#/reader-settings";
        break;
      case "add-link":
        closeDialog();
        openDialog(t("addlink.dialogTitle"), addLinkBody());
        break;
      case "edit-meta": {
        const item = state.savedItems[id] || itemFor(id);
        if (!item) break;
        closeDialog();
        const dlg = openDialog(t("metaedit.title"), editMetaBody(item));
        const form = dlg && dlg.querySelector("#edit-meta-form");
        if (form) form.dataset.id = item.id;
        break;
      }
      case "library-tag":
        state.libraryTag = el.dataset.tag === state.libraryTag ? "" : el.dataset.tag || "";
        renderList();
        break;
      case "remove-item": {
        const item = state.savedItems[id] || itemFor(id);
        if (!item) break;
        favorites.set(id, null);
        toast(t("toast.removed") + (favorites.isAvailable() && favorites.pending(id) ? t("toast.pendingSync") : ""));
        if (state.view === "saved") renderList();
        if (favorites.isAvailable()) {
          await favorites.sync();
          if (state.view === "saved") renderList();
        }
        break;
      }
      case "back-home":
        location.hash = "#/" + (state.returnView && state.returnView !== "reader-settings" ? state.returnView : "reader");
        break;
      case "clear-cache":
        await purgeUserCaches();
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.update();
        }
        toast(t("toast.cacheCleared"));
        closeDialog();
        break;
      case "reset-data":
        if (!confirm(t("confirm.resetData"))) return;
        localStorage.removeItem("aquasight-reads");
        localStorage.removeItem("aquasight-saved");
        localStorage.removeItem("aquasight-hidden");
        localStorage.removeItem("aquasight-prefs");
        state.reads = {};
        favorites.reset();
        state.hiddenIds = new Set();
        state.prefs = {};
        syncSavedState();
        toast(t("toast.resetDone"));
        closeDialog();
        if (state.view !== "event") loadList(true);
        break;
      case "login":
        closeDialog();
        if (state.user) openDialog(t("login.dialogTitle"), accountBody());
        else openLoginDialog("password");
        break;
      case "login-register":
        closeDialog();
        openLoginDialog("register");
        break;
      case "login-reset":
        closeDialog();
        openLoginDialog("reset");
        break;
      case "login-password":
        // 注册/找回第一步的「返回密码登录」。
        closeDialog();
        openLoginDialog("password");
        break;
      case "logout":
        await performLogout("/api/v1/auth/logout", t("toast.loggedOut"));
        break;
      case "logout-all":
        await performLogout("/api/v1/auth/logout-all", t("toast.loggedOutAll"));
        break;
      case "delete-account":
        if (!confirm(t("confirm.deleteAccount"))) return;
        try {
          await api("/api/v1/me", { method: "DELETE" });
        } catch {
          toast(t("toast.deleteFailed"));
          return;
        }
        localStorage.removeItem("aquasight-token");
        clearAccountLocalData();
        await onAuthChanged();
        closeDialog();
        toast(t("toast.accountDeleted"));
        break;
      case "search":
        openDialog(t("tools.search"), searchBody());
        document.getElementById("search-input")?.focus();
        break;
      case "filter":
        openDialog(t("filters.trigger"), filterBody());
        break;
      case "apply-filter": {
        const picked = modal().querySelector('input[name="source-pick"]:checked');
        state.source = picked ? picked.value : "";
        state.unreadOnly = Boolean(document.getElementById("unread-toggle")?.checked);
        closeDialog();
        loadList(true);
        break;
      }
      case "share":
        openDialog(t("detail.share"), shareBody(id, itemFor(id)));
        break;
      case "copy-link": {
        const input = document.getElementById("share-url");
        try {
          await navigator.clipboard.writeText(input.value);
          toast(t("toast.linkCopied"));
        } catch {
          input.select();
          toast(t("toast.selectCopy"));
        }
        break;
      }
      case "more":
        openDialog(t("more.title"), moreBody(id));
        break;
      case "hide-story": {
        closeDialog();
        await act(id, "hide", itemFor(id));
        break;
      }
      case "dislike-story": {
        closeDialog();
        await act(id, "dislike", itemFor(id));
        break;
      }
      case "clear-filters":
        loadListFiltersClear();
        break;
      case "refresh":
        await loadSaved().catch(() => {});
        await favorites.sync();
        if (state.view === "event") await loadEvent(state.eventId);
        else await loadList(true);
        toast(state.feed === "error" ? t("toast.refreshFailed") : t("toast.reloaded"));
        break;
      default:
        break;
    }
  });
}

async function saveSettings() {
  const note = document.getElementById("settings-save-note");
  // 外观修改不清空以前保存的偏好。信息源现在统一在订阅管理。
  const blockedSources = state.prefs.blockedSources || [];
  state.prefs = { ...state.prefs, blockedSources };
  persistPrefs();
  if (state.view !== "event") renderList();
  let message = t("toast.settingsSaved");
  try {
    await api("/api/v1/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockedSources }),
    });
  } catch (err) {
    message = err.status === 404 ? t("toast.settingsLocal") : t("toast.settingsLocalSync");
  }
  toast(message);
  if (note) {
    note.hidden = false;
    note.textContent = message;
    note.classList.remove("form-error");
  }
}

async function requireLibrarySupport(items) {
  const needsSupport = items.some(it => it && (it.kind === "personal-link" || "readerTags" in it || "readerNote" in it));
  if (!needsSupport) return;
  const capabilities = await api("/api/v1/favorites");
  if (capabilities.personalLibrary !== true) throw new Error(t("error.libraryUnavailableMsg"));
}

async function mergeGuest() {
  const local = readLocal("aquasight-saved", {});
  const deletedIds = Object.entries(local.pending || {})
    .filter(([, op]) => op?.kind === "remove")
    .map(([id]) => id);
  const body = buildMergeBody({
    reads: state.reads,
    prefs: state.prefs,
    items: Object.values(state.savedItems || {}),
    deletedIds,
  });
  try {
    await requireLibrarySupport(body.favorites.map(it => it.snapshot).filter(Boolean));
    await api("/api/v1/sync/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    toast(t("toast.mergeFailed"));
  }
}

function bindDialogForms() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("#feed-add-aihot");
    if (!button || button.disabled) return;
    button.disabled = true;
    void submitAddFeed("https://aihot.news/feed.xml").finally(() => { button.disabled = false; });
  });
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "feed-add-form") {
      e.preventDefault();
      const input = document.getElementById("feed-add-url");
      const url = input ? input.value.trim() : "";
      if (!url) return;
      await submitAddFeed(url);
    } else if (e.target.id === "login-form") {
      e.preventDefault();
      submitPasswordLogin();
    } else if (e.target.id === "code-email-form") {
      e.preventDefault();
      sendLoginCode();
    } else if (e.target.id === "code-password-form") {
      e.preventDefault();
      submitCodePassword();
    } else if (e.target.id === "search-form") {
      e.preventDefault();
      const q = document.getElementById("search-input").value.trim();
      state.q = q;
      closeDialog();
      if (state.view === "saved") renderList();
      else if (state.view === "event" || state.view === "review") location.hash = "#/reader";
      else loadList(true);
    } else if (e.target.id === "add-form") {
      e.preventDefault();
      const url = document.getElementById("add-url").value.trim();
      const titleInput = document.getElementById("add-title").value.trim();
      const excerpt = document.getElementById("add-excerpt").value.trim().slice(0, LINK_EXCERPT_MAX);
      const tags = parseTagInput(document.getElementById("add-tags").value);
      const note = document.getElementById("add-note").value.trim().slice(0, READER_NOTE_MAX);
      const errEl = document.getElementById("add-error");
      const link = await personalLinkId(url);
      if (link.error) {
        if (errEl) { errEl.hidden = false; errEl.textContent = link.error; }
        return;
      }
      // 标题可选：留空时以网址域名回退（浏览器端不做网页标题抓取）。
      const title = titleInput || domainFallbackTitle(url);
      if (!title) {
        if (errEl) { errEl.hidden = false; errEl.textContent = t("addlink.invalidUrl"); }
        return;
      }
      const existing = favorites.has(link.id);
      const item = {
        id: link.id,
        title: title.slice(0, LINK_TITLE_MAX),
        // 打开原文用用户输入的原始安全 URL；规范化串仅参与去重 id。
        url: url,
        source: "import",
        kind: "personal-link",
        summary: excerpt,
        readerTags: tags,
        readerNote: note,
        publishedAt: new Date().toISOString(),
      };
      try {
        favorites.set(link.id, item);
      } catch {
        if (errEl) { errEl.hidden = false; errEl.textContent = t("addlink.saveFailed"); }
        return;
      }
      closeDialog();
      toast(existing ? t("addlink.duplicate") : (state.user ? t("addlink.saved") : t("addlink.savedLocal")));
      if (state.view === "saved") renderList();
      else location.hash = "#/saved";
      if (favorites.isAvailable()) {
        await favorites.sync();
        if (state.view === "saved") renderList();
      }
    } else if (e.target.id === "edit-meta-form") {
      e.preventDefault();
      const id = e.target.dataset.id;
      const item = state.savedItems[id];
      const errEl = document.getElementById("edit-error");
      if (!item) return;
      const tags = parseTagInput(document.getElementById("edit-tags").value);
      const note = document.getElementById("edit-note").value.trim().slice(0, READER_NOTE_MAX);
      try {
        favorites.set(id, { ...item, readerTags: tags, readerNote: note });
      } catch {
        // Storage failure must keep the form open with the user's input.
        if (errEl) { errEl.hidden = false; errEl.textContent = t("metaedit.storageFailed"); }
        return;
      }
      closeDialog();
      toast(t("metaedit.updated") + (favorites.isAvailable() && favorites.pending(id) ? t("toast.pendingSync") : ""));
      if (state.view === "saved") renderList();
      if (favorites.isAvailable()) {
        await favorites.sync();
        if (state.view === "saved") renderList();
      }
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.hasAttribute?.("data-source-toggle")) {
      saveSettings();
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target.id === "search-input") {
      const q = e.target.value.trim().toLowerCase();
      const box = document.getElementById("search-results");
      if (!box) return;
      if (!q) { box.innerHTML = ""; return; }
      const pool = state.items.length ? state.items : Object.values(state.savedItems);
      const hits = pool
        .filter((it) => [it.title, it.titleZh, it.overviewZh, it.summary, it.readerNote,
          Array.isArray(it.readerTags) ? it.readerTags.join(" ") : "", it.source].join(" ").toLowerCase().includes(q))
        .slice(0, 6);
      box.innerHTML = hits.length
        ? hits.map((it) =>
          '<a class="search-result" href="#/event/' + encodeURIComponent(it.id) + '">' +
          esc(displayTitle(it)) + "<small>" + esc(sourceLabel(it.source, lang())) + " · " + esc(topicLabel(it)) + "</small></a>"
        ).join("")
        : '<p>' + esc(t("search.none")) + "</p>";
    }
  });
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a.search-result");
    if (link) closeDialog();
    // 「更多」菜单里的路由链接点击后关闭弹窗。
    if (e.target.closest('.sheet-menu a[href^="#/"]')) closeDialog();
  });
}

function loadListFiltersClear() {
  state.q = state.topic = state.source = "";
  state.unreadOnly = false;
  state.libraryTag = "";
  loadList(true);
}

function bind() {
  document.getElementById("today-line").textContent = todayLine();
  document.getElementById("filters-row").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-topic]");
    if (!btn) return;
    state.topic = btn.getAttribute("data-topic") || "";
    loadList(true);
  });
  document.getElementById("main").addEventListener("click", async (e) => {
    if (e.target.closest("[data-reading-mode]")) {
      state.q = state.topic = state.source = "";
      state.unreadOnly = false;
    }
    const start = e.target.closest("[data-action='reader-start']");
    if (start) {
      // 用户显式一键选择（不静默默认）：游客写本机选择，登录账户走真实
      // PUT；成功后立即刷新订阅流。
      const ids = String(start.dataset.sources || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!ids.length) return;
      start.disabled = true;
      try {
        if (state.user) {
          const data = await api("/api/v1/reader/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ selectedSources: ids }),
          });
          state.readerAccount = data.reader || state.readerAccount;
        } else {
          persistGuestReaderSelection(ids, true);
        }
        toast(t("toast.sourcesChosen"));
        if (location.hash === "#/reader") await loadList(true);
        else location.hash = "#/reader";
      } catch (err) {
        toast(t("toast.sourcesFailed", { msg: err.message || t("toast.networkError") }));
        start.disabled = false;
      }
      return;
    }
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest("[data-id]") || btn;
    const id = btn.getAttribute("data-id") || card.getAttribute("data-id");
    if (btn.dataset.act === "clear-filters") { loadListFiltersClear(); return; }
    if (String(btn.dataset.act).startsWith("feed-")) { e.preventDefault(); handleFeedAction(btn); return; }
    if (btn.dataset.act === "login") {
      e.preventDefault();
      if (state.user) openDialog(t("login.dialogTitle"), accountBody());
      else openLoginDialog("password");
      return;
    }
    const item =
      state.items.find((it) => it.id === id) ||
      (state.detailItem && state.detailItem.id === id ? state.detailItem : null);
    act(id, btn.dataset.act, item);
  });
  document.getElementById("more-btn").addEventListener("click", () => loadList(false));

  modal().addEventListener("click", (e) => {
    if (e.target === modal()) {
      const r = modal().getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog();
    }
  });
  modal().addEventListener("close", () => {
    if (loginResendTimer) { clearInterval(loginResendTimer); loginResendTimer = null; }
    lastFocus?.focus?.({ preventScroll: true });
  });
  bindDialogActions();
  bindDialogForms();
  bindDialogHygiene();
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !modal().open && document.activeElement && !document.activeElement.matches("input, textarea, select, [contenteditable=true]")) {
      e.preventDefault();
      openDialog(t("tools.search"), searchBody());
      document.getElementById("search-input")?.focus();
    }
  });
  window.addEventListener("hashchange", () => route());
}

function ensureAddLinkButton() {
  const existing = document.getElementById("heading-add-link");
  if (existing) return;
  const heading = document.getElementById("feed-heading");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "heading-add-link";
  btn.className = "text-link";
  btn.style.alignSelf = "flex-end";
  btn.textContent = t("addlink.headingBtn");
  btn.addEventListener("click", () => openDialog(t("addlink.dialogTitle"), addLinkBody()));
  heading.appendChild(btn);
}

function updateHeadingExtras() {
  const btn = document.getElementById("heading-add-link");
  if (state.view === "saved" && !btn) ensureAddLinkButton();
  if (state.view !== "saved" && btn) btn.remove();
}

function bootTheme() {
  const saved = localStorage.getItem("aquasight-theme");
  const pref = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", saved && saved !== "system" ? saved : (pref ? "dark" : "light"));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", document.documentElement.dataset.theme === "dark" ? "#11161d" : "#ffffff");
  const sel = document.getElementById("theme-select");
  if (sel) sel.value = saved || "system";
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  } catch {
    // ignore
  }
}

// Legacy bearer token must not linger now that auth rides the HttpOnly cookie.
try { localStorage.removeItem("aquasight-token"); } catch { /* ignore */ }

bootTheme();
applyStaticI18n();
document.getElementById("today-line").textContent = todayLine();
updateNav();
// Language switch re-renders everything visible; data is never touched.
onLanguageChange(() => {
  applyStaticI18n();
  document.getElementById("today-line").textContent = todayLine();
  updateNav();
  syncSavedState(false);
});
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", bootTheme);
loadLocalPrefs();
window.addEventListener("offline", () => {
  state.feed = "offline";
  applyConnectionBanner();
});
window.addEventListener("online", () => {
  applyConnectionBanner();
  loadSaved().catch(() => {}).then(() => favorites.sync());
});
bind();
syncSavedState();
// Public editions and public article links do not wait for account services.
// Personal-reader routes still bootstrap the session and subscriptions first.
const entry = parseHash();
const publicEntry = ["featured", "latest", "opensource", "digest"].includes(entry.view) || (entry.view === "event" && !entry.readerDetail);
const initialPublicLoad = publicEntry ? route() : null;
loadReads().then(() => loadSaved().catch(() => {})).then(() => {
  void favorites.sync();
  return refreshMe();
}).then(async () => {
  await loadReaderCatalog();
  if (state.user) await loadReaderAccountSettings();
  if (!initialPublicLoad) return route();
  await initialPublicLoad;
  // Navigation may have moved into a personal view while identity loaded.
  if (["reader", "reader-settings", "saved", "review"].includes(state.view) || state.detailReader) return route();
  updateNav();
  if (state.view !== "event") renderList();
});
registerSw();
