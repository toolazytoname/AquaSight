const CANDIDATES = [
  "./events.json",
  "../data/events.json",
  "/data/events.json",
];
const DIGEST_CANDIDATES = [
  "./digest.json",
  "../data/digest.json",
  "/data/digest.json",
];

function fallbackData() {
  const el = document.getElementById("fallback-events");
  if (!el) return { items: [], sourceErrors: [], updatedAt: "" };
  try {
    return JSON.parse(el.textContent);
  } catch {
    return { items: [], sourceErrors: [], updatedAt: "" };
  }
}

async function loadEvents() {
  for (const url of CANDIDATES) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && Array.isArray(data.items)) {
        return { data, from: url };
      }
    } catch {
      // file:// or missing path
    }
  }
  return { data: fallbackData(), from: "embedded" };
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function card(item) {
  const cls = item.level === "breaking" ? "card breaking" : "card";
  const href = esc(item.url || "#");
  const original = String(item.title || "");
  const display = String(item.titleZh || original || "(无标题)");
  const source = esc(item.source || "");
  const reason = esc(item.reason || "");
  const origLine =
    original && display !== original
      ? '<p class="orig">' + esc(original) + "</p>"
      : "";
  return (
    '<article class="' + cls + '">' +
      '<p class="title"><a href="' + href + '" target="_blank" rel="noreferrer">' + esc(display) + "</a></p>" +
      origLine +
      '<p class="meta-row">' + source + (reason ? " · " + reason : "") + "</p>" +
    "</article>"
  );
}

function renderList(el, items, emptyText) {
  if (!items.length) {
    el.innerHTML = '<p class="empty">' + emptyText + "</p>";
    return;
  }
  el.innerHTML = items.map(card).join("");
}

function render(data, from) {
  const items = Array.isArray(data.items) ? data.items : [];
  const breaking = items.filter((i) => i.level === "breaking");
  const normal = items.filter((i) => i.level !== "breaking");
  renderList(
    document.getElementById("breaking-list"),
    breaking,
    "暂无破圈事件。有的话会顶在这里。"
  );
  renderList(
    document.getElementById("normal-list"),
    normal,
    "暂无一般事件。采集之后会出现在这里。"
  );
  const when = data.updatedAt ? new Date(data.updatedAt).toLocaleString() : "未知时间";
  const err = Array.isArray(data.sourceErrors) ? data.sourceErrors.length : 0;
  document.getElementById("meta").textContent =
    "更新于 " + when + " · " + items.length + " 条 · 源 " + from +
    (err ? " · " + err + " 个源失败" : "");
}

function digestLine(it) {
  const href = esc(it.url || "#");
  const display = esc(it.titleZh || it.title || "(无标题)");
  return '<li><a href="' + href + '" target="_blank" rel="noreferrer">' + display + "</a></li>";
}

function renderDigestBucket(el, items, emptyText) {
  if (!el) return;
  if (!items.length) {
    el.innerHTML = '<p class="empty">' + emptyText + "</p>";
    return;
  }
  el.innerHTML = "<ol>" + items.map(digestLine).join("") + "</ol>";
}

function renderDigest(digest) {
  const pane = document.getElementById("digest-pane");
  if (!pane) return;
  if (!digest) {
    renderDigestBucket(document.getElementById("digest-tech"), [], "暂无科技。");
    renderDigestBucket(document.getElementById("digest-hot"), [], "暂无热搜。");
    renderDigestBucket(document.getElementById("digest-other"), [], "暂无其它。");
    return;
  }
  const label = document.getElementById("digest-title");
  if (label && digest.date) label.textContent = "今日早报 · " + digest.date;
  renderDigestBucket(document.getElementById("digest-tech"), digest.tech || [], "暂无科技。");
  renderDigestBucket(document.getElementById("digest-hot"), digest.hot || [], "暂无热搜。");
  renderDigestBucket(document.getElementById("digest-other"), digest.other || [], "暂无其它。");
}

async function loadDigest() {
  for (const url of DIGEST_CANDIDATES) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && (data.tech || data.hot || data.other)) return data;
    } catch {
      // missing
    }
  }
  return null;
}

Promise.all([loadEvents(), loadDigest()]).then(([{ data, from }, digest]) => {
  render(data, from);
  renderDigest(digest);
});
