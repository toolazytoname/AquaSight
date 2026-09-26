import { isValidCalendarDate } from "./time.js";

export async function loadRemotePrefs(opts = {}) {
  const ingestUrl = opts.ingestUrl || process.env.INGEST_URL || "";
  const token = opts.token || process.env.INGEST_TOKEN || "";
  const base =
    opts.apiBase ||
    process.env.API_BASE_URL ||
    String(ingestUrl).replace(/\/api\/v1\/ingest\/?$/, "");
  if (!base || !token) return null;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(String(base).replace(/\/$/, "") + "/api/v1/settings", {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  if (!res || !res.ok) return null;
  const data = await res.json();
  return data.prefs || null;
}

/**
 * Read-only fetch of a previously published digest from the Worker. Used as
 * the cross-day dedup history fallback when the local Actions cache was
 * evicted, and as the same-day "already published" guard. The endpoint is
 * public, so no credential is sent (and none is required).
 *
 * Throws on transport/HTTP errors and on shape/date mismatches so the caller
 * fails closed instead of silently treating history as empty; returns null
 * when the Worker simply has no digest for that date.
 */
export async function fetchRemoteDigest(opts = {}) {
  const date = String(opts.date || "").trim();
  if (!isValidCalendarDate(date)) throw new Error("invalid digest date: " + date);
  const ingestUrl = opts.ingestUrl || process.env.INGEST_URL || "";
  const base =
    opts.apiBase ||
    process.env.API_BASE_URL ||
    String(ingestUrl).replace(/\/api\/v1\/ingest\/?$/, "");
  if (!base) return null;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(String(base).replace(/\/$/, "") + "/api/v1/digest?date=" + date, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(opts.timeoutMs ?? 10000),
  });
  if (!res || !res.ok) {
    throw new Error("remote digest " + date + " fetch failed: http-" + (res && res.status));
  }
  const data = await res.json();
  const digest = data && data.digest;
  if (!digest || digest.date !== date || !Array.isArray(digest.items)) {
    throw new Error("remote digest " + date + " shape mismatch");
  }
  return digest.missing === true ? null : digest;
}
