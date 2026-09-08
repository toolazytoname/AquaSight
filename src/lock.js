const DEFAULT_MS = 15 * 60 * 1000;

export async function withLock(store, name, fn, opts = {}) {
  const ttl = opts.ttlMs ?? DEFAULT_MS;
  const until = new Date(Date.now() + ttl).toISOString();
  const ok = await store.acquireLock(name, until);
  if (!ok) {
    const err = new Error("lock held: " + name);
    err.code = "LOCK";
    throw err;
  }
  try {
    return await fn();
  } finally {
    await store.releaseLock(name);
  }
}
