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
  };

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
    async getPrefs() {
      return normalizePrefs(tables.prefs);
    },
    async setPrefs(prefs) {
      tables.prefs = normalizePrefs(prefs);
      tables.prefs.updatedAt = nowIso();
      return tables.prefs;
    },
    async addFeedback(row) {
      const item = { id: row.id || "fb:" + (tables.feedback.length + 1), createdAt: nowIso(), ...row };
      tables.feedback.push(item);
      return item;
    },
    async listFeedback() {
      return [...tables.feedback];
    },
    async getFeedback(id) {
      return tables.feedback.find((f) => f.id === id) || null;
    },
    async setRead(eventId, readAt = nowIso()) {
      tables.reads.set(eventId, readAt);
    },
    async listReads() {
      return Object.fromEntries(tables.reads);
    },
    async putFavorite(eventId, snapshot) {
      tables.favorites.set(eventId, {
        eventId,
        snapshot,
        createdAt: tables.favorites.get(eventId)?.createdAt || nowIso(),
      });
    },
    async deleteFavorite(eventId) {
      tables.favorites.delete(eventId);
    },
    async listFavorites() {
      return [...tables.favorites.values()];
    },
    async getFavorite(eventId) {
      return tables.favorites.get(eventId) || null;
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
