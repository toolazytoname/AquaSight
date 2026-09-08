/** Durable local favorites. Pending intent wins over any remote snapshot. */
export function createFavorites({ read, write, request, onChange = () => {} }) {
  const valid = (item) => item && typeof item === "object" &&
    Boolean(item.title || item.titleZh || item.overviewZh || item.summary);
  const legacy = read() || {};
  let data = { version: 2, seq: Number(legacy.seq) || 0, items: {}, synced: {}, pending: {} };
  for (const [id, item] of Object.entries(legacy.items || {})) {
    if (valid(item)) data.items[id] = { ...item, id };
  }
  for (const [id, op] of Object.entries(legacy.pending || {})) {
    if (op?.kind === "remove" || (op?.kind === "save" && valid(data.items[id]))) {
      data.pending[id] = op;
      if (op.kind === "remove") delete data.items[id];
    }
  }
  for (const id of Object.keys(legacy.synced || {})) {
    if (data.items[id]) data.synced[id] = true;
  }
  let revision = 0;
  let available = false;
  let running = null;
  let requested = false;
  const clone = () => structuredClone(data);
  function commit(next) {
    // A failed disk write must not be advertised as durable local success.
    write({ ...next, ids: Object.keys(next.items) });
    data = next;
    revision++;
    onChange();
  }
  function set(id, item) {
    if (!id || (item && !valid(item))) throw new Error("没有可收藏的内容");
    const next = clone();
    if (item) next.items[id] = { ...item, id };
    else delete next.items[id];
    delete next.synced[id];
    next.pending[id] = { kind: item ? "save" : "remove", revision: ++next.seq };
    commit(next);
  }
  function mergeRemote(items, expectedRevision = revision) {
    if (expectedRevision !== revision) return false;
    const next = clone();
    const remoteIds = new Set();
    for (const item of items || []) {
      const id = item?.id || item?.eventId;
      if (!id || !valid(item)) continue;
      remoteIds.add(id);
      if (next.pending[id]) continue;
      next.items[id] = { ...item, id };
      next.synced[id] = true;
    }
    for (const id of Object.keys(next.items)) {
      if (remoteIds.has(id) || next.pending[id]) continue;
      if (next.synced[id]) {
        delete next.items[id];
        delete next.synced[id];
      } else {
        // Legacy local-only favorites are retained and uploaded once API is available.
        next.pending[id] = { kind: "save", revision: ++next.seq };
      }
    }
    commit(next);
    return true;
  }
  function sync() {
    if (!available) return Promise.resolve();
    requested = true;
    if (running) return running;
    running = (async () => {
      do {
        requested = false;
        for (const id of Object.keys(data.pending)) {
          if (!available) break;
          const op = data.pending[id];
          if (!op) continue;
          const item = data.items[id];
          try {
            await request(id, op.kind, item);
            if (data.pending[id]?.revision !== op.revision) {
              requested = true;
              continue;
            }
            const next = clone();
            delete next.pending[id];
            if (op.kind === "save") next.synced[id] = true;
            else delete next.synced[id];
            commit(next);
          } catch {
            // One attempt per trigger. Keep intent for startup, reconnect or refresh.
            if (data.pending[id]?.revision !== op.revision) requested = true;
          }
        }
      } while (requested && available);
    })().finally(() => { running = null; });
    return running;
  }
  return {
    items: () => ({ ...data.items }),
    has: (id) => Boolean(data.items[id]),
    pending: (id) => data.pending[id],
    pendingCount: () => Object.keys(data.pending).length,
    revision: () => revision,
    isAvailable: () => available,
    setRemoteAvailable(value) { available = value; },
    set, mergeRemote, sync,
    reset() { commit({ version: 2, seq: data.seq + 1, items: {}, synced: {}, pending: {} }); },
  };
}
