const PRIVATE_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.google.com",
]);

function ipv4ToInt(s) {
  const p = String(s || "").split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function inRange(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const n = ipv4ToInt(ip);
  const b = ipv4ToInt(base);
  if (n == null || b == null) return false;
  const mask = bits === "0" ? 0 : (~((1 << (32 - Number(bits))) - 1)) >>> 0;
  return (n & mask) === (b & mask);
}

const V4_BLOCKS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
];

export function mappedIpv4(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  const dotted = h.match(/ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dotted) return dotted[1];
  const hex = h.match(/ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return [(a >> 8) & 255, a & 255, (b >> 8) & 255, b & 255].join(".");
  }
  return "";
}

export function isPrivateIpv4(ip) {
  if (ipv4ToInt(ip) == null) return false;
  return V4_BLOCKS.some((c) => inRange(ip, c));
}

export function isPrivateIpv6(raw) {
  const h = String(raw || "")
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!h.includes(":")) return false;
  const mapped = mappedIpv4(h);
  if (mapped) return isPrivateIpv4(mapped);
  if (h === "::1" || h === "0:0:0:0:0:0:0:1") return true;
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80") || h.startsWith("ff")) {
    return true;
  }
  return false;
}

export function isPrivateAddress(addr) {
  const a = String(addr || "").replace(/^\[|\]$/g, "");
  if (isPrivateIpv4(a)) return true;
  if (a.includes(":")) return isPrivateIpv6(a);
  return false;
}

export function isPrivateHostname(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (PRIVATE_HOSTS.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  if (h === "0") return true;
  if (isPrivateAddress(h)) return true;
  return false;
}

export async function resolveAddresses(hostname, opts = {}) {
  const host = String(hostname || "").replace(/^\[|\]$/g, "");
  if (isPrivateAddress(host) || ipv4ToInt(host) != null || host.includes(":")) {
    return [host];
  }
  if (opts.lookupImpl) {
    const found = await opts.lookupImpl(host);
    return (found || []).map((row) => (typeof row === "string" ? row : row.address)).filter(Boolean);
  }
  try {
    const dns = await import("node:dns/promises");
    const all = await dns.lookup(host, { all: true, verbatim: true });
    return (all || []).map((row) => row.address).filter(Boolean);
  } catch {
    if (opts.fetchImpl || typeof fetch === "function") {
      const fetchImpl = opts.fetchImpl || fetch;
      const doh =
        "https://cloudflare-dns.com/dns-query?name=" +
        encodeURIComponent(host) +
        "&type=A";
      const res = await fetchImpl(doh, { headers: { Accept: "application/dns-json" } });
      const data = await res.json();
      const answers = Array.isArray(data.Answer) ? data.Answer : [];
      return answers.map((a) => a.data).filter(Boolean);
    }
  }
  return [];
}

// Server-side ceilings: a client may ask for less, never for more.
export const HARD_MAX_BYTES = 2_000_000;
export const HARD_TIMEOUT_MS = 15_000;
export const HARD_MAX_REDIRECTS = 3;

function isTextualContentType(ct) {
  const m = /^([^/]+)\/([^;]+)/i.exec(String(ct || "").trim());
  if (!m) return true; // absent or malformed header: do not reject on a technicality
  const type = m[1].toLowerCase();
  const sub = m[2].toLowerCase();
  if (type === "text") return true;
  return /json|xml|html/.test(sub);
}

export async function assertSafeImportUrl(url, opts = {}) {
  const maxBytes = Math.min(Math.max(1, opts.maxBytes ?? 500_000), HARD_MAX_BYTES);
  const timeoutMs = Math.min(Math.max(500, opts.timeoutMs ?? 8000), HARD_TIMEOUT_MS);
  const maxRedirects = Math.min(Math.max(0, opts.maxRedirects ?? HARD_MAX_REDIRECTS), HARD_MAX_REDIRECTS);
  let u;
  try {
    u = new URL(String(url || ""));
  } catch {
    const err = new Error("invalid url");
    err.code = "IMPORT_URL";
    throw err;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    const err = new Error("protocol not allowed");
    err.code = "IMPORT_PROTOCOL";
    throw err;
  }
  if (isPrivateHostname(u.hostname)) {
    const err = new Error("target not allowed");
    err.code = "IMPORT_PRIVATE";
    throw err;
  }
  const addrs = await resolveAddresses(u.hostname, opts);
  if (!addrs.length) {
    const err = new Error("dns failed");
    err.code = "IMPORT_DNS";
    throw err;
  }
  for (const addr of addrs) {
    if (isPrivateAddress(addr) || isPrivateHostname(addr)) {
      const err = new Error("resolved private target");
      err.code = "IMPORT_PRIVATE";
      throw err;
    }
  }
  return { url: u.toString(), maxBytes, timeoutMs, maxRedirects, hostname: u.hostname, addrs };
}

function importError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function readCappedText(res, maxBytes) {
  // Stream-read and stop as soon as the byte cap is exceeded; res.text() would
  // buffer the whole body first and could exhaust memory before the check.
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (text.length > maxBytes) throw importError("too large", "IMPORT_SIZE");
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw importError("too large", "IMPORT_SIZE");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (text.length > maxBytes) throw importError("too large", "IMPORT_SIZE");
  return text;
}

export async function fetchImported(url, opts = {}) {
  const spec = await assertSafeImportUrl(url, opts);
  const fetchImpl = opts.fetchImpl || fetch;
  // One deadline across every redirect hop, not per request.
  const startedAt = opts._startedAt || Date.now();
  const remaining = () => spec.timeoutMs - (Date.now() - startedAt);
  if (remaining() <= 0) throw importError("import deadline exceeded", "IMPORT_TIMEOUT");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.min(spec.timeoutMs, remaining()));
  try {
    const res = await fetchImpl(spec.url, {
      signal: ctrl.signal,
      redirect: "manual",
      headers: { "User-Agent": "AquaSight-import/0.2" },
    });
    const status = res.status;
    if ([301, 302, 303, 307, 308].includes(status)) {
      const loc = res.headers && res.headers.get ? res.headers.get("location") : "";
      const hops = (opts._hops || 0) + 1;
      if (hops > spec.maxRedirects) {
        throw importError("too many redirects", "IMPORT_REDIRECT");
      }
      if (!loc) {
        throw importError("redirect without location", "IMPORT_REDIRECT");
      }
      const next = new URL(loc, spec.url).toString();
      return fetchImported(next, { ...opts, _hops: hops, _startedAt: startedAt });
    }
    if (!res.ok) {
      throw importError("HTTP " + status, "IMPORT_HTTP");
    }
    const contentType = String(res.headers?.get?.("content-type") || "").trim();
    if (contentType && !isTextualContentType(contentType)) {
      throw importError("unsupported content type: " + contentType.split(";")[0], "IMPORT_CONTENT_TYPE");
    }
    const text = await readCappedText(res, spec.maxBytes);
    return { url: spec.url, text, contentType };
  } finally {
    clearTimeout(t);
  }
}
