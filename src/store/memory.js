import { normalizePrefs, DEFAULT_PREFS } from "../prefs.js";
import { purgeExpiredIds } from "../retention.js";

function nowIso() {
  return new Date().toISOString();
}

export function createMemoryStore(seed = {}) {
  const tables = {
    articles: new Map(seed.articles || []),
    events: new Map(seed.events || []),
    members: new Map(seed.members || []),
    articleEvent: new Map(seed.articleEvent || []),
    prefs: normalizePrefs(seed.prefs || DEFAULT_PREFS),
    feedback: Array.isArray(seed.feedback) ? [...seed.feedback] : [],
    reads: new Map(seed.reads || []),
    favorites: new Map(seed.favorites || []),
    cache: new Map(seed.cache || []),
    notifications: Array.isArray(seed.notifications) ? [...seed.notifications] : [],
    tasks: new Map(seed.tasks || []),
    locks: new Map(seed.locks || []),
    sourceHealth: new Map(seed.sourceHealth || []),
    snapshots: new Map(seed.snapshots || []),
    budget: seed.budget || null,
    users: new Map(seed.users || []),
    sessions: new Map(seed.sessions || []),
    otps: new Map(seed.otps || []),
    rates: new Map(seed.rates || []),
    userPrefs: new Map(seed.userPrefs || []),
    userReads: new Map(seed.userReads || []),
    userFavorites: new Map(seed.userFavorites || []),
    userFeedback: new Map(seed.userFeedback || []),
    userRev: new Map(seed.userRev || []),
  };

  function uid(opts) {
    return (opts && opts.userId) || "";
  }
  function userMap(root, id) {
    if (!root.has(id)) root.set(id, new Map());
    return root.get(id);
  }
  async function nextRev(userId) {
    const n = (tables.userRev.get(userId) || 0) + 1;
    tables.userRev.set(userId, n);
    return n;
  }

  return {
    kind: "memory",
    tables,
    async putArticle(article) {
      tables.articles.set(article.id, { ...article });
      return article;
    },
    async getArticle(id) {
      return tables.articles.get(id) || null;
    },
    async listArticles() {
      return [...tables.articles.values()];
    },
    async listArticleEventMap() {
      return [...tables.articleEvent.entries()].map(([articleId, eventId]) => [
        articleId,
        typeof eventId === "string" ? eventId : eventId && eventId.eventId,
      ]);
    },
    async loadArticleEventMap() {
      return this.articleEventMap();
    },
    async applyFeed(feed) {
      const nextEvents = new Map(tables.events);
      const nextMembers = new Map(tables.members);
      const nextMap = new Map(tables.articleEvent);
      const nextArticles = new Map(tables.articles);
      for (const it of feed.events || []) {
        if (!it || !it.id) throw new Error("event missing id");
        const prev = nextEvents.get(it.id);
        nextEvents.set(it.id, {
          ...it,
          firstSeenAt: prev?.firstSeenAt || it.firstSeenAt || it.seenAt,
        });
      }
      for (const [eventId, ids] of feed.members || []) {
        nextMembers.set(eventId, [...(ids || [])]);
      }
      for (const [articleId, eventId] of feed.articleEvent || []) {
        if (articleId && eventId) nextMap.set(articleId, eventId);
      }
      if (Array.isArray(feed.articles)) {
        for (const a of feed.articles) {
          if (!a || !a.id) continue;
          const prev = nextArticles.get(a.id);
          nextArticles.set(a.id, {
            ...a,
            firstSeenAt: prev?.firstSeenAt || a.firstSeenAt || a.seenAt,
          });
        }
      }
      tables.events = nextEvents;
      tables.members = nextMembers;
      tables.articleEvent = nextMap;
      tables.articles = nextArticles;
      const nextHealth = new Map(tables.sourceHealth);
      for (const h of feed.sourceHealth || []) {
        if (h && h.source) nextHealth.set(h.source, { ...h });
      }
      tables.sourceHealth = nextHealth;
      if (feed.budget) tables.budget = feed.budget;
      if (Array.isArray(feed.notifications) && feed.notifications.length) {
        const byId = new Map(tables.notifications.map((n) => [n.id, n]));
        feed.notifications.forEach((row, i) => {
          const id = row.id || "n:" + (tables.notifications.length + i + 1);
          byId.set(id, { ...row, id });
        });
        tables.notifications = [...byId.values()];
      }
      if (feed.digest && feed.digest.date) {
        tables.snapshots.set("digest:" + feed.digest.date, { json: feed.digest, at: nowIso() });
      }
    },
    async purgeExpired(now = new Date()) {
      const dumped = {
        events: [...tables.events.entries()],
        articles: [...tables.articles.entries()],
        articleEvent: [...tables.articleEvent.entries()],
        favorites: [...tables.favorites.entries()],
      };
      const gone = purgeExpiredIds(dumped, now);
      for (const id of gone.events) {
        tables.events.delete(id);
        tables.members.delete(id);
      }
      for (const id of gone.articles) tables.articles.delete(id);
      for (const aid of gone.maps) tables.articleEvent.delete(aid);
    },
    async putEvent(event) {
      tables.events.set(event.id, { ...event });
      return event;
    },
    async getEvent(id) {
      return tables.events.get(id) || null;
    },
    async listEvents() {
      return [...tables.events.values()];
    },
    async setMembers(eventId, articleIds) {
      tables.members.set(eventId, [...articleIds]);
    },
    async getMembers(eventId) {
      return tables.members.get(eventId) || [];
    },
    async mapArticleToEvent(articleId, eventId) {
      tables.articleEvent.set(articleId, eventId);
    },
    async eventIdForArticle(articleId) {
      const v = tables.articleEvent.get(articleId);
      if (!v) return null;
      return typeof v === "string" ? v : v.eventId || null;
    },
    articleEventMap() {
      return tables.articleEvent;
    },
    async getPrefs(opts = {}) {
      const id = uid(opts);
      if (!id) return normalizePrefs(tables.prefs);
      return normalizePrefs(tables.userPrefs.get(id) || DEFAULT_PREFS);
    },
    async setPrefs(prefs, opts = {}) {
      const id = uid(opts);
      const next = normalizePrefs(prefs);
      next.updatedAt = nowIso();
      next.rev = await nextRev(id);
      if (!id) {
        tables.prefs = next;
        return next;
      }
      tables.userPrefs.set(id, next);
      return next;
    },
    async addFeedback(row, opts = {}) {
      const id = uid(opts);
      const item = { id: row.id || "fb:" + Date.now(), createdAt: nowIso(), userId: id, ...row };
      if (!id) {
        tables.feedback.push(item);
        return item;
      }
      const list = tables.userFeedback.get(id) || [];
      list.push(item);
      tables.userFeedback.set(id, list);
      return item;
    },
    async listFeedback(opts = {}) {
      const id = uid(opts);
      if (!id) return [...tables.feedback];
      return [...(tables.userFeedback.get(id) || [])];
    },
    async getFeedback(fid, opts = {}) {
      return (await this.listFeedback(opts)).find((f) => f.id === fid) || null;
    },
    async setRead(eventId, readAt = nowIso(), opts = {}) {
      const id = uid(opts);
      if (!id) {
        tables.reads.set(eventId, readAt);
        return;
      }
      userMap(tables.userReads, id).set(eventId, readAt);
    },
    async listReads(opts = {}) {
      const id = uid(opts);
      if (!id) return Object.fromEntries(tables.reads);
      return Object.fromEntries(userMap(tables.userReads, id));
    },
    async putFavorite(eventId, snapshot, opts = {}) {
      const id = uid(opts);
      const rev = await nextRev(id);
      const row = {
        eventId,
        snapshot,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        rev,
        deleted: false,
      };
      if (!id) {
        row.createdAt = tables.favorites.get(eventId)?.createdAt || row.createdAt;
        tables.favorites.set(eventId, row);
        return row;
      }
      const prev = userMap(tables.userFavorites, id).get(eventId);
      row.createdAt = prev?.createdAt || row.createdAt;
      userMap(tables.userFavorites, id).set(eventId, row);
      return row;
    },
    async deleteFavorite(eventId, opts = {}) {
      const id = uid(opts);
      if (!id) {
        tables.favorites.delete(eventId);
        return { deleted: true, rev: await nextRev(id) };
      }
      const rev = await nextRev(id);
      const prev = userMap(tables.userFavorites, id).get(eventId) || { eventId, snapshot: null };
      userMap(tables.userFavorites, id).set(eventId, {
        ...prev,
        deleted: true,
        updatedAt: nowIso(),
        rev,
        snapshot: prev.snapshot || null,
      });
      return { deleted: true, rev };
    },
    async listFavorites(opts = {}) {
      const id = uid(opts);
      const rows = !id ? [...tables.favorites.values()] : [...userMap(tables.userFavorites, id).values()];
      return rows.filter((r) => !r.deleted);
    },
    async peekFavorite(eventId, opts = {}) {
      const id = uid(opts);
      return !id ? tables.favorites.get(eventId) || null : userMap(tables.userFavorites, id).get(eventId) || null;
    },
    async getFavorite(eventId, opts = {}) {
      const row = await this.peekFavorite(eventId, opts);
      if (!row || row.deleted) return null;
      return row;
    },
    async putUser(user) {
      tables.users.set(user.id, { ...user });
      return user;
    },
    async getUser(id) {
      return tables.users.get(id) || null;
    },
    async getUserByEmail(email) {
      const addr = String(email || "").toLowerCase();
      return [...tables.users.values()].find((u) => u.email === addr && !u.deletedAt) || null;
    },
    async putOtp(row) {
      tables.otps.set(row.email, { ...row });
    },
    async getOtp(email) {
      return tables.otps.get(email) || null;
    },
    async deleteOtp(email) {
      tables.otps.delete(email);
    },
    async bumpRate(key, cap) {
      const n = (tables.rates.get(key) || 0) + 1;
      tables.rates.set(key, n);
      return { count: n, limited: n > cap };
    },
    async putSession(session) {
      tables.sessions.set(session.id, { ...session });
      return session;
    },
    async getSessionByHash(tokenHash) {
      return [...tables.sessions.values()].find((s) => s.tokenHash === tokenHash) || null;
    },
    async revokeSession(id) {
      const s = tables.sessions.get(id);
      if (s) tables.sessions.set(id, { ...s, revokedAt: nowIso() });
    },
    async revokeUserSessions(userId) {
      for (const [id, s] of tables.sessions) {
        if (s.userId === userId && !s.revokedAt) tables.sessions.set(id, { ...s, revokedAt: nowIso() });
      }
    },
    async listSessions(userId) {
      return [...tables.sessions.values()].filter((s) => s.userId === userId && !s.revokedAt);
    },
    async exportUser(userId) {
      return {
        prefs: await this.getPrefs({ userId }),
        reads: await this.listReads({ userId }),
        favorites: await this.listFavorites({ userId }),
        feedback: await this.listFeedback({ userId }),
      };
    },
    async deleteUserData(userId) {
      const user = tables.users.get(userId);
      if (user) tables.users.set(userId, { ...user, deletedAt: nowIso(), email: "deleted:" + userId });
      tables.userPrefs.delete(userId);
      tables.userReads.delete(userId);
      tables.userFavorites.delete(userId);
      tables.userFeedback.delete(userId);
      await this.revokeUserSessions(userId);
    },
    async migrateLegacyToUser(userId) {
      if (tables.prefs) await this.setPrefs(tables.prefs, { userId });
      for (const [eventId, at] of tables.reads) await this.setRead(eventId, at, { userId });
      for (const [eventId, row] of tables.favorites) {
        await this.putFavorite(eventId, row.snapshot || row, { userId });
      }
    },
    async putCache(key, value) {
      tables.cache.set(key, { value, createdAt: nowIso() });
    },
    async getCache(key) {
      const row = tables.cache.get(key);
      return row ? row.value : null;
    },
    async putNotification(row) {
      tables.notifications.push({ id: row.id || "n:" + (tables.notifications.length + 1), createdAt: nowIso(), ...row });
    },
    async listNotifications() {
      return [...tables.notifications];
    },
    async putTask(row) {
      tables.tasks.set(row.id, { ...row, updatedAt: nowIso() });
    },
    async getTask(id) {
      return tables.tasks.get(id) || null;
    },
    async acquireLock(name, untilIso) {
      const cur = tables.locks.get(name);
      const now = Date.now();
      if (cur && Date.parse(cur) > now) return false;
      tables.locks.set(name, untilIso);
      return true;
    },
    async releaseLock(name) {
      tables.locks.delete(name);
    },
    async putSourceHealth(row) {
      tables.sourceHealth.set(row.source, { ...row });
    },
    async listSourceHealth() {
      return [...tables.sourceHealth.values()];
    },
    async putSnapshot(name, json) {
      tables.snapshots.set(name, { json, at: nowIso() });
    },
    async getSnapshot(name) {
      return tables.snapshots.get(name) || null;
    },
    async getBudget() {
      return tables.budget;
    },
    async setBudget(b) {
      tables.budget = b;
    },
    async exportAll() {
      return {
        articles: [...tables.articles.entries()],
        events: [...tables.events.entries()],
        members: [...tables.members.entries()],
        articleEvent: [...tables.articleEvent.entries()],
        prefs: tables.prefs,
        feedback: tables.feedback,
        reads: [...tables.reads.entries()],
        favorites: [...tables.favorites.entries()],
        cache: [...tables.cache.entries()],
        notifications: tables.notifications,
        tasks: [...tables.tasks.entries()],
        sourceHealth: [...tables.sourceHealth.entries()],
        snapshots: [...tables.snapshots.entries()],
        budget: tables.budget,
        locks: [...tables.locks.entries()],
      };
    },
    async importAll(data) {
      if (!data) return;
      Object.assign(tables, {
        articles: new Map(data.articles || []),
        events: new Map(data.events || []),
        members: new Map(data.members || []),
        articleEvent: new Map(data.articleEvent || []),
        prefs: normalizePrefs(data.prefs || DEFAULT_PREFS),
        feedback: data.feedback || [],
        reads: new Map(data.reads || []),
        favorites: new Map(data.favorites || []),
        cache: new Map(data.cache || []),
        notifications: data.notifications || [],
        tasks: new Map(data.tasks || []),
        sourceHealth: new Map(data.sourceHealth || []),
        snapshots: new Map(data.snapshots || []),
        budget: data.budget || null,
        locks: new Map(data.locks || []),
      });
    },
  };
}
