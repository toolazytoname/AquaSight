/**
 * Shared immutable-content cache for store reads (D1/Worker layer).
 *
 * Scope rules (deliberately strict):
 * - Only shared public content may be cached: event JSON, reader metadata,
 *   event members, content snapshots, counts and curated ID projections.
 *   Keys are derived exclusively from public content identifiers — never
 *   from prefs, reads, favorites, feedback, auth or any user-scoped data.
 * - TTL bounded (entries expire; 60s default) and memory bounded (LRU
 *   eviction by entry count and approximate total bytes).
 * - Values are cloned on every read AND when handed to concurrent callers,
 *   so a mutating consumer can never poison the cached copy.
 * - Concurrent misses for the same key share one loader call (dedupe).
 * - invalidate() detaches the entire in-flight map: a loader that started
 *   before the invalidation can neither write its (stale) result into the
 *   new generation nor delete a newer promise from the new in-flight map.
 * - Instances are keyed by the owning DB handle (WeakMap), so two different
 *   databases never observe each other's entries (no cross-DB leak).
 *
 * Freshness across Worker isolates: each isolate keeps its own instance, so
 * a reader may see up to ttlMs stale content after a write from another
 * isolate (or another machine). The write-path invalidation only guarantees
 * immediacy within the isolate that performed the mutation; the TTL is the
 * global bound and is intentionally short (60s).
 */

export const CONTENT_CACHE_TTL_MS = 60_000;
export const CONTENT_CACHE_MAX_ENTRIES = 500;
export const CONTENT_CACHE_MAX_BYTES = 4_000_000;

function cloneValue(value) {
  // Cached values are plain JSON (objects/arrays/strings/numbers/null).
  if (value == null) return value;
  if (typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return value;
    }
  }
}

function approxBytes(value) {
  try {
    const s = JSON.stringify(value);
    return typeof s === "string" ? s.length * 2 : Infinity;
  } catch {
    return Infinity;
  }
}

export function createContentCache(opts = {}) {
  const ttlMs = Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : CONTENT_CACHE_TTL_MS;
  const maxEntries =
    Number.isFinite(opts.maxEntries) && opts.maxEntries > 0 ? Math.floor(opts.maxEntries) : CONTENT_CACHE_MAX_ENTRIES;
  const maxBytes =
    Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : CONTENT_CACHE_MAX_BYTES;

  const now = typeof opts.now === "function" ? opts.now : Date.now;
  let entries = new Map(); // key -> { value, bytes, expiresAt }
  let inflight = new Map(); // key -> Promise resolving to the RAW loader value
  let epoch = 0;
  let totalBytes = 0;

  function evictToBounds() {
    while (entries.size > maxEntries || (totalBytes > maxBytes && entries.size > 0)) {
      const oldest = entries.keys().next().value;
      const hit = entries.get(oldest);
      entries.delete(oldest);
      if (hit) totalBytes -= hit.bytes;
    }
  }

  function getOrLoad(key, loader) {
    if (typeof loader !== "function") throw new Error("content cache requires a loader");
    const hit = entries.get(key);
    if (hit) {
      if (hit.expiresAt > now()) {
        // LRU refresh: re-insert at the tail.
        entries.delete(key);
        entries.set(key, hit);
        return Promise.resolve(cloneValue(hit.value));
      }
      entries.delete(key);
      totalBytes -= hit.bytes;
    }
    let p = inflight.get(key);
    if (!p) {
      const myInflight = inflight; // detach point: invalidate() swaps the map
      const startedAt = epoch;
      const raw = (async () => {
        try {
          return await loader();
        } finally {
          // Only the generation that registered this promise may remove it,
          // and only if it is still the registered promise.
          if (inflight === myInflight && myInflight.get(key) === p) myInflight.delete(key);
        }
      })();
      p = raw.then((value) => {
        if (epoch === startedAt) {
          const bytes = approxBytes(value);
          if (Number.isFinite(bytes) && bytes <= maxBytes) {
            entries.set(key, { value, bytes, expiresAt: now() + ttlMs });
            totalBytes += bytes;
            evictToBounds();
          }
          // Oversized values are returned but never cached.
        }
        return value;
      });
      myInflight.set(key, p);
    }
    // Clone per caller: concurrent sharers and cache hits never alias.
    return Promise.resolve(p).then(cloneValue);
  }

  return {
    kind: "content-cache",
    getOrLoad,
    invalidate() {
      epoch += 1;
      entries = new Map();
      totalBytes = 0;
      inflight = new Map(); // old loaders hold the previous map and cannot touch this one
    },
    get size() {
      return entries.size;
    },
    get bytes() {
      return totalBytes;
    },
  };
}

const byOwner = new WeakMap();

/// One cache per DB handle. Worker isolates reuse the same binding object, so
/// reads warm up across requests while a second database stays fully isolated.
export function contentCacheFor(owner, opts) {
  if (!owner || (typeof owner !== "object" && typeof owner !== "function")) {
    throw new Error("content cache owner must be an object");
  }
  let cache = byOwner.get(owner);
  if (!cache) {
    cache = createContentCache(opts);
    byOwner.set(owner, cache);
  }
  return cache;
}
