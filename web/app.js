import { createFavorites } from "./favorites.js";
import { isHiddenCard, visibleCards, TOPIC_FILTERS, SOURCE_FILTERS, sourceLabel, cardBody, readingMarks, countCoverage, digestDateLine, pickLead } from "./rules.js";
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
};

let loadGeneration = 0;
let authEpoch = 0;
const views = ["featured", "latest", "digest", "saved"];
const VIEW_TITLES = {
  featured: { title: "精选", subtitle: "从今天的消息里，选出值得读的。" },
  latest: { title: "最新", subtitle: "按时间，看看正在发生的事。" },
  digest: { title: "早报", subtitle: "一天一期，把重要的消息读一遍。" },
  saved: { title: "收藏", subtitle: "留给之后，再仔细读。" },
  review: { title: "口味校准", subtitle: "标记喜欢或不喜欢，早报会更合口味。" },
};

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
  el.innerHTML = esc(msg) + (onUndo ? '<button type="button" id="toast-undo">撤销</button>' : "");
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
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ...opts }).formatToParts(d);
  return (type) => parts.find((p) => p.type === type)?.value || "";
}

function formatBeijing(iso) {
  if (!iso) return "";
  const get = beijingParts(iso, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  if (!get) return "";
  return `${Number(get("month"))}月${Number(get("day"))}日 ${get("hour")}:${get("minute")}`;
}

function formatBeijingDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "long", day: "numeric" });
}

function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "刚刚";
  const m = Math.round(s / 60);
  if (m < 60) return m + " 分钟前";
  const h = Math.round(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.round(h / 24);
  if (d < 8) return d + " 天前";
  return "";
}

function todayLine() {
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
    sync.textContent = pending + " 项收藏变更等待同步，可刷新重试";
  }
  document.querySelectorAll("button[data-act=save]").forEach((btn) => {
    const id = btn.dataset.id || btn.closest("[data-id]")?.dataset.id;
    if (!id) return;
    const on = state.saved.has(id);
    btn.setAttribute("aria-pressed", String(on));
    const label = btn.querySelector(".bookmark") ? (on ? "取消收藏" : "收藏") : null;
    if (label) btn.setAttribute("aria-label", label + "这条新闻");
    else btn.textContent = on ? "已收藏" : "收藏";
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
  const t = it.category || it.subject || "";
  const found = TOPIC_FILTERS.find(([id]) => id && (id === t || (id === "tech" && t === "tech")));
  if (found) return found[1].replace("AI/", "");
  return "综合";
}

function storyTime(it) {
  const hasPublished = Boolean(it.publishedAt);
  const base = it.publishedAt || it.firstSeenAt || it.seenAt;
  const abs = formatBeijing(base);
  const rel = relativeTime(base) || abs;
  return { hasPublished, rel, abs, label: hasPublished ? rel : base ? "发现于 " + rel : "时间未知" };
}

function aiNote(it) {
  const marks = readingMarks(it);
  if (marks.prepared) return '<span class="ai-mark">AI 已整理</span>';
  if (marks.pending) return '<span class="pending-mark">AI 整理排队中</span>';
  if (marks.state === "failed" || marks.state === "insufficient") return "";
  return "";
}

function storyHtml(it, { lead = false, compact = false } = {}) {
  const read = Boolean(state.reads[it.id]);
  const href = "#/event/" + encodeURIComponent(it.id);
  const sources = uniqueSources(it);
  const primary = sources[0] || { source: it.source };
  const t = storyTime(it);
  const body = compact ? { kind: "empty" } : cardBody(it);
  const marks = readingMarks(it);
  const heat = Number.isFinite(it.points) && it.points >= 20
    ? '<span class="heat">▲ ' + it.points + "</span>"
    : "";
  const cov = countCoverage(sources);
  const countN = cov.media > 1 ? '<span class="sep">·</span><span>' + cov.media + " 家媒体报道</span>" : "";
  const summary = body.kind === "empty"
    ? ""
    : '<p class="summary clamp">' + esc(body.text) + "</p>";
  return (
    '<article class="story' +
    (lead ? " lead" : "") +
    (read ? " read" : "") +
    '" data-id="' + esc(it.id) + '">' +
    (lead ? '<span class="lead-label">今日关注</span>' : "") +
    '<div class="story-meta">' +
    '<span class="topic">' + esc(topicLabel(it)) + "</span>" +
    '<span class="sep">·</span>' +
    "<span>" + esc(sourceLabel(primary.source || it.source)) + "</span>" +
    '<span class="sep">·</span>' +
    '<time title="北京时间 ' + esc(t.abs) + '">' + esc(t.label) + "</time>" +
    countN +
    heat +
    (body.kind === "overview" && marks.prepared && !compact ? '<span class="sep">·</span>' + aiNote(it) : "") +
    "</div>" +
    '<h2><a href="' + href + '">' + esc(displayTitle(it)) + "</a></h2>" +
    summary +
    '<button type="button" class="save-btn" data-act="save" data-id="' + esc(it.id) +
    '" aria-pressed="' + state.saved.has(it.id) + '" aria-label="' +
    (state.saved.has(it.id) ? "取消收藏" : "收藏") + '这条新闻"><span class="bookmark" aria-hidden="true"></span></button>' +
    "</article>"
  );
}

function beijingDay(iso) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function dateSections(items) {
  const today = beijingDay(new Date().toISOString());
  const yesterday = beijingDay(new Date(Date.now() - 864e5).toISOString());
  const out = [];
  let lastKey = "";
  for (const it of items) {
    const day = beijingDay(it.publishedAt || it.firstSeenAt || it.seenAt);
    let label = "";
    if (!day) label = "时间未知";
    else if (day === today) label = "今天 · " + formatBeijingDate(it.publishedAt || it.firstSeenAt);
    else if (day === yesterday) label = "昨天 · " + formatBeijingDate(it.publishedAt || it.firstSeenAt);
    else label = formatBeijingDate(it.publishedAt || it.firstSeenAt) || "更早";
    if (label !== lastKey) {
      out.push('<div class="date-section">' + esc(label) + "</div>");
      lastKey = label;
    }
    out.push(storyHtml(it, { compact: true }));
  }
  return out.join("");
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
    topicEl.innerHTML = TOPIC_FILTERS.map(([t, label]) =>
      '<button type="button" class="' + (state.topic === t ? "active" : "") +
      '" aria-pressed="' + (state.topic === t) + '" data-topic="' + esc(t) + '">' + esc(label) + "</button>"
    ).join("");
  }
  const trigger = document.getElementById("filter-trigger");
  if (trigger) {
    const n = filterCount();
    trigger.textContent = n ? "筛选 · " + n : "筛选";
    trigger.classList.toggle("has-filter", Boolean(n));
  }
}

function emptyHtml(kind) {
  if (kind === "filters") {
    return '<div class="empty"><h2>这个筛选下还没有内容</h2><p>试试其他分类，或清除筛选。</p><button type="button" class="text-link" data-act="clear-filters">清除筛选</button></div>';
  }
  if (kind === "saved") {
    return '<div class="empty"><h2>值得留住的，放在这里</h2><p>点一下新闻旁的收藏标记，之后随时回来读。</p><a class="text-link" href="#/featured">回到精选 →</a></div>';
  }
  if (kind === "digest") {
    return '<div class="empty"><h2>今天的早报还没有生成</h2><p>早上会整理一版，也可以先看看精选。</p><a class="text-link" href="#/featured">看看精选 →</a></div>';
  }
  return '<div class="empty"><h2>暂时没有新闻</h2><p>稍后刷新再看看。</p></div>';
}

function feedEndHtml(view, count) {
  if (!count) return "";
  if (view === "latest") return '<footer class="feed-end"><span>已看到本轮最新消息</span><a href="#/featured">回到精选 →</a></footer>';
  if (view === "saved") return '<footer class="feed-end"><span>以上是你的全部收藏</span><a href="#/featured">回到精选 →</a></footer>';
  return '<footer class="feed-end"><span>本轮精选到这里</span><a href="#/latest">查看最新 →</a></footer>';
}

function renderFilterNote() {
  const el = document.getElementById("filter-note");
  if (!el) return;
  const bits = [];
  if (state.q) bits.push("“" + state.q + "”");
  if (state.topic) bits.push(TOPIC_FILTERS.find(([t]) => t === state.topic)?.[1] || state.topic);
  if (state.source) bits.push(sourceLabel(state.source));
  if (state.unreadOnly) bits.push("只看未读");
  if (!bits.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.className = "notice";
  el.innerHTML = "当前筛选：" + esc(bits.join(" · ")) +
    ' <button type="button" data-act="clear-filters">清除筛选</button>';
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
  const view = state.view;
  if (view === "digest") {
    list.innerHTML = digestHtml();
    syncSavedState();
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
      const blob = [it.title, it.titleZh, it.overviewZh, it.summary].join(" ").toLowerCase();
      if (!blob.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
  const undo = state.hideUndo
    ? '<p class="undo-bar">已隐藏该条 <button type="button" data-act="undo">撤销</button></p>'
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
    const intro =
      '<div class="saved-summary"><span>' + filtered.length + " 篇 · 保存在这台设备" +
      (favorites.pendingCount() ? " · " + favorites.pendingCount() + " 项待同步" : "") +
      "</span>" +
      (state.user
        ? '<span>已登录 ' + esc(state.user.email) + "</span>"
        : '<button type="button" class="text-link" data-act="login">登录后同步 ↗</button>') +
      "</div>";
    body = intro + filtered.map((it) => storyHtml(it)).join("");
  } else if (view === "review") {
    body = filtered.map((it) => storyHtml(it) + reviewButtons(it)).join("");
  } else {
    // 今日关注 is earned by quality (pickLead), never by array position;
    // a list with no qualifying story simply has no lead.
    const leadItem = !hasFilters() && filtered.length > 1 ? pickLead(filtered) : null;
    body = filtered.map((it) => storyHtml(it, { lead: it === leadItem })).join("");
  }
  list.innerHTML = undo + body + feedEndHtml(view, filtered.length);
  syncSavedState();
}

function reviewButtons(it) {
  const rated = state.rated[it.id];
  if (rated) {
    return '<p class="story-meta" style="padding:4px 0 18px">已记录：' + (rated === "like" ? "喜欢" : "不喜欢") + "</p>";
  }
  return (
    '<div class="detail-actions" style="padding:10px 0 18px;border:0;margin:0">' +
    '<button type="button" data-act="like" data-id="' + esc(it.id) + '">喜欢</button>' +
    '<button type="button" data-act="dislike" data-id="' + esc(it.id) + '">不喜欢</button></div>'
  );
}

function digestHtml() {
  const digest = state.digest || {};
  const items = digest.items || [];
  if (!items.length || digest.missing) return emptyHtml("digest");
  const { showDate, weekday } = digestDateLine(digest.date || "");
  const minutes = Math.max(1, Math.round(items.length * 0.4));
  const cutoff = state.snapshotAt ? " · 截至北京时间 " + formatBeijing(state.snapshotAt) : "";
  const summary = String(state.digestSummary || "").trim()
    ? '<p class="edition-intro"><span class="ai-mark">综述</span>' + esc(state.digestSummary) + "</p>"
    : "";
  const groups = [
    ["tech", "科技", digest.tech || []],
    ["business", "商业", digest.business || []],
    ["public", "世界", digest.public || []],
  ];
  let n = 0;
  const sections = groups
    .filter(([, , list]) => list.length)
    .map(([, label, list]) =>
      '<section class="digest-group"><h2 class="group-heading">' + label + "</h2>" +
      list.map((it) => {
        n += 1;
        const t = storyTime(it);
        return (
          '<article class="digest-story"><span class="digest-number">' + String(n).padStart(2, "0") + "</span><div>" +
          '<h2><a href="#/event/' + encodeURIComponent(it.id) + '">' + esc(displayTitle(it)) + "</a></h2>" +
          (cardBody(it).kind === "empty" ? "" : "<p>" + esc(cardBody(it).text) + "</p>") +
          "<small>" + esc(sourceLabel(it.source)) + " · " + esc(t.label) + "</small>" +
          "</div></article>"
        );
      }).join("") +
      "</section>"
    ).join("");
  return (
    '<article class="edition">' +
    '<div class="edition-top"><span>' + esc((showDate + " · " + weekday).replace(/^ · | · $/g, "")) + "</span></div>" +
    "<h1>早上好，<br>这是今天值得知道的事。</h1>" +
    summary +
    '<div class="edition-info">' + items.length + " 条消息 · 约需 " + minutes + " 分钟" + esc(cutoff) + "</div>" +
    sections +
    '<footer class="feed-end"><span>早报完。</span><a href="#/featured">回看精选 →</a></footer>' +
    "</article>"
  );
}

const INTERNAL_REASON = /[:：]\s*(pricing-missing|no-credential|model-unavailable|http-[a-z0-9-]*|timeout[a-z0-9-]*|extract-[a-z0-9-]*|invalid[:a-z0-9-]*|parse|budget[a-z0-9-]*|BUDGET_CANDIDATES)\s*$/i;

function humanizedNotes(item) {
  const marks = readingMarks(item);
  if (marks.state === "failed") return ["这条还没有 AI 整理，下次采集会自动补上。"];
  if (marks.state === "queued") return ["正在排队等待 AI 整理。"];
  if (marks.state === "insufficient") return ["原始资料不足，暂时没有生成中文摘要。"];
  const rawNotes = (item.uncertainty || []).filter((a) => typeof a === "string" && a.trim());
  if (!rawNotes.length) return [];
  const machineOnly = rawNotes.every((a) => INTERNAL_REASON.test(a));
  if (machineOnly) return ["这条还没有 AI 整理，下次采集会自动补上。"];
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
  const facts = (Array.isArray(item.facts) ? item.facts.filter(Boolean) : []).slice(0, 3);
  const sources = uniqueSources(item, members);
  const marks = readingMarks(item);
  const body = cardBody(item);
  const t = storyTime(item);

  let intro = "";
  if (body.kind === "overview") {
    intro = '<p class="detail-intro">' + esc(body.text) + "</p>";
  } else if (body.kind === "excerpt") {
    intro =
      '<h2>速览</h2><p class="detail-intro" style="font-size:17px">' + esc(body.text) + "</p>" +
      '<p style="font-size:13px">以上为原文摘录，尚未生成中文概述。</p>';
  } else {
    intro = pendingIntro(item);
  }

  const factsHtml = facts.length
    ? "<h2>值得留意</h2><ol class='fact-list'>" +
      facts.map((f, i) => '<li><span class="fact-num">0' + (i + 1) + "</span><span>" + esc(f) + "</span></li>").join("") +
      "</ol>"
    : "";
  const impact = String(item.impact || "").trim();
  const impactHtml = impact
    ? "<h2>放在背景里看</h2><span class='analysis-tag'>以下为分析推断，非原文事实</span><p>" + esc(impact) + "</p>"
    : "";
  const notes = humanizedNotes(item);
  const notesHtml = notes.length
    ? "<h2>AI 说明</h2>" + notes.map((n) => "<p>" + esc(n) + "</p>").join("")
    : "";

  const sourceItems = sources.map((s) => {
    const href = /^https?:\/\//i.test(s.url || "") ? s.url : "";
    const origTitle = s.title && s.title !== displayTitle(item) ? "<br>" + esc(s.title) : "";
    const when = formatBeijing(s.publishedAt || "");
    return href
      ? '<a href="' + esc(href) + '" target="_blank" rel="noreferrer">' +
        esc(sourceLabel(s.source || item.source)) + ' <span class="out">↗</span>' + origTitle + "</a>" +
        (when ? "<small>发布于 北京时间 " + esc(when) + "</small>" : "<small>来源页面</small>")
      : "<a>" + esc(sourceLabel(s.source || item.source)) + origTitle + "</a><small>未提供可点击链接</small>";
  }).join("");
  const attr = (item.attribution || [])
    .map((a) => '<p class="claim">' + esc(a.claim || a) + (a.source ? " — " + esc(a.source) : "") + "</p>")
    .join("");
  const cov = countCoverage(sources);
  const single = cov.media <= 1
    ? "<small>单一媒体 · 来源观点与已验证事实需区分</small>"
    : "<small>" +
      cov.articles + " 篇报道 · " + cov.media + " 家媒体 · " + cov.origins + " 个独立信源" +
      "</small>";
  const sourceBox =
    '<div class="source-box"><h2>来源与报道</h2>' + sourceItems + single + attr + "</div>";

  const origTitleEn = item.title && displayTitle(item) !== item.title
    ? "<p>英文原题：" + esc(item.title) + "</p>"
    : "";
  const rawMaterial = String(item.summary || "").trim();
  const rawHtml = body.kind !== "excerpt" && rawMaterial && rawMaterial !== body.text
    ? "<p>" + esc(rawMaterial.slice(0, 1200)) + "</p>"
    : "";
  const evidence = (item.evidence || [])
    .map((a) => "<li>" + esc(typeof a === "string" ? a : a.claim || a.url || "") + "</li>")
    .join("");
  const evidenceHtml = evidence ? "<p>信源摘录：</p><ul>" + evidence + "</ul>" : "";
  const detailsBlock = origTitleEn || rawHtml || evidenceHtml
    ? "<details><summary>原文信息</summary>" + origTitleEn + rawHtml + evidenceHtml + "</details>"
    : "";

  const attrLine = marks.prepared
    ? '<p class="attribution">中文摘要与要点由 AI 依据上述来源整理，仅供参考；请以原文为准。</p>'
    : '<p class="attribution">内容来自公开来源聚合。</p>';

  const primaryUrl = (/^https?:\/\//i.test(item.url || "") && item.url) || (sources[0] && sources[0].url) || "";
  const readOriginal = primaryUrl
    ? '<a class="primary" target="_blank" rel="noreferrer" href="' + esc(primaryUrl) + '">阅读来源 ↗</a>'
    : "";
  const idx = state.items.findIndex((it) => it.id === item.id);
  const next = idx >= 0 && state.items.length > 1 ? state.items[(idx + 1) % state.items.length] : null;
  const nextHtml = next
    ? '<a class="detail-next" href="#/event/' + encodeURIComponent(next.id) +
      '"><small>继续读下一条</small><span>' + esc(displayTitle(next)) + " →</span></a>"
    : "";

  detail.innerHTML =
    '<a class="back" id="back-link" href="#/' + (state.returnView || "featured") + '">← 返回' +
    (VIEW_TITLES[state.returnView]?.title || "精选") + "</a>" +
    '<div class="story-meta">' +
    '<span class="topic">' + esc(topicLabel(item)) + "</span>" +
    '<span class="sep">·</span><span>' + esc(sourceLabel(item.source)) + "</span>" +
    '<span class="sep">·</span>' +
    '<time title="北京时间 ' + esc(t.abs) + '">' + esc(t.label) + "</time>" +
    (cov.media > 1 ? '<span class="sep">·</span><span>' + cov.media + " 家媒体报道</span>" : "") +
    (marks.prepared ? '<span class="sep">·</span>' + aiNote(item) : "") +
    "</div>" +
    "<h1>" + esc(displayTitle(item)) + "</h1>" +
    '<div class="detail-actions">' +
    readOriginal +
    '<button type="button" data-act="save" data-id="' + esc(item.id) + '" aria-pressed="' + state.saved.has(item.id) + '">' +
    (state.saved.has(item.id) ? "已收藏" : "收藏") + "</button>" +
    '<button type="button" data-act="share" data-id="' + esc(item.id) + '">分享</button>' +
    '<button type="button" data-act="more" data-id="' + esc(item.id) + '" aria-label="更多操作">···</button>' +
    "</div>" +
    intro +
    factsHtml +
    impactHtml +
    notesHtml +
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
    setBanner("现在离线，正在显示已保存的内容。", "warn");
    return;
  }
  if (state.feed === "snapshot") {
    setBanner(extra, extra ? "warn" : "");
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
  const stale = staleLabel();
  if (stale) {
    setBanner("内容可能已陈旧：最新一条来自 " + stale + "前。", "warn");
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
  return hours < 72 ? Math.round(hours) + " 小时" : Math.round(hours / 24) + " 天";
}

function updateMeta() {
  const el = document.getElementById("meta");
  if (!el) return;
  const when = state.snapshotAt ? formatBeijing(state.snapshotAt) : "";
  el.textContent = when ? "更新于 " + when + (state.cached ? " · 缓存" : "") : "";
}

// Internal operational detail (AI coverage, budget gate, source outages)
// rendered inside 设置 → 状态详情, not on the reading surface.
function statusDetailsBody() {
  const pool = (state.items || []).filter((it) => it && it.id);
  const ready = pool.filter((it) => readingMarks(it).prepared).length;
  const aiLine = pool.length
    ? "AI 中文整理 " + ready + "/" + pool.length + " 条（当前页）"
    : "AI 中文整理：暂无数据";
  const reasons = {
    "pricing-missing": "未配置模型单价，整理暂停",
    "pricing-invalid": "模型单价无效，整理暂停",
    "daily-cap": "达到每日费用上限，整理暂停",
    "monthly-cap": "达到每月费用上限，整理暂停",
    "candidate-cap": "达到每日处理上限，整理将在下个周期继续",
  };
  const blocked = state.budgetStatus && state.budgetStatus.blockedReason;
  const budgetLine = blocked
    ? reasons[blocked] || "整理暂停：" + blocked
    : "预算正常";
  const failed = (state.sourceHealth || []).filter((s) => !s.ok);
  const failLine = failed.length
    ? failed.length + " 个源抓取失败：" + failed.map((s) => sourceLabel(s.source) || s.source).join("、")
    : "全部信息源正常";
  return (
    "<details class='status-details'><summary>状态详情</summary>" +
    "<p>" + esc(aiLine) + "</p>" +
    "<p>" + esc(budgetLine) + "</p>" +
    "<p>" + esc(failLine) + "</p>" +
    "</details>"
  );
}

function updateNav() {
  const conf = VIEW_TITLES[state.view] || VIEW_TITLES.featured;
  const title = document.getElementById("view-title");
  const subtitle = document.getElementById("view-subtitle");
  if (title) title.textContent = conf.title;
  if (subtitle) subtitle.textContent = state.view === "event" ? "" : conf.subtitle;
  const heading = document.getElementById("feed-heading");
  if (heading) heading.hidden = state.view === "event";
  const filtersRow = document.getElementById("filters-row");
  if (filtersRow) filtersRow.hidden = ["event", "saved", "review", "digest"].includes(state.view);
  document.querySelectorAll(".nav a, .bottom-nav a").forEach((a) => {
    const on = a.getAttribute("data-view") === state.view;
    if (on) {
      a.setAttribute("aria-current", "page");
      a.classList.add("active");
    } else {
      a.removeAttribute("aria-current");
      a.classList.remove("active");
    }
  });
  document.title = (state.view === "event" ? "阅读" : conf.title) + " · 鸭先知 Ponder";
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
  const detail = document.getElementById("detail");
  const list = document.getElementById("list");
  const heading = document.getElementById("feed-heading");
  const filtersRow = document.getElementById("filters-row");
  detail.hidden = true;
  if (heading) heading.hidden = false;
  if (filtersRow) filtersRow.hidden = ["saved", "review", "digest"].includes(state.view);
  list.hidden = false;
  if (reset) {
    list.innerHTML =
      '<div class="skeleton"><div class="bar w1"></div><div class="bar w2"></div><div class="bar w3"></div></div>'.repeat(3);
    state.items = [];
    state.cursor = null;
  }
  try {
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
      state.digestSummary = (digest.aiSummary && digest.aiSummary.text) || "";
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
      if (st.emptyMeansFailure) bits.push("采集失败，不是没有新闻");
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
      const fallback =
        state.view === "digest" ? await loadDigestJson() : await loadEventsJson();
      if (!current()) return;
      if (fallback) {
        applySnapshot(fallback, state.view);
        applyConnectionBanner(e.status === 404 ? "" : "后台暂不可用，显示已保存的快照。");
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
        list.innerHTML = '<p class="empty">口味校准需要连接个人后台。</p>';
        return;
      }
      state.feed = navigator.onLine === false ? "offline" : "error";
      list.innerHTML =
        '<div class="error-state"><p>暂时读不到新闻。</p><button type="button" class="text-link" id="retry-btn">重试</button></div>';
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
  const data = await loadEventsJson();
  state.budgetStatus = data?.budget || state.budgetStatus;
  const fromEvents = snapshotItems(data).find((it) => it && it.id === id);
  if (fromEvents) return fromEvents;
  return snapshotItems(await loadDigestJson()).find((it) => it && it.id === id) || null;
}

async function loadEvent(id) {
  const generation = ++loadGeneration;
  const current = () => generation === loadGeneration;
  state.returnView = state.returnView || "featured";
  const detail = document.getElementById("detail");
  detail.innerHTML =
    '<div class="skeleton"><div class="bar w1"></div><div class="bar w2"></div><div class="bar w3"></div></div>';
  try {
    const data = await api("/api/v1/events/" + encodeURIComponent(id));
    if (!current()) return;
    renderDetail(data.item, data.members || []);
    if (data.snapshotAt) state.snapshotAt = data.snapshotAt;
    updateMeta();
  } catch (e) {
    if (!current()) return;
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
    document.getElementById("list").hidden = true;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="empty"><h2>这篇内容暂时找不到</h2><p>可能已过期，或需要登录后查看。</p><a class="text-link" href="#/featured">返回精选</a></div>';
  }
}

function renderReview(samples) {
  const list = document.getElementById("list");
  const detail = document.getElementById("detail");
  detail.hidden = true;
  list.hidden = false;
  list.innerHTML =
    '<p class="notice">对至少 30 条标记喜欢或不喜欢，早报会更合口味。当前已记录 ' +
    samples.length + " 条。7 天影子运行未完成前不会自动开启即时推送。</p>" +
    state.items.map((it) => storyHtml(it) + reviewButtons(it)).join("");
}

async function act(id, kind, item) {
  try {
    if (kind === "save") {
      const save = !favorites.has(id);
      const snap = snapshotOf(item) || snapshotOf(state.detailItem?.id === id ? state.detailItem : null);
      if (save && !snap) { toast("没有可收藏的内容"); return; }
      favorites.set(id, save ? snap : null);
      const feedbackSeq = state.favoriteAction = (state.favoriteAction || 0) + 1;
      const localMessage = save ? "已加入收藏" : "已取消收藏";
      toast(localMessage + (favorites.isAvailable() && favorites.pending(id) ? "，待同步" : ""));
      if (favorites.isAvailable()) {
        await favorites.sync();
        if (state.favoriteAction === feedbackSeq) {
          toast(favorites.pending(id) ? localMessage + "，待同步" : localMessage);
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
    if (state.eventId === parsed.eventId) window.scrollTo(0, 0);
    return;
  }
  await loadList(true);
  if (state.view === parsed.view) restoreScroll();
}

/* ---------- dialogs ---------- */

const modal = () => document.getElementById("modal");
let lastFocus = null;
let loginResendTimer = null;

function openDialog(title, bodyHtml) {
  const m = modal();
  lastFocus = document.activeElement;
  m.innerHTML =
    '<div class="dialog-heading"><h2>' + title + '</h2><button type="button" class="close" data-close>关闭</button></div>' +
    bodyHtml;
  if (!m.open) m.showModal();
}
function closeDialog() {
  const m = modal();
  if (loginResendTimer) { clearInterval(loginResendTimer); loginResendTimer = null; }
  if (m.open) m.close();
  lastFocus?.focus?.({ preventScroll: true });
}

function paintAccount() {
  const label = document.getElementById("account-label");
  const avatar = document.querySelector("#account-btn .avatar");
  if (state.user && state.user.email) {
    if (label) label.textContent = state.user.email;
    if (avatar) avatar.textContent = state.user.email[0].toUpperCase();
  } else {
    if (label) label.textContent = "登录以同步收藏";
    if (avatar) avatar.textContent = "访";
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
  await purgeUserCaches();
  await refreshMe();
  syncSavedState();
}

function settingsBody() {
  const blocked = new Set(state.prefs.blockedSources || []);
  const sourceRows = SOURCE_FILTERS.filter(([id]) => id)
    .map(([id, label]) =>
      '<label class="setting-row"><span>' + esc(label) + "</span>" +
      '<input type="checkbox" data-source-toggle value="' + esc(id) + '"' + (blocked.has(id) ? "" : " checked") + "></label>"
    ).join("");
  const account = state.user
    ? '<div class="setting-row"><span>账户</span><span>' + esc(state.user.email) + "</span></div>" +
      '<button type="button" class="text-link" data-action="login" style="text-align:left">管理登录与同步 →</button>'
    : '<div class="setting-row"><span>账户与同步</span><button type="button" class="text-link" data-action="login">登录 →</button></div>' +
      "<p>登录后，同步你的收藏和阅读偏好。</p>";
  return (
    '<p class="subhead">阅读外观</p>' +
    '<div class="setting-row"><label for="theme-select">外观</label><select id="theme-select">' +
    '<option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>' +
    "</select></div>" +
    '<p class="subhead">内容来源</p>' +
    "<p>关闭后，精选与最新里不再显示该来源。</p>" +
    sourceRows +
    '<button type="button" class="text-link" data-action="review" style="text-align:left;margin-top:14px">口味校准（高级） →</button>' +
    '<p class="subhead">账户与同步</p>' + account +
    '<p class="subhead">数据管理</p>' +
    '<div class="setting-row"><span>页面缓存</span><button type="button" class="text-link" data-action="clear-cache">清除缓存</button></div>' +
    '<div class="setting-row"><span>本机收藏与偏好</span><button type="button" class="text-link danger-text" data-action="reset-data">重置</button></div>' +
    statusDetailsBody() +
    '<p id="settings-save-note" class="form-error" hidden></p>'
  );
}

function loginStepBody() {
  return (
    "<p>登录后，同步你的收藏和阅读偏好。</p>" +
    '<form id="login-form"><label class="field-label" for="login-email">邮箱地址</label>' +
    '<input id="login-email" type="email" required placeholder="you@example.com" autocomplete="email" inputmode="email">' +
    '<p id="login-error" class="form-error" hidden></p>' +
    '<button class="primary wide" type="submit" id="login-send">获取验证码</button></form>'
  );
}

function loginCodeBody(email) {
  return (
    "<p>验证码已发送至 <strong>" + esc(email) + "</strong>，10 分钟内有效。</p>" +
    '<form id="code-form"><label class="field-label" for="login-code">6 位验证码</label>' +
    '<input id="login-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="输入验证码" required>' +
    '<p id="code-error" class="form-error" hidden></p>' +
    '<button class="primary wide" type="submit" id="login-verify">登录</button></form>' +
    '<div class="resend-line"><span id="resend-countdown">重新发送（60 秒）</span>' +
    '<button type="button" id="login-change-email">修改邮箱</button></div>'
  );
}

function accountBody() {
  return (
    '<div class="setting-row"><span>当前账户</span><span>' + esc(state.user.email) + "</span></div>" +
    "<p>收藏与阅读偏好已随账户同步。</p>" +
    '<p id="logout-error" class="form-error" hidden></p>' +
    '<button type="button" class="text-link" data-action="logout" style="text-align:left">退出当前设备</button>' +
    '<button type="button" class="text-link" data-action="logout-all" style="text-align:left">退出所有设备</button>' +
    '<div class="danger-zone"><button type="button" data-action="delete-account">注销账户（不可恢复）</button></div>'
  );
}

// Server-side revocation must succeed (and /me must confirm the session is
// gone) before we claim the user is signed out; a failed POST shows an error
// and leaves the account sheet open for a retry.
async function performLogout(path, successMsg) {
  const errEl = document.getElementById("logout-error");
  const fail = (msg) => {
    if (errEl) {
      errEl.hidden = false;
      errEl.textContent = msg;
    }
    toast("退出未完成，请重试");
  };
  try {
    await api(path, { method: "POST" });
  } catch {
    fail("服务器撤销会话失败，请稍后重试。");
    return;
  }
  try {
    const me = await api("/api/v1/me");
    // A live OTP session carries the account email; local-mode /me answers
    // 200 with a guest local user, which is not a session to confirm.
    if (me && me.user && me.user.email) {
      fail("会话仍在生效，退出未确认。");
      return;
    }
  } catch {
    // 401 from /me is the expected confirmation of a dead session.
  }
  localStorage.removeItem("aquasight-token");
  await onAuthChanged();
  closeDialog();
  toast(successMsg);
}

function filterBody() {
  const sourceRadios = SOURCE_FILTERS.map(([id, label]) =>
    '<label class="setting-row"><span>' + esc(label) + "</span>" +
    '<input type="radio" name="source-pick" value="' + esc(id) + '"' + (state.source === id ? " checked" : "") + "></label>"
  ).join("");
  return (
    '<p class="subhead">来源</p>' + sourceRadios +
    '<p class="subhead">阅读状态</p>' +
    '<label class="setting-row"><span>只看未读</span><input type="checkbox" id="unread-toggle"' + (state.unreadOnly ? " checked" : "") + "></label>" +
    '<button type="button" class="primary wide" data-action="apply-filter">查看结果</button>'
  );
}

function searchBody() {
  return (
    '<label class="field-label" for="search-input">标题、摘要或来源</label>' +
    '<form id="search-form"><input id="search-input" type="search" placeholder="搜索你想知道的事" autocomplete="off"></form>' +
    '<div id="search-results"></div>'
  );
}

function shareBody(id, item) {
  const url = location.origin + location.pathname + "#/event/" + encodeURIComponent(id);
  return (
    "<p>复制这篇内容的阅读链接。</p>" +
    '<label class="field-label" for="share-url">页面链接</label>' +
    '<input id="share-url" type="text" readonly value="' + esc(url) + '">' +
    '<button type="button" class="primary wide" data-action="copy-link">复制链接</button>'
  );
}

function addLinkBody() {
  return (
    "<p>保存一条链接到你的收藏；内容只保存在你的账户里，不会进入公共新闻池。</p>" +
    '<form id="add-form"><label class="field-label" for="add-url">网址</label>' +
    '<input id="add-url" type="url" required placeholder="https://">' +
    '<label class="field-label" for="add-excerpt" style="margin-top:12px">摘录（可选）</label>' +
    '<textarea id="add-excerpt" rows="3" placeholder="粘贴原文中的内容"></textarea>' +
    '<p id="add-error" class="form-error" hidden></p>' +
    '<button class="primary wide" type="submit">保存到收藏</button></form>'
  );
}

function moreBody(id) {
  return (
    '<div class="sheet-menu">' +
    '<button type="button" data-action="hide-story" data-id="' + esc(id) + '">隐藏这条</button>' +
    '<button type="button" data-action="dislike-story" data-id="' + esc(id) + '">不感兴趣</button>' +
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
      case "theme": {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        localStorage.setItem("aquasight-theme", next);
        bootTheme();
        break;
      }
      case "settings":
        closeDialog();
        openDialog("阅读设置", settingsBody());
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
      case "clear-cache":
        await purgeUserCaches();
        if (navigator.serviceWorker) {
          const regs = await navigator.serviceWorker.getRegistrations();
          for (const r of regs) await r.update();
        }
        toast("已清除页面缓存，收藏和偏好仍保留");
        closeDialog();
        break;
      case "reset-data":
        if (!confirm("清除这台设备上的收藏、屏蔽和已读记录？此操作不能恢复。")) return;
        localStorage.removeItem("aquasight-reads");
        localStorage.removeItem("aquasight-saved");
        localStorage.removeItem("aquasight-hidden");
        localStorage.removeItem("aquasight-prefs");
        state.reads = {};
        favorites.reset();
        state.hiddenIds = new Set();
        state.prefs = {};
        syncSavedState();
        toast("已重置本机收藏和偏好");
        closeDialog();
        if (state.view !== "event") loadList(true);
        break;
      case "login":
        closeDialog();
        openDialog("把收藏带到另一台设备", state.user ? accountBody() : loginStepBody());
        if (!state.user) document.getElementById("login-email")?.focus();
        break;
      case "logout":
        await performLogout("/api/v1/auth/logout", "已退出");
        break;
      case "logout-all":
        await performLogout("/api/v1/auth/logout-all", "已退出所有设备");
        break;
      case "delete-account":
        if (!confirm("注销后账户数据会删除，且不能恢复。")) return;
        try {
          await api("/api/v1/me", { method: "DELETE" });
        } catch {
          toast("注销失败");
          return;
        }
        localStorage.removeItem("aquasight-token");
        await onAuthChanged();
        closeDialog();
        toast("账户已注销");
        break;
      case "search":
        openDialog("搜索新闻", searchBody());
        document.getElementById("search-input")?.focus();
        break;
      case "filter":
        openDialog("筛选新闻", filterBody());
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
        openDialog("分享这篇内容", shareBody(id, itemFor(id)));
        break;
      case "copy-link": {
        const input = document.getElementById("share-url");
        try {
          await navigator.clipboard.writeText(input.value);
          toast("链接已复制");
        } catch {
          input.select();
          toast("请复制已选中的链接");
        }
        break;
      }
      case "more":
        openDialog("更多操作", moreBody(id));
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
        toast(state.feed === "error" ? "刷新失败，请稍后重试" : "已重新加载");
        break;
      default:
        break;
    }
  });
}

async function saveSettings() {
  const note = document.getElementById("settings-save-note");
  const toggles = [...document.querySelectorAll("[data-source-toggle]")];
  const blockedSources = toggles.filter((el) => !el.checked).map((el) => el.value);
  state.prefs = { ...state.prefs, blockedSources };
  persistPrefs();
  if (state.view !== "event") renderList();
  let message = "已保存";
  try {
    await api("/api/v1/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockedSources }),
    });
  } catch (err) {
    message = err.status === 404 ? "已保存到本机" : "已保存到本机，未能同步";
  }
  toast(message);
  if (note) {
    note.hidden = false;
    note.textContent = message;
    note.classList.remove("form-error");
  }
}

function startResendCountdown() {
  const el = () => document.getElementById("resend-countdown");
  if (!el()) return;
  let left = 60;
  if (loginResendTimer) clearInterval(loginResendTimer);
  const tick = () => {
    const node = el();
    if (!node) { clearInterval(loginResendTimer); loginResendTimer = null; return; }
    if (left > 0) {
      node.textContent = "重新发送（" + left + " 秒）";
      left -= 1;
    } else {
      node.textContent = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "login-resend";
      btn.textContent = "重新发送验证码";
      node.replaceWith(btn);
      btn.addEventListener("click", () => sendCode());
      clearInterval(loginResendTimer);
      loginResendTimer = null;
    }
  };
  tick();
  loginResendTimer = setInterval(tick, 1000);
}

async function sendCode() {
  const email = document.getElementById("login-email")?.value.trim();
  const errEl = document.getElementById("login-error");
  const btn = document.getElementById("login-send");
  if (!email) return;
  if (btn) btn.disabled = true;
  try {
    const data = await api("/api/v1/auth/request-code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (data.delivery === "unavailable") {
      if (errEl) { errEl.hidden = false; errEl.textContent = "邮件服务暂时不可用，请稍后再试。"; }
      if (btn) btn.disabled = false;
      return;
    }
    state.loginEmail = email;
    openDialog("查看你的邮箱", loginCodeBody(email));
    document.getElementById("login-code")?.focus();
    startResendCountdown();
  } catch {
    if (errEl) { errEl.hidden = false; errEl.textContent = "暂时发不出验证码，请稍后再试。"; }
    if (btn) btn.disabled = false;
  }
}

async function verifyLogin() {
  const email = state.loginEmail || document.getElementById("login-email")?.value.trim();
  const code = document.getElementById("login-code")?.value.trim();
  const errEl = document.getElementById("code-error");
  const btn = document.getElementById("login-verify");
  if (!code) return;
  if (btn) btn.disabled = true;
  try {
    await api("/api/v1/auth/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, code }),
    });
    state.loginEmail = "";
    await onAuthChanged();
    await mergeGuest();
    closeDialog();
    toast("已登录");
    loadList(true);
  } catch {
    if (errEl) { errEl.hidden = false; errEl.textContent = "验证码无效或已过期。"; }
    if (btn) btn.disabled = false;
  }
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
    await api("/api/v1/sync/merge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    toast("登录成功，本机数据未能自动合并");
  }
}

function bindDialogForms() {
  document.addEventListener("submit", async (e) => {
    if (e.target.id === "login-form") {
      e.preventDefault();
      sendCode();
    } else if (e.target.id === "code-form") {
      e.preventDefault();
      verifyLogin();
    } else if (e.target.id === "search-form") {
      e.preventDefault();
      const q = document.getElementById("search-input").value.trim();
      state.q = q;
      closeDialog();
      if (state.view === "event" || state.view === "saved" || state.view === "review") location.hash = "#/featured";
      else loadList(true);
    } else if (e.target.id === "add-form") {
      e.preventDefault();
      const url = document.getElementById("add-url").value.trim();
      const excerpt = document.getElementById("add-excerpt").value.trim();
      const errEl = document.getElementById("add-error");
      if (!url) return;
      const btn = e.target.querySelector("button[type=submit]");
      if (btn) btn.disabled = true;
      try {
        await api("/api/v1/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, excerpt }),
        });
        closeDialog();
        toast("已保存到收藏");
        if (state.view === "saved") loadList(true);
        else await loadSaved().catch(() => {});
      } catch (err) {
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = err.status === 401 ? "登录后才能添加链接。" : "这个链接暂时保存不了。";
        }
        if (btn) btn.disabled = false;
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
        .filter((it) => [it.title, it.titleZh, it.overviewZh, it.summary, it.source].join(" ").toLowerCase().includes(q))
        .slice(0, 6);
      box.innerHTML = hits.length
        ? hits.map((it) =>
          '<a class="search-result" href="#/event/' + encodeURIComponent(it.id) + '">' +
          esc(displayTitle(it)) + "<small>" + esc(sourceLabel(it.source)) + " · " + esc(topicLabel(it)) + "</small></a>"
        ).join("")
        : '<p>没有找到相关内容，换个关键词试试。</p>';
    }
  });
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a.search-result");
    if (link) closeDialog();
  });
}

function loadListFiltersClear() {
  state.q = state.topic = state.source = "";
  state.unreadOnly = false;
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
  document.getElementById("main").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const card = btn.closest("[data-id]") || btn;
    const id = btn.getAttribute("data-id") || card.getAttribute("data-id");
    if (btn.dataset.act === "clear-filters") { loadListFiltersClear(); return; }
    if (btn.dataset.act === "login") {
      e.preventDefault();
      openDialog("把收藏带到另一台设备", state.user ? accountBody() : loginStepBody());
      if (!state.user) document.getElementById("login-email")?.focus();
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !modal().open && document.activeElement && !document.activeElement.matches("input, textarea, select, [contenteditable=true]")) {
      e.preventDefault();
      openDialog("搜索新闻", searchBody());
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
  btn.textContent = "添加链接 ＋";
  btn.addEventListener("click", () => openDialog("添加一条链接", addLinkBody()));
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
loadReads().then(() => loadSaved().catch(() => {})).then(() => {
  void favorites.sync();
  return refreshMe();
}).then(() => route());
registerSw();
