// 个人链接 URL 规范化 —— 与 iOS PersonalLink（Models.swift）逐字节一致的
// 手写实现，不依赖平台 URL 解析器。共享向量见 tests/personal-library.test.js
// 与 clients/ios/AquaSightTests/LocalStoreTests.swift。
// 规范化串仅用于稳定去重 id（"pl-" + sha256 前 24 hex）；打开原文时保存并
// 使用用户输入的原始安全 URL。

export const URL_UNRESERVED = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~");
export const URL_HOST_SAFE = new Set("abcdefghijklmnopqrstuvwxyz0123456789.-");
export const URL_QUERY_SAFE = new Set([...URL_UNRESERVED, ..."&=+;,:$!*'()/?@"]);

export function percentEncodeUrlPart(str, keep) {
  let out = "";
  const chars = Array.from(str);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === "%" && i + 2 < chars.length && /^[0-9a-fA-F]{2}$/.test(chars.slice(i + 1, i + 3).join(""))) {
      out += "%" + chars.slice(i + 1, i + 3).join("").toUpperCase();
      i += 2;
      continue;
    }
    if (keep.has(c)) { out += c; continue; }
    for (const byte of new TextEncoder().encode(c)) out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function normalizePathSegments(raw) {
  let segs = raw.split("/");
  if (segs[0] === "") segs = segs.slice(1);
  if (segs.length && segs[segs.length - 1] === "") segs = segs.slice(0, -1);
  const out = [];
  for (const seg of segs) {
    if (seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(percentEncodeUrlPart(seg, URL_UNRESERVED));
  }
  return out.length ? "/" + out.join("/") : "";
}

export function normalizePersonalUrl(raw) {
  const s = String(raw || "").trim();
  const sep = s.indexOf("://");
  if (sep < 0) return null;
  const scheme = s.slice(0, sep).toLowerCase();
  if (scheme !== "http" && scheme !== "https") return null;
  const after = s.slice(sep + 3);
  let stop = after.length;
  for (let i = 0; i < after.length; i++) {
    if (after[i] === "/" || after[i] === "?" || after[i] === "#") { stop = i; break; }
  }
  const authority = after.slice(0, stop);
  if (!authority || authority.includes("@") || authority.includes("#") || authority.includes("/")) return null;
  const tail = after.slice(stop);
  let rawPath = "", rawQuery = null;
  if (tail.startsWith("#")) {
    // fragment only: no path/query
  } else if (tail.startsWith("?")) {
    rawQuery = tail.slice(1).split("#")[0];
  } else {
    const noHash = tail.split("#")[0];
    const qIdx = noHash.indexOf("?");
    if (qIdx >= 0) {
      rawPath = noHash.slice(0, qIdx);
      rawQuery = noHash.slice(qIdx + 1);
    } else {
      rawPath = noHash;
    }
  }
  let hostPart = authority, port = null;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]");
    if (close < 0) return null;
    hostPart = authority.slice(0, close + 1);
    const restAuth = authority.slice(close + 1);
    if (restAuth) {
      if (!restAuth.startsWith(":") || !/^[0-9]+$/.test(restAuth.slice(1))) return null;
      port = restAuth.slice(1);
    }
  } else {
    const ci = authority.lastIndexOf(":");
    if (ci > 0) {
      const maybePort = authority.slice(ci + 1);
      if (maybePort && /^[0-9]+$/.test(maybePort)) {
        hostPart = authority.slice(0, ci);
        port = maybePort;
      }
    }
  }
  if (!hostPart) return null;
  let encodedHost;
  if (hostPart.startsWith("[") && hostPart.endsWith("]")) {
    if (!/^\[[0-9a-fA-F:.]+\]$/.test(hostPart)) return null;
    encodedHost = hostPart.toLowerCase();
  } else {
    encodedHost = percentEncodeUrlPart(hostPart.toLowerCase(), URL_HOST_SAFE);
  }
  let out = scheme + "://" + encodedHost;
  if (port !== null) {
    const isDefault = (scheme === "https" && port === "443") || (scheme === "http" && port === "80");
    if (!isDefault) {
      const n = Number(port);
      if (!Number.isInteger(n) || n <= 0 || n > 65535) return null;
      out += ":" + port;
    }
  }
  out += normalizePathSegments(rawPath);
  if (rawQuery) out += "?" + percentEncodeUrlPart(rawQuery, URL_QUERY_SAFE);
  return out;
}

export async function sha256Hex(text) {
  if (!globalThis.crypto?.subtle) {
    // No silent non-SHA fallback: a mismatched hash would fragment ids across
    // clients. Surface an explicit error instead.
    throw new Error("此环境不支持安全哈希（crypto.subtle）");
  }
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function personalLinkId(rawUrl) {
  const normalized = normalizePersonalUrl(rawUrl);
  if (!normalized) return { error: "网址需要是完整的 http(s) 链接" };
  try {
    return { id: "pl-" + (await sha256Hex(normalized)).slice(0, 24), normalized };
  } catch (err) {
    return { error: err.message || "此环境不支持安全哈希" };
  }
}
