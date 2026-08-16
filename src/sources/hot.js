import { getJson, makeId } from "../http.js";

const BROWSER = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://weibo.com/",
};

const TOUTIAO_URL =
  "https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc";

function weiboUrl(word) {
  return (
    "https://s.weibo.com/weibo?q=" + encodeURIComponent(word)
  );
}

export async function fetchWeibo() {
  const data = await getJson("https://weibo.com/ajax/side/hotSearch", {
    headers: BROWSER,
  });
  const list = data && data.data && Array.isArray(data.data.realtime)
    ? data.data.realtime
    : [];
  const items = [];
  for (let i = 0; i < list.length && items.length < 20; i++) {
    const row = list[i];
    const title = String(row.word || row.note || "").trim();
    if (!title) continue;
    const rank = Number.isFinite(row.realpos)
      ? row.realpos
      : Number.isFinite(row.rank)
        ? row.rank + 1
        : i + 1;
    items.push({
      id: makeId("weibo", title),
      title,
      url: weiboUrl(title),
      source: "weibo",
      rank,
    });
  }
  if (!items.length) throw new Error("weibo empty");
  return items;
}

export async function fetchBaidu() {
  const data = await getJson("https://top.baidu.com/api/board?tab=realtime", {
    headers: {
      "User-Agent": BROWSER["User-Agent"],
      Referer: "https://top.baidu.com/board?tab=realtime",
    },
  });
  const cards = data && data.data && Array.isArray(data.data.cards)
    ? data.data.cards
    : [];
  const content = [];
  for (const c of cards) {
    if (Array.isArray(c.content)) content.push(...c.content);
  }
  const items = [];
  for (let i = 0; i < content.length && items.length < 20; i++) {
    const row = content[i];
    const title = String(row.word || row.query || "").trim();
    const url = row.rawUrl || row.url || "";
    if (!title || !url) continue;
    const item = {
      id: makeId("baidu", title),
      title,
      url,
      source: "baidu",
      rank: Number.isFinite(row.index) ? row.index + 1 : i + 1,
    };
    const summary = String(row.desc || row.hotDesc || "").trim();
    if (summary) item.summary = summary;
    items.push(item);
  }
  if (!items.length) throw new Error("baidu empty");
  return items;
}

export async function fetchToutiao() {
  const data = await getJson(TOUTIAO_URL, {
    headers: {
      "User-Agent": BROWSER["User-Agent"],
      Referer: "https://www.toutiao.com/",
    },
  });
  const list = Array.isArray(data && data.data) ? data.data : [];
  const items = [];
  for (let i = 0; i < list.length && items.length < 20; i++) {
    const row = list[i];
    const title = String(row.Title || row.QueryWord || "").trim();
    const url = String(row.Url || "").trim();
    if (!title || !url) continue;
    items.push({
      id: makeId("toutiao", row.ClusterIdStr || title),
      title,
      url,
      source: "toutiao",
      rank: i + 1,
    });
  }
  if (!items.length) throw new Error("toutiao empty");
  return items;
}
