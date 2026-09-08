import { createFavorites } from "./favorites.js";
import { isHiddenCard, visibleCards, TOPIC_FILTERS, SOURCE_FILTERS, sourceLabel, cardBody } from "./rules.js";

const state = {
  view: "featured",
  eventId: "",
  items: [],
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
  rated: {},
  scroll: {},
  prefs: {},
  hideUndo: null,
  detailItem: null,
  detailMembers: [],
  feed: "live",
  hiddenIds: new Set(),
  savedItems: {},
};

const views = ["featured", "latest", "digest", "saved"];

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.hidden = false;
  el.textContent = msg;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

function formatBeijing(iso) {
  if (!iso) return "未知时间";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "未知时间";
  return d.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
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

const favorites = createFavorites({
  read: () => readLocal("aquasight-saved", {}),
  write: (data) => localStorage.setItem("aquasight-saved", JSON.stringify(data)),
  request: (id, kind, snapshot) => api(
    kind === "remove" ? "/api/v1/favorites/" + encodeURIComponent(id) : "/api/v1/favorites",
    kind === "remove" ? { method: "DELETE" } : {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId: id, snapshot }),
    }
  ),
  onChange: syncSavedState,
});

function syncSavedState() {
  state.savedItems = favorites.items();
  state.saved = new Set(Object.keys(state.savedItems));
  document.querySelectorAll("button[data-act=save]").forEach((btn) => {
    const id = btn.dataset.id || btn.closest("[data-id]")?.dataset.id;
    btn.textContent = state.saved.has(id) ? "取消收藏" : "收藏";
    btn.setAttribute("aria-pressed", String(state.saved.has(id)));
  });
  if (state.view === "saved") {
    state.items = Object.values(state.savedItems);
    renderList();
  }
}

function persistPrefs() {
  writeLocal("aquasight-prefs", state.prefs || {});
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
    return { view: "event", eventId: decodeURIComponent(parts[1]) };
  }
  if (parts[0] === "review") return { view: "review", eventId: "" };
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
  const res = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(opts.headers || {}) },
    ...opts,
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

function displayTitle(it) {
  return String(it.titleZh || it.title || "(无标题)").trim();
}

function overviewOf(it) {
  return String(it.overviewZh || it.summaryZh || "").trim();
}

function uniqueSources(item, members) {
  const raw = [];
  const initial = Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : [{ source: item.source, url: item.url, title: item.title }];
  for (const s of initial) if (s) raw.push(s);
  for (const m of members || []) {
    if (!m) continue;
    raw.push({ source: m.source, url: m.url || m.discussionUrl, title: m.title, discussionUrl: m.discussionUrl });
  }
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const key = String(s.url || "") + "|" + String(s.source || "");
    if (!s.url && !s.source) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function cardHtml(it) {
  const read = Boolean(state.reads[it.id]);
  const href = "#/event/" + encodeURIComponent(it.id);
  const title = esc(displayTitle(it));
  const body = cardBody(it);
  const sources = uniqueSources(it);
  const primary = sources[0] || { source: it.source };
  const when = formatBeijing(it.publishedAt || it.firstSeenAt || it.seenAt);
  const kicker =
    body.kind === "excerpt"
      ? '<p class="kicker">原文摘录</p>'
      : body.kind === "empty"
        ? '<p class="kicker">暂无摘要</p>'
        : "";
  const overview =
    body.kind === "empty"
      ? ""
      : '<p class="overview clamp">' + esc(body.text) + "</p>";
  return (
    '<article class="card' +
    (read ? " read" : "") +
    '" data-id="' +
    esc(it.id) +
    '">' +
    '<h2><a class="title" href="' +
    href +
    '">' +
    title +
    "</a></h2>" +
    kicker +
    overview +
    '<p class="meta-row"><time>' +
    esc(when) +
    "</time><span>" +
    esc(sourceLabel(primary.source || it.source)) +
    "</span></p>" +
    '<div class="card-actions">' +
    '<button type="button" data-act="save">' +
    (state.saved.has(it.id) ? "取消收藏" : "收藏") +
    "</button>" +
    '<button type="button" data-act="hide">隐藏</button>' +
    "</div></article>"
  );
}

function renderFilters() {
  const topicEl = document.getElementById("topic-filters");
  const sourceEl = document.getElementById("source-filters");
  if (topicEl) {
    topicEl.innerHTML = TOPIC_FILTERS.map(([t, label]) => {
      return (
        '<button type="button" aria-pressed="' +
        (state.topic === t) +
        '" data-topic="' +
        esc(t) +
        '">' +
        esc(label) +
        "</button>"
      );
    }).join("");
  }
  if (sourceEl) {
    sourceEl.innerHTML = SOURCE_FILTERS.map(([s, label]) => {
      return (
        '<button type="button" aria-pressed="' +
        (state.source === s) +
        '" data-source="' +
        esc(s) +
        '">' +
        esc(label) +
        "</button>"
      );
    }).join("");
  }
}

function renderList() {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const pager = document.querySelector(".pager");
  detail.hidden = true;
  list.hidden = false;
  if (pager) pager.hidden = false;
  renderFilters();
  const localFilter =
    state.feed === "snapshot" ||
    state.cached ||
    state.view === "saved" ||
    state.view === "digest" ||
    state.view === "review";
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
      const blob = [it.title, it.titleZh, it.overviewZh, it.summary].join(" ").toLowerCase();
      if (!blob.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
  const undo = state.hideUndo
    ? '<p class="undo-bar">已隐藏该条 <button type="button" data-act="undo">撤销</button></p>'
    : "";
  if (!filtered.length) {
    list.innerHTML = undo + '<p class="empty">没有符合条件的内容。</p>';
    return;
  }
  list.innerHTML = undo + filtered.map(cardHtml).join("");
}

function renderDetail(item, members) {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  const pager = document.querySelector(".pager");
  list.hidden = true;
  detail.hidden = false;
  if (pager) pager.hidden = true;
  state.detailItem = item;
  state.detailMembers = members || [];
  const facts = Array.isArray(item.facts) ? item.facts : [];
  const sources = uniqueSources(item, members);
  const orig = item.title && displayTitle(item) !== item.title
    ? '<details><summary>原文标题</summary><p class="orig">' +
      esc(item.title) +
      "</p></details>"
    : "";
  const body = cardBody(item);
  let overviewBlock = "";
  if (body.kind === "overview") {
    overviewBlock = '<p class="overview">' + esc(body.text) + "</p>";
  } else if (body.kind === "excerpt") {
    overviewBlock = '<p class="kicker">原文摘录</p><p class="overview">' + esc(body.text) + "</p>";
  } else {
    overviewBlock = '<p class="kicker">暂无摘要</p>';
  }
  const uncertain = item.enrichInsufficient
    ? "<p>资料不足，未根据标题虚构细节。</p>"
    : "";
  const attr = (item.attribution || [])
    .map((a) => "<li>" + esc(a.claim || a) + (a.source ? " — " + esc(a.source) : "") + "</li>")
    .join("");
  const evidence = (item.evidence || [])
    .map((a) => "<li>" + esc(typeof a === "string" ? a : a.claim || a.url || JSON.stringify(a)) + "</li>")
    .join("");
  const uncertainty = (item.uncertainty || []).map((a) => "<li>" + esc(a) + "</li>").join("");
  const impact = String(item.impact || "").trim();
  const rawMaterial = String(item.summary || "").trim();
  const extraRaw =
    body.kind !== "excerpt" && rawMaterial && rawMaterial !== body.text
      ? '<details><summary>原始材料</summary><p class="orig">' + esc(rawMaterial) + "</p></details>"
      : "";
  detail.innerHTML =
    '<p><a class="text-btn" href="#/' +
    (state.returnView || "featured") +
    '" id="back-link">返回</a></p>' +
    "<h2>" +
    esc(displayTitle(item)) +
    "</h2>" +
    orig +
    overviewBlock +
    extraRaw +
    uncertain +
    (facts.length ? "<h3>要点</h3><ul>" + facts.map((f) => "<li>" + esc(f) + "</li>").join("") + "</ul>" : "") +
    (impact ? "<h3>影响</h3><p>" + esc(impact) + "</p>" : "") +
    (evidence ? "<h3>证据</h3><ul>" + evidence + "</ul>" : "") +
    (uncertainty ? "<h3>不确定性</h3><ul>" + uncertainty + "</ul>" : "") +
    (attr ? "<h3>归属</h3><ul>" + attr + "</ul>" : "") +
    "<h3>来源与报道</h3><ul>" +
    sources
      .map((s) => {
        const disc = s.discussionUrl
          ? ' · <a href="' + esc(s.discussionUrl) + '" target="_blank" rel="noreferrer">讨论</a>'
          : "";
        const href = s.url || item.url || "";
        return (
          "<li>" +
          esc(sourceLabel(s.source || item.source)) +
          (href
            ? ' · <a href="' + esc(href) + '" target="_blank" rel="noreferrer">' +
              esc(s.title || "原文") +
              "</a>"
            : "") +
          disc +
          "</li>"
        );
      })
      .join("") +
    "</ul>" +
    '<div class="card-actions">' +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="save">' +
    (state.saved.has(item.id) ? "取消收藏" : "收藏") +
    "</button>" +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="share">分享</button>' +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="hide">隐藏</button>' +
    "</div>";
  window.scrollTo(0, 0);
  markRead(item.id);
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
  el.className = "banner" + (kind === "error" ? " error" : kind === "warn" ? " warn" : "");
  el.textContent = text;
}

function applyConnectionBanner(other) {
  const extra = String(other || "").trim();
  if (navigator.onLine === false || state.feed === "offline") {
    setBanner("现在离线，显示已保存的内容。", "warn");
    return;
  }
  if (state.feed === "snapshot") {
    setBanner("");
    return;
  }
  if (state.feed === "error") {
    setBanner(extra || "暂时读不到新闻。", "error");
    return;
  }
  if (state.cached) {
    setBanner(extra || "显示的是刚才保存的内容，可能不是最新。", "warn");
    return;
  }
  setBanner(extra, extra ? "warn" : "");
}

function updateMeta() {
  const el = document.getElementById("meta");
  if (!el) return;
  const when = state.snapshotAt ? formatBeijing(state.snapshotAt) : "";
  if (when) el.textContent = "更新于 " + when;
  else if (state.feed === "error") el.textContent = "还没有内容";
  else el.textContent = "";
}

function updateNav() {
  document.querySelectorAll(".nav a, .bottom-nav a").forEach((a) => {
    const on = a.getAttribute("data-view") === state.view;
    if (on) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}

function restoreScroll() {
  const y = state.scroll[state.view] || 0;
  window.scrollTo(0, y);
}

async function loadReads() {
  const local = readLocal("aquasight-reads", {}) || {};
  try {
    const data = await api("/api/v1/reads");
    state.reads = { ...local, ...(data.reads || {}) };
    persistReads();
  } catch {
    state.reads = local;
  }
}

async function loadSaved() {
  const revision = favorites.revision();
  try {
    const data = await api("/api/v1/favorites");
    favorites.setRemoteAvailable(true);
    favorites.mergeRemote(data.items || [], revision);
    syncSavedState();
    return data;
  } catch (err) {
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
  const list = document.getElementById("list");
  if (reset) {
    list.innerHTML = '<p class="empty">加载中…</p>';
    state.items = [];
    state.cursor = null;
  }
  try {
    if (state.view === "saved") {
      const data = await loadSaved();
      state.cached = takeCacheFlag(data);
      if (state.cached) state.stale = true;
      else state.feed = "live";
      state.items = Object.values(favorites.items());
      state.snapshotAt = data.snapshotAt || "";
      state.cursor = null;
      document.getElementById("more-btn").hidden = true;
      renderList();
      applyConnectionBanner();
      updateMeta();
      return;
    }
    if (state.view === "review") {
      const data = await api("/api/v1/review");
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
      state.cached = takeCacheFlag(data);
      if (state.cached) state.stale = true;
      else state.feed = "live";
      const digest = data.digest || {};
      state.items = digest.items || [];
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
    state.cached = takeCacheFlag(data);
    if (state.cached) state.stale = true;
    else state.feed = "live";
    state.snapshotAt = data.snapshotAt || "";
    state.items = reset ? data.items || [] : state.items.concat(data.items || []);
    state.cursor = data.cursor || null;
    document.getElementById("more-btn").hidden = !state.cursor;
    renderList();
    try {
      const st = await api("/api/v1/status");
      state.sourceHealth = st.sources || [];
      const failed = state.sourceHealth.filter((s) => !s.ok);
      const bits = [];
      if (failed.length) bits.push(failed.length + " 个源打不开");
      if (st.emptyMeansFailure) bits.push("采集失败，不是没有新闻");
      applyConnectionBanner(bits.join(" · "));
    } catch {
      applyConnectionBanner();
    }
    updateMeta();
  } catch (e) {
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
      const fallback =
        state.view === "digest" ? (await loadDigestJson()) || (await loadEventsJson()) : await loadEventsJson();
      if (fallback) {
        applySnapshot(fallback, state.view);
        applyConnectionBanner();
        updateMeta();
        renderList();
        return;
      }
      state.feed = navigator.onLine === false ? "offline" : "error";
      list.innerHTML =
        '<div class="error-state"><p>暂时读不到新闻。</p><button type="button" class="text-btn" id="retry-btn">重试</button></div>';
      applyConnectionBanner();
      updateMeta();
      document.getElementById("retry-btn")?.addEventListener("click", () => loadList(true));
    } else {
      toast("没有更多了");
    }
  }
}

async function loadJsonFile(urls) {
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: "no-store" });
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
  const items = visibleCards(snapshotItems(data));
  state.snapshotAt = data.snapshotAt || data.updatedAt || state.snapshotAt || "";
  state.feed = "snapshot";
  state.cached = false;
  state.stale = false;
  state.cursor = null;
  const more = document.getElementById("more-btn");
  if (more) more.hidden = true;
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
  } else {
    state.items = items;
  }
}

async function findSnapshotEvent(id) {
  const fromEvents = snapshotItems(await loadEventsJson()).find((it) => it && it.id === id);
  if (fromEvents) return fromEvents;
  return snapshotItems(await loadDigestJson()).find((it) => it && it.id === id) || null;
}

async function loadEvent(id) {
  state.returnView = state.returnView || "featured";
  try {
    const data = await api("/api/v1/events/" + encodeURIComponent(id));
    renderDetail(data.item, data.members || []);
    if (data.snapshotAt) state.snapshotAt = data.snapshotAt;
    updateMeta();
  } catch (e) {
    const local = state.items.find((it) => it.id === id);
    if (local) {
      renderDetail(local, local.sources || []);
      return;
    }
    const snap = await findSnapshotEvent(id);
    if (snap) {
      state.feed = "snapshot";
      renderDetail(snap, snap.sources || []);
      updateMeta();
      return;
    }
    document.getElementById("detail").hidden = false;
    document.getElementById("list").hidden = true;
    document.getElementById("detail").innerHTML =
      '<p><a href="#/featured">返回</a></p><p class="error-state">事件不存在或未登录。</p>';
  }
}

function renderReview(samples) {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  detail.hidden = true;
  list.hidden = false;
  list.innerHTML =
    "<p>口味校准：请对至少 30 条标记喜欢或不喜欢。当前 " +
    samples.length +
    " 条。7 天影子运行未完成前不会自动开启即时推送。</p>" +
    state.items
      .map((it) => {
        const rated = state.rated[it.id];
        const buttons = rated
          ? "<p class=\"meta-row\">已记录" + (rated === "like" ? "喜欢" : "不喜欢") + "</p>"
          : '<div class="card-actions">' +
            '<button type="button" data-id="' +
            esc(it.id) +
            '" data-act="like">喜欢</button>' +
            '<button type="button" data-id="' +
            esc(it.id) +
            '" data-act="dislike">不喜欢</button></div>';
        return cardHtml(it) + buttons;
      })
      .join("");
}

async function act(id, kind, item) {
  try {
    if (kind === "save") {
      const save = !favorites.has(id);
      const snap = snapshotOf(item) || snapshotOf(state.detailItem?.id === id ? state.detailItem : null);
      if (save && !snap) { toast("没有可收藏的内容"); return; }
      favorites.set(id, save ? snap : null);
      const feedback = state.favoriteAction = (state.favoriteAction || 0) + 1;
      const localMessage = save ? "已保存到本机" : "已从本机取消";
      toast(localMessage + (favorites.isAvailable() ? "，待同步" : ""));
      if (favorites.isAvailable()) {
        await favorites.sync();
        if (state.favoriteAction === feedback) {
          toast(favorites.pending(id) ? localMessage + "，待同步" : save ? "已收藏" : "已取消收藏");
        }
      }
      return;
    } else if (kind === "share") {
      const url = location.origin + location.pathname + "#/event/" + encodeURIComponent(id);
      if (navigator.share) await navigator.share({ title: displayTitle(item || { title: url }), url });
      else {
        await navigator.clipboard.writeText(url);
        toast("链接已复制");
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
      toast(kind === "hide" ? "已隐藏" : kind === "like" ? "已记录喜欢" : "已记录不喜欢");
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
      toast("已撤销");
      renderList();
      return;
    }
    if (state.view === "event" && state.detailItem && kind !== "share") {
      renderDetail(state.detailItem, state.detailMembers || []);
      return;
    }
    if (state.view !== "event" && state.view !== "review" && kind !== "share") renderList();
  } catch (e) {
    toast("操作失败：" + (e.message || "网络错误"));
  }
}

async function route() {
  state.scroll[state.view] = window.scrollY;
  const parsed = parseHash();
  if (parsed.view !== "event") state.returnView = parsed.view;
  state.view = parsed.view;
  state.eventId = parsed.eventId;
  updateNav();
  if (parsed.view === "event") {
    await loadEvent(parsed.eventId);
    return;
  }
  await loadList(true);
  restoreScroll();
}

function bind() {
  let searchTimer;
  document.getElementById("search").addEventListener("input", (e) => {
    state.q = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadList(true), 200);
  });
  document.getElementById("unread-btn").addEventListener("click", () => {
    state.unreadOnly = !state.unreadOnly;
    document.getElementById("unread-btn").setAttribute("aria-pressed", String(state.unreadOnly));
    loadList(true);
  });
  function closeSettings() {
    document.getElementById("settings").hidden = true;
  }
  async function openSettings() {
    const pane = document.getElementById("settings");
    pane.hidden = false;
    const note = document.getElementById("settings-note");
    const importBlock = document.getElementById("import-block");
    const snapshot = state.feed === "snapshot";
    if (note) {
      note.textContent = snapshot
        ? "当前是公开阅读页，设置先保存在这台设备上。"
        : "在这台设备上生效。屏蔽来源会在下一轮采集时同步到早报和通知。";
    }
    if (importBlock) importBlock.hidden = snapshot;
    let blocked = Array.isArray(state.prefs.blockedSources) ? state.prefs.blockedSources : [];
    try {
      const data = await api("/api/v1/settings");
      state.prefs = data.prefs || state.prefs;
      persistPrefs();
      blocked = state.prefs.blockedSources || blocked;
    } catch {
      // keep local prefs
    }
    document.getElementById("block-sources").value = blocked.join(",");
    document.getElementById("settings-close").focus();
  }
  document.getElementById("settings-btn").addEventListener("click", () => openSettings());
  document.getElementById("settings-close").addEventListener("click", closeSettings);
  document.getElementById("settings").addEventListener("click", (e) => {
    if (e.target.id === "settings") closeSettings();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !document.getElementById("settings").hidden) closeSettings();
  });
  document.getElementById("save-settings").addEventListener("click", async () => {
    const blockedSources = document.getElementById("block-sources").value.split(",").map((s) => s.trim()).filter(Boolean);
    state.prefs = { ...(state.prefs || {}), blockedSources };
    persistPrefs();
    try {
      await api("/api/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockedSources }),
      });
    } catch {
      // local save is enough on the public page
    }
    toast("已保存");
    closeSettings();
    if (state.view !== "event") renderList();
  });
  document.getElementById("import-btn").addEventListener("click", async () => {
    const url = document.getElementById("import-url").value.trim();
    const excerpt = document.getElementById("import-excerpt").value.trim();
    if (!url) {
      toast("请填写链接");
      return;
    }
    try {
      await api("/api/v1/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, excerpt }),
      });
      toast("已导入");
      document.getElementById("import-url").value = "";
    } catch (e) {
      toast("这页不能导入链接");
    }
  });
  document.getElementById("refresh-btn").addEventListener("click", async () => {
    closeSettings();
    await loadSaved().catch(() => {});
    await favorites.sync();
    await loadList(true);
    toast("已重新加载");
  });
  document.getElementById("more-btn").addEventListener("click", () => loadList(false));
  document.getElementById("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("aquasight-theme", next);
  });
  document.getElementById("exit-btn").addEventListener("click", async () => {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.includes("private") || k.includes("aquasight")).map((k) => caches.delete(k)));
    }
    toast("已清除页面缓存，收藏和偏好仍保留");
  });
  document.getElementById("reset-data-btn").addEventListener("click", () => {
    if (!confirm("清除这台设备上的收藏、屏蔽和已读记录？此操作不能恢复。")) return;
    localStorage.removeItem("aquasight-reads");
    localStorage.removeItem("aquasight-saved");
    localStorage.removeItem("aquasight-hidden");
    localStorage.removeItem("aquasight-prefs");
    state.reads = {};
    favorites.reset();
    syncSavedState();
    state.hiddenIds = new Set();
    state.prefs = {};
    toast("已重置本机收藏和偏好");
    if (state.view !== "event") renderList();
  });
  document.querySelector(".filters")?.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.hasAttribute("data-topic")) state.topic = btn.getAttribute("data-topic") || "";
    if (btn.hasAttribute("data-source")) state.source = btn.getAttribute("data-source") || "";
    loadList(true);
  });
  document.getElementById("main").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest("[data-id]") || btn;
    const id = btn.getAttribute("data-id") || card.getAttribute("data-id");
    const item =
      state.items.find((it) => it.id === id) ||
      (state.detailItem && state.detailItem.id === id ? state.detailItem : null);
    act(id, btn.getAttribute("data-act"), item);
  });
  window.addEventListener("hashchange", route);
  window.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement && document.activeElement.tagName !== "INPUT") {
      e.preventDefault();
      document.getElementById("search").focus();
    }
  });
}

function bootTheme() {
  const saved = localStorage.getItem("aquasight-theme");
  const pref = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", saved || (pref ? "dark" : "light"));
}

async function registerSw() {
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" });
  } catch {
    // ignore
  }
}

bootTheme();
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
loadReads().then(() => loadSaved().catch(() => {})).then(() => {
  void favorites.sync();
  return route();
});
registerSw();
