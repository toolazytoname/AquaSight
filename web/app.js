const CANDIDATES = [
  "../data/events.json",
  "./events.json",
  "/data/events.json",
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
  const title = esc(item.title || "(无标题)");
  const source = esc(item.source || "");
  const reason = esc(item.reason || "");
  return (
    '<article class="' + cls + '">' +
      '<p class="title"><a href="' + href + '" target="_blank" rel="noreferrer">' + title + "</a></p>" +
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

loadEvents().then(({ data, from }) => render(data, from));
