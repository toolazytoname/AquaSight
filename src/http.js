const DEFAULT_UA =
  "AquaSight/0.1 (+https://github.com/toolazytoname/AquaSight)";

export async function getText(url, { headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": DEFAULT_UA, ...headers },
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error("HTTP " + res.status + " " + url);
    }
    return { text, contentType: res.headers.get("content-type") || "" };
  } finally {
    clearTimeout(t);
  }
}

export async function getJson(url, opts) {
  const { text, contentType } = await getText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("not json (" + contentType + ") " + url);
  }
}

export function makeId(source, key) {
  return source + ":" + String(key || "").slice(0, 80);
}
