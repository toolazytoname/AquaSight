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
  let h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  try { h = new URL("http://[" + h + "]/").hostname.replace(/^\[|\]$/g, ""); }
  catch { return ""; }
  // Only ::ffff:0:0/96 is mapped IPv4. A suffix such as fd00::ffff:808:808
  // is still private IPv6; interpreting its last words as public v4 bypasses
  // the ULA/link-local checks below.
  const hex = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
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
  const h = String(raw || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h.includes(":")) return false;
  const mapped = mappedIpv4(h);
  if (mapped) return isPrivateIpv4(mapped);
  // Fail closed outside global unicast. This also excludes unspecified,
  // link/site-local, NAT64 and IPv4-compatible transition addresses.
  const first = parseInt(h.split(":")[0] || "0", 16);
  if (first < 0x2000 || first > 0x3fff) return true;
  // Documentation, Teredo and 6to4 can encode non-public IPv4 destinations.
  if (/^2001:(?:0*:|0*db8:)/.test(h) || /^2002:/.test(h)) return true;
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

function isIpAddress(value) {
  if (typeof value !== "string") return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return ipv4ToInt(value) != null;
  if (!value.includes(":")) return false;
  try { return new URL("http://[" + value + "]/").hostname.startsWith("["); }
  catch { return false; }
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
    const lookup = opts.dnsLookupImpl || (await import("node:dns/promises")).lookup;
    const all = await lookup(host, { all: true, verbatim: true });
    // Some Workers node:dns compatibility shims include CNAME targets in
    // lookup() address rows. Never treat a hostname as a validated IP, or
    // simply drop malformed rows (which could conceal an unsafe answer).
    // Resolve both families through typed DoH records instead.
    if (!Array.isArray(all) || all.some((row) => !isIpAddress(row?.address))) {
      throw importError("invalid native DNS addresses", "IMPORT_DNS");
    }
    return all.map((row) => row.address);
  } catch {
    if (opts.fetchImpl || typeof fetch === "function") {
      const fetchImpl = opts.dnsFetchImpl || fetch;
      // Check BOTH address families. CNAME records are not addresses and
      // must never be mistaken for evidence that a host is publicly routable.
      const answers = await Promise.all(["A", "AAAA"].map(async (type) => {
        const doh = "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type;
        const res = await fetchImpl(doh, { headers: { Accept: "application/dns-json" }, signal: opts.signal });
        if (!res.ok) throw importError("dns failed", "IMPORT_DNS");
        const data = await res.json();
        if (data.Status !== 0) throw importError("dns failed", "IMPORT_DNS");
        return (Array.isArray(data.Answer) ? data.Answer : [])
          .filter((a) => a.type === 1 || a.type === 28).map((a) => a.data);
      }));
      return answers.flat();
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
  const maxBytes = boundedNumber(opts.maxBytes, 500_000, 1, HARD_MAX_BYTES);
  const timeoutMs = boundedNumber(opts.timeoutMs, 8000, 500, HARD_TIMEOUT_MS);
  const maxRedirects = boundedNumber(opts.maxRedirects, HARD_MAX_REDIRECTS, 0, HARD_MAX_REDIRECTS);
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
  // 嵌入凭据（user:pass@host）一律拒绝：不应被代理转发或入库。
  if (u.username || u.password) {
    const err = new Error("url contains embedded credentials");
    err.code = "IMPORT_URL";
    throw err;
  }
  if (isPrivateHostname(u.hostname)) {
    const err = new Error("target not allowed");
    err.code = "IMPORT_PRIVATE";
    throw err;
  }
  const timeout = timeoutMs - (Date.now() - (opts._startedAt ?? Date.now()));
  const addrs = await withDeadline((signal) => resolveAddresses(u.hostname, { ...opts, signal }), timeout);
  if (!addrs.length) {
    const err = new Error("dns failed");
    err.code = "IMPORT_DNS";
    throw err;
  }
  for (const addr of addrs) {
    if (!isIpAddress(addr) || isPrivateAddress(addr) || isPrivateHostname(addr)) {
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

async function readCappedText(res, maxBytes, signal) {
  if (!res.body || typeof res.body.getReader !== "function") {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw importError("too large", "IMPORT_SIZE");
    return text;
  }
  const reader = res.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let received = 0;
  let text = "";
  try {
    if (signal.aborted) throw importError("import deadline exceeded", "IMPORT_TIMEOUT");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        cancel();
        throw importError("too large", "IMPORT_SIZE");
      }
      text += decoder.decode(value, { stream: true });
    }
    if (signal.aborted) throw importError("import deadline exceeded", "IMPORT_TIMEOUT");
    return text + decoder.decode();
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function boundedNumber(value, fallback, min, max) {
  const number = value == null ? fallback : Number(value);
  return Number.isFinite(number) ? Math.floor(Math.min(max, Math.max(min, number))) : fallback;
}

async function withDeadline(run, ms) {
  if (ms <= 0) throw importError("import deadline exceeded", "IMPORT_TIMEOUT");
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(importError("import deadline exceeded", "IMPORT_TIMEOUT"));
      ctrl.abort();
    }, ms);
  });
  try { return await Promise.race([run(ctrl.signal), timeout]); }
  finally { clearTimeout(timer); }
}

export async function fetchImported(url, opts = {}) {
  // The deadline begins BEFORE DNS and is shared by every redirect and body.
  const startedAt = opts._startedAt ?? Date.now();
  const spec = await assertSafeImportUrl(url, { ...opts, _startedAt: startedAt });
  const fetchImpl = opts.fetchImpl || fetch;
  return withDeadline(async (signal) => {
    const res = await fetchImpl(spec.url, {
      signal,
      redirect: "manual",
      // The local Node adapter pins the connection to these checked addresses.
      validatedAddresses: spec.addrs,
      headers: { "User-Agent": opts.userAgent || "AquaSight-import/0.2" },
    });
    let consumed = false;
    try {
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers?.get?.("location");
        const hops = (opts._hops || 0) + 1;
        if (hops > spec.maxRedirects) throw importError("too many redirects", "IMPORT_REDIRECT");
        if (!loc) throw importError("redirect without location", "IMPORT_REDIRECT");
        const next = new URL(loc, spec.url).toString();
        return fetchImported(next, { ...opts, _hops: hops, _startedAt: startedAt });
      }
      if (!res.ok) throw importError("HTTP " + res.status, "IMPORT_HTTP");
      const contentType = String(res.headers?.get?.("content-type") || "").trim();
      if (contentType && !isTextualContentType(contentType)) {
        throw importError("unsupported content type: " + contentType.split(";")[0], "IMPORT_CONTENT_TYPE");
      }
      const text = await readCappedText(res, spec.maxBytes, signal);
      consumed = true;
      return { url: spec.url, text, contentType };
    } finally {
      if (!consumed && res.body && !res.body.locked) void res.body.cancel().catch(() => {});
    }
  }, spec.timeoutMs - (Date.now() - startedAt));
}
