import { isHiddenCard, visibleCards, TOPIC_FILTERS, SOURCE_FILTERS } from "./rules.js";

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
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
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
  return String(it.overviewZh || it.summaryZh || it.summary || "").trim();
}

function cardHtml(it) {
  const read = Boolean(state.reads[it.id]);
  const href = "#/event/" + encodeURIComponent(it.id);
  const title = esc(displayTitle(it));
  const overview = overviewOf(it);
  const sources = Array.isArray(it.sources) && it.sources.length
    ? it.sources
    : [{ source: it.source, url: it.url, title: it.title }];
  const chips = sources
    .map((s) => {
      const label = s.source === "github" ? "开源发现" : s.source || "";
      return (
        '<a class="chip" href="' +
        esc(s.url || it.url || "#") +
        '" target="_blank" rel="noreferrer">' +
        esc(label) +
        "</a>"
      );
    })
    .join("");
  const when = formatBeijing(it.publishedAt || it.firstSeenAt || it.seenAt);
  const uncertain = it.enrichInsufficient
    ? '<p class="orig">资料不足，未根据标题补写细节。</p>'
    : "";
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
    (overview ? '<p class="overview">' + esc(overview) + "</p>" : "") +
    uncertain +
    '<p class="sources">' +
    chips +
    "</p>" +
    '<p class="meta-row"><time>' +
    esc(when) +
    "</time></p>" +
    '<div class="card-actions">' +
    '<button type="button" data-act="save">' +
    (state.saved.has(it.id) ? "取消收藏" : "收藏") +
    "</button>" +
    '<button type="button" data-act="share">分享</button>' +
    '<button type="button" data-act="read">' +
    (read ? "标为未读" : "标为已读") +
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
  detail.hidden = true;
  list.hidden = false;
  renderFilters();
  const localFilter =
    state.cached || state.view === "saved" || state.view === "digest" || state.view === "review";
  const filtered = state.items.filter((it) => {
    if (isHiddenCard(it)) return false;
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
  if (!filtered.length) {
    list.innerHTML = '<p class="empty">没有符合条件的内容。</p>';
    return;
  }
  list.innerHTML = filtered.map(cardHtml).join("");
}

function renderDetail(item, members) {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  list.hidden = true;
  detail.hidden = false;
  const facts = Array.isArray(item.facts) ? item.facts : [];
  const sources = Array.isArray(item.sources) && item.sources.length
    ? item.sources
    : [{ source: item.source, url: item.url, title: item.title }];
  const reports = (members || []).map((m) => {
    const disc = m.discussionUrl
      ? ' · <a href="' + esc(m.discussionUrl) + '" target="_blank" rel="noreferrer">讨论</a>'
      : "";
    return (
      "<li>" +
      esc(m.source || "") +
      " · " +
      esc(m.title || "") +
      (m.url
        ? ' · <a href="' + esc(m.url) + '" target="_blank" rel="noreferrer">原文</a>'
        : "") +
      disc +
      "</li>"
    );
  }).join("");
  const orig = item.title && displayTitle(item) !== item.title
    ? '<details><summary>原文标题</summary><p class="orig">' +
      esc(item.title) +
      "</p></details>"
    : "";
  const uncertain = item.enrichInsufficient
    ? "<p>资料不足，未根据标题虚构细节。</p>"
    : "";
  const attr = (item.attribution || [])
    .map((a) => "<li>" + esc(a.claim || "") + " — " + esc(a.source || "") + "</li>")
    .join("");
  detail.innerHTML =
    '<p><a class="text-btn" href="#/' +
    (state.returnView || "featured") +
    '" id="back-link">返回</a></p>' +
    "<h2>" +
    esc(displayTitle(item)) +
    "</h2>" +
    orig +
    "<p class=\"overview\">" +
    esc(overviewOf(item) || "国外原站不可达时，仍可阅读已保存的概述。") +
    "</p>" +
    uncertain +
    (facts.length ? "<h3>要点</h3><ul>" + facts.map((f) => "<li>" + esc(f) + "</li>").join("") + "</ul>" : "") +
    "<h3>来源与报道</h3><ul>" +
    sources
      .map((s) => {
        const disc = s.discussionUrl
          ? ' · <a href="' + esc(s.discussionUrl) + '" target="_blank" rel="noreferrer">讨论</a>'
          : "";
        return (
          "<li>" +
          esc(s.source === "github" ? "开源发现" : s.source || "") +
          " · <a href=\"" +
          esc(s.url || item.url || "#") +
          '" target="_blank" rel="noreferrer">' +
          esc(s.title || "链接") +
          "</a>" +
          disc +
          "</li>"
        );
      })
      .join("") +
    reports +
    "</ul>" +
    (attr ? "<h3>归属</h3><ul>" + attr + "</ul>" : "") +
    '<div class="card-actions">' +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="save">收藏</button>' +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="share">分享</button>' +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="hide">隐藏</button>' +
    '<button type="button" data-id="' +
    esc(item.id) +
    '" data-act="undo">撤销上次反馈</button>' +
    "</div>";
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
  el.className = "banner" + (kind === "error" ? " error" : "");
  el.textContent = text;
}

function applyConnectionBanner(other) {
  const extra = String(other || "").trim();
  if (navigator.onLine === false) {
    setBanner(
      extra && extra !== "当前离线，显示缓存内容。" ? "当前离线，显示缓存内容。 " + extra : "当前离线，显示缓存内容。",
      "error"
    );
    return;
  }
  if (state.cached) {
    setBanner(
      extra && extra !== "正在显示缓存内容。" && extra !== "网络失败，正在显示本地缓存。"
        ? "正在显示缓存内容。 " + extra
        : extra || "正在显示缓存内容。",
      "error"
    );
    return;
  }
  setBanner(extra);
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
  try {
    const data = await api("/api/v1/reads");
    state.reads = data.reads || {};
  } catch {
    state.reads = JSON.parse(localStorage.getItem("aquasight-reads") || "{}");
  }
}

async function loadSaved() {
  try {
    const data = await api("/api/v1/favorites");
    state.saved = new Set((data.items || []).map((it) => it.id || it.eventId));
  } catch {
    state.saved = new Set();
  }
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
      const data = await api(
        apiUrl("/api/v1/favorites", {
          q: state.q,
          category: state.topic,
          source: state.source,
          unread: state.unreadOnly ? "1" : "",
        })
      );
      state.cached = takeCacheFlag(data);
      if (state.cached) state.stale = true;
      state.items = data.items || [];
      state.snapshotAt = data.snapshotAt || "";
      state.cursor = null;
      document.getElementById("more-btn").hidden = true;
      renderList();
      applyConnectionBanner();
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
      const digest = data.digest || {};
      state.items = digest.items || [];
      state.snapshotAt = data.snapshotAt || digest.snapshotAt || "";
      state.cursor = null;
      document.getElementById("more-btn").hidden = true;
      renderList();
      applyConnectionBanner();
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
      if (failed.length) bits.push(failed.length + " 个源失败（" + failed.map((s) => s.source).join("、") + "）");
      if (st.emptyMeansFailure) bits.push("采集失败，不是没有新闻");
      applyConnectionBanner(bits.join(" · "));
      document.getElementById("meta").textContent =
        "快照 " +
        formatBeijing(state.snapshotAt) +
        (state.cached ? " · 缓存" : "") +
        (st.instantNotifyEnabled ? "" : " · 即时推送未开启");
    } catch {
      document.getElementById("meta").textContent =
        "快照 " + formatBeijing(state.snapshotAt) + (state.cached ? " · 缓存" : "");
      applyConnectionBanner();
    }
  } catch (e) {
    if (reset) {
      const fallback =
        state.view === "digest" ? (await loadDigestJson()) || (await loadEventsJson()) : await loadEventsJson();
      if (fallback) {
        const rawItems = Array.isArray(fallback.items)
          ? fallback.items
          : [].concat(fallback.tech || [], fallback.business || [], fallback.public || []);
        state.items = visibleCards(rawItems);
        state.cached = true;
        state.stale = true;
        applyConnectionBanner(navigator.onLine === false ? "" : "网络失败，正在显示本地缓存。");
        renderList();
        return;
      }
      list.innerHTML =
        '<div class="error-state"><p>无法加载信息流。</p><button type="button" class="text-btn" id="retry-btn">重试</button></div>';
      applyConnectionBanner(navigator.onLine === false ? "" : "无法加载信息流。");
      document.getElementById("retry-btn")?.addEventListener("click", () => loadList(true));
    } else {
      toast("加载更多失败");
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

async function loadEvent(id) {
  state.returnView = state.returnView || "featured";
  try {
    const data = await api("/api/v1/events/" + encodeURIComponent(id));
    renderDetail(data.item, data.members || []);
    document.getElementById("meta").textContent = "快照 " + formatBeijing(data.snapshotAt);
  } catch (e) {
    const local = state.items.find((it) => it.id === id);
    if (local) {
      renderDetail(local, local.sources || []);
      applyConnectionBanner("详情接口不可用，显示已保存摘要。");
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
      if (state.saved.has(id)) {
        await api("/api/v1/favorites/" + encodeURIComponent(id), { method: "DELETE" });
        state.saved.delete(id);
        toast("已取消收藏");
      } else {
        await api("/api/v1/favorites", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ eventId: id, snapshot: item }),
        });
        state.saved.add(id);
        toast("已收藏");
      }
    } else if (kind === "share") {
      const url = location.origin + location.pathname + "#/event/" + encodeURIComponent(id);
      if (navigator.share) await navigator.share({ title: displayTitle(item || { title: url }), url });
      else {
        await navigator.clipboard.writeText(url);
        toast("链接已复制");
      }
    } else if (kind === "read") {
      const next = !state.reads[id];
      await api("/api/v1/reads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: id, read: next }),
      });
      if (next) state.reads[id] = new Date().toISOString();
      else delete state.reads[id];
      localStorage.setItem("aquasight-reads", JSON.stringify(state.reads));
    } else if (kind === "hide" || kind === "like" || kind === "dislike") {
      const data = await api("/api/v1/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, eventId: id, topic: item && item.subject, source: item && item.source }),
      });
      state.lastFeedbackId = data.feedback && data.feedback.id;
      if (kind === "like" || kind === "dislike") state.rated[id] = kind;
      toast(kind === "hide" ? "已隐藏" : kind === "like" ? "已记录喜欢" : "已记录不喜欢");
      if (kind === "hide") await loadList(true);
      if (state.view === "review") {
        const review = await api("/api/v1/review");
        renderReview(review.samples || []);
        return;
      }
    } else if (kind === "undo") {
      if (!state.lastFeedbackId) {
        toast("没有可撤销的反馈");
        return;
      }
      await api("/api/v1/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ undoId: state.lastFeedbackId }),
      });
      toast("已撤销");
      await loadList(true);
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
  document.getElementById("settings-btn").addEventListener("click", async () => {
    const pane = document.getElementById("settings");
    pane.hidden = !pane.hidden;
    if (!pane.hidden) {
      try {
        const data = await api("/api/v1/settings");
        state.prefs = data.prefs || {};
        document.getElementById("block-sources").value = (state.prefs.blockedSources || []).join(",");
      } catch {
        toast("无法加载设置");
      }
    }
  });
  document.getElementById("save-settings").addEventListener("click", async () => {
    const blockedSources = document.getElementById("block-sources").value.split(",").map((s) => s.trim()).filter(Boolean);
    try {
      await api("/api/v1/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blockedSources }),
      });
      toast("设置已保存");
    } catch (e) {
      toast("保存失败：" + (e.message || ""));
    }
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
      toast("导入失败：" + (e.message || ""));
    }
  });
  document.getElementById("refresh-btn").addEventListener("click", async () => {
    await loadList(true);
    toast("已刷新，筛选仍保留");
  });
  document.getElementById("more-btn").addEventListener("click", () => loadList(false));
  document.getElementById("theme-btn").addEventListener("click", () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("aquasight-theme", next);
  });
  document.getElementById("exit-btn").addEventListener("click", async () => {
    localStorage.removeItem("aquasight-reads");
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.includes("private") || k.includes("aquasight")).map((k) => caches.delete(k)));
    }
    toast("已清除私人缓存");
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
    const item = state.items.find((it) => it.id === id);
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
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // ignore
  }
}

bootTheme();
window.addEventListener("offline", () => applyConnectionBanner());
window.addEventListener("online", () => applyConnectionBanner());
applyConnectionBanner();
bind();
loadReads().then(loadSaved).then(route);
registerSw();
