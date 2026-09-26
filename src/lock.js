import { randomBytes } from "node:crypto";

const DEFAULT_MS = 15 * 60 * 1000;

export async function withLock(store, name, fn, opts = {}) {
  const ttl = opts.ttlMs ?? DEFAULT_MS;
  const until = new Date(Date.now() + ttl).toISOString();
  // The token proves ownership: a caller whose lock expired and was retaken
  // by someone else must not release the new holder's lock.
  const token = (store.kind === "memory" || store.kind === "file" || store.kind === "d1")
    ? randomBytes(8).toString("hex")
    : "";
  const ok = await store.acquireLock(name, until, token);
  if (!ok) {
    const err = new Error("lock held: " + name);
    err.code = "LOCK";
    throw err;
  }
  try {
    return await fn();
  } finally {
    await store.releaseLock(name, token);
  }
}
