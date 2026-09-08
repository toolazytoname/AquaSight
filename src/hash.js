import { createHash } from "node:crypto";

const TRACKING_RE = /^(utm_|spm$|f$|from$|ref$|fbclid$|gclid$)/i;

export function sha256Hex(s) {
  return createHash("sha256").update(String(s || ""), "utf8").digest("hex");
}

export function shortHash(s, n = 20) {
  return sha256Hex(s).slice(0, n);
}

export function canonicalizeUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return raw;
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const drop = [];
    for (const key of u.searchParams.keys()) {
      if (TRACKING_RE.test(key)) drop.push(key);
    }
    for (const key of drop) u.searchParams.delete(key);
    u.searchParams.sort();
    let path = u.pathname.replace(/\/+$/, "") || "/";
    const search = u.searchParams.toString();
    return u.protocol + "//" + u.host + path + (search ? "?" + search : "");
  } catch {
    return raw;
  }
}
