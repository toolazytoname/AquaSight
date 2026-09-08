import { articleId } from "./identity.js";
import { stripHtml } from "./html.js";

const X_HOST = /^(www\.)?(x\.com|twitter\.com)$/i;
const X_STATUS = /^\/[A-Za-z0-9_]+\/status\/(\d+)/;

export function isXUrl(url) {
  try {
    const u = new URL(String(url || ""));
    return X_HOST.test(u.hostname) && X_STATUS.test(u.pathname);
  } catch {
    return false;
  }
}

export function parseXUrl(url) {
  try {
    const u = new URL(String(url || ""));
    if (!X_HOST.test(u.hostname)) return null;
    const m = u.pathname.match(X_STATUS);
    if (!m) return null;
    return {
      url: "https://x.com" + u.pathname.replace(/\/+$/, ""),
      statusId: m[1],
      handle: u.pathname.split("/").filter(Boolean)[0],
    };
  } catch {
    return null;
  }
}

export function extractXUrls(text) {
  const found = [];
  const re = /https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+[^\s)"]*/gi;
  const s = String(text || "");
  let m;
  while ((m = re.exec(s))) {
    const parsed = parseXUrl(m[0]);
    if (parsed) found.push(parsed.url);
  }
  return [...new Set(found)];
}

export function fromHnCitation(item) {
  const parsed = parseXUrl(item?.url);
  if (!parsed) return null;
  const article = {
    title: item.title || ("X post " + parsed.statusId),
    url: parsed.url,
    source: "x",
    role: "social",
    provenance: {
      kind: "hn-citation",
      hnId: item.externalId || item.id,
      hnUrl: item.discussionUrl || item.url,
    },
    summary: item.summary || "",
    publishedAt: item.publishedAt,
  };
  article.externalId = parsed.statusId;
  article.id = articleId(article);
  article.articleId = article.id;
  return article;
}

export function fromManualImport({ url, excerpt, title } = {}) {
  const parsed = parseXUrl(url);
  if (!parsed) {
    const err = new Error("not an X status url");
    err.code = "X_URL";
    throw err;
  }
  const article = {
    title: title || ("X @" + parsed.handle + " " + parsed.statusId),
    url: parsed.url,
    source: "x",
    role: "social",
    provenance: { kind: "manual-import" },
    summary: stripHtml(excerpt || ""),
    externalId: parsed.statusId,
  };
  article.id = articleId(article);
  article.articleId = article.id;
  return article;
}

export function xSubscriptionStatus(env = process.env) {
  const token = env.X_BEARER_TOKEN || env.X_API_BEARER || "";
  return {
    connected: Boolean(token),
    adapter: "account-subscribe",
    reason: token ? "ready" : "no-credential",
  };
}

export async function fetchSubscribedAccount() {
  const st = xSubscriptionStatus();
  if (!st.connected) {
    const err = new Error("X 未接通");
    err.code = "X_DISCONNECTED";
    throw err;
  }
  const err = new Error("account subscribe adapter reserved; no extra X data fetch");
  err.code = "X_ADAPTER_ONLY";
  throw err;
}
