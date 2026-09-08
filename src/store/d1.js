import { createMemoryStore } from "./memory.js";

/**
 * D1 adapter. Workers should not run clustering or model calls.
 * Collection posts a snapshot; this store serves API reads/writes.
 */
export function createD1Store(db) {
  const mem = createMemoryStore();

  async function readJson(sql, ...binds) {
    const row = await db.prepare(sql).bind(...binds).first();
    return row;
  }

  return {
    kind: "d1",
    articleEventMap() {
      return mem.articleEventMap();
    },
    async putArticle(article) {
      await db
        .prepare(
          "INSERT OR REPLACE INTO articles (id, source, url, title, summary, published_at, first_seen_at, occurred_at, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          article.id,
          article.source || "",
          article.url || "",
          article.title || "",
          article.summary || "",
          article.publishedAt || "",
          article.firstSeenAt || "",
          article.occurredAt || "",
          JSON.stringify(article),
          new Date().toISOString()
        )
        .run();
      return article;
    },
    async getArticle(id) {
      const row = await readJson("SELECT raw_json AS json FROM articles WHERE id = ?", id);
      return row?.json ? JSON.parse(row.json) : null;
    },
    async listArticles() {
      const { results } = await db.prepare("SELECT raw_json AS json FROM articles").all();
      return (results || []).map((r) => JSON.parse(r.json));
    },
    async putEvent(event) {
      await db
        .prepare(
          "INSERT OR REPLACE INTO events (id, title, title_zh, overview_zh, category, value, json, occurred_at, published_at, first_seen_at, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          event.id,
          event.title || "",
          event.titleZh || "",
          event.overviewZh || "",
          event.category || "",
          event.value || 0,
          JSON.stringify(event),
          event.occurredAt || "",
          event.publishedAt || "",
          event.firstSeenAt || "",
          event.updatedAt || new Date().toISOString(),
          new Date().toISOString()
        )
        .run();
      return event;
    },
    async getEvent(id) {
      const row = await readJson("SELECT json FROM events WHERE id = ?", id);
      return row?.json ? JSON.parse(row.json) : null;
    },
    async listEvents() {
      const { results } = await db.prepare("SELECT json FROM events").all();
      return (results || []).map((r) => JSON.parse(r.json));
    },
    async setMembers(eventId, articleIds) {
      await db.prepare("DELETE FROM event_members WHERE event_id = ?").bind(eventId).run();
      for (const aid of articleIds || []) {
        await db
          .prepare("INSERT OR REPLACE INTO event_members (event_id, article_id) VALUES (?, ?)")
          .bind(eventId, aid)
          .run();
      }
    },
    async getMembers(eventId) {
      const { results } = await db
        .prepare("SELECT article_id FROM event_members WHERE event_id = ?")
        .bind(eventId)
        .all();
      return (results || []).map((r) => r.article_id);
    },
    async mapArticleToEvent(articleId, eventId) {
      await db
        .prepare(
          "INSERT OR REPLACE INTO article_event_map (article_id, event_id, created_at) VALUES (?, ?, ?)"
        )
        .bind(articleId, eventId, new Date().toISOString())
        .run();
      mem.articleEventMap().set(articleId, eventId);
    },
    async eventIdForArticle(articleId) {
      const row = await readJson(
        "SELECT event_id FROM article_event_map WHERE article_id = ?",
        articleId
      );
      return row?.event_id || null;
    },
    async getPrefs() {
      const row = await readJson("SELECT json FROM preferences WHERE id = ?", "default");
      return row?.json ? JSON.parse(row.json) : (await mem.getPrefs());
    },
    async setPrefs(prefs) {
      await db
        .prepare("INSERT OR REPLACE INTO preferences (id, json, updated_at) VALUES (?, ?, ?)")
        .bind("default", JSON.stringify(prefs), new Date().toISOString())
        .run();
      return prefs;
    },
    async addFeedback(row) {
      const item = { id: row.id || "fb:" + Date.now(), createdAt: new Date().toISOString(), ...row };
      await db
        .prepare("INSERT OR REPLACE INTO feedback (id, event_id, kind, json, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(item.id, item.eventId || "", item.kind || "", JSON.stringify(item), item.createdAt)
        .run();
      return item;
    },
    async listFeedback() {
      const { results } = await db.prepare("SELECT json FROM feedback").all();
      return (results || []).map((r) => JSON.parse(r.json));
    },
    async getFeedback(id) {
      const row = await readJson("SELECT json FROM feedback WHERE id = ?", id);
      return row?.json ? JSON.parse(row.json) : null;
    },
    async setRead(eventId, readAt) {
      await db
        .prepare("INSERT OR REPLACE INTO reads (event_id, read_at) VALUES (?, ?)")
        .bind(eventId, readAt || "")
        .run();
    },
    async listReads() {
      const { results } = await db.prepare("SELECT event_id, read_at FROM reads").all();
      const out = {};
      for (const r of results || []) out[r.event_id] = r.read_at;
      return out;
    },
    async putFavorite(eventId, snapshot) {
      await db
        .prepare("INSERT OR REPLACE INTO favorites (event_id, snapshot_json, created_at) VALUES (?, ?, ?)")
        .bind(eventId, JSON.stringify(snapshot), new Date().toISOString())
        .run();
    },
    async deleteFavorite(eventId) {
      await db.prepare("DELETE FROM favorites WHERE event_id = ?").bind(eventId).run();
    },
    async listFavorites() {
      const { results } = await db.prepare("SELECT event_id, snapshot_json, created_at FROM favorites").all();
      return (results || []).map((r) => ({
        eventId: r.event_id,
        snapshot: JSON.parse(r.snapshot_json),
        createdAt: r.created_at,
      }));
    },
    async getFavorite(eventId) {
      const row = await readJson(
        "SELECT event_id, snapshot_json, created_at FROM favorites WHERE event_id = ?",
        eventId
      );
      return row
        ? { eventId: row.event_id, snapshot: JSON.parse(row.snapshot_json), createdAt: row.created_at }
        : null;
    },
    async putCache(key, value) {
      await db
        .prepare("INSERT OR REPLACE INTO cache_entries (key, value, created_at) VALUES (?, ?, ?)")
        .bind(key, JSON.stringify(value), new Date().toISOString())
        .run();
    },
    async getCache(key) {
      const row = await readJson("SELECT value FROM cache_entries WHERE key = ?", key);
      return row?.value ? JSON.parse(row.value) : null;
    },
    async putNotification(row) {
      const id = row.id || "n:" + Date.now();
      await db
        .prepare(
          "INSERT OR REPLACE INTO notifications (id, event_id, channel, status, json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .bind(id, row.eventId || "", row.channel || "", row.status || "", JSON.stringify(row), new Date().toISOString())
        .run();
    },
    async listNotifications() {
      const { results } = await db.prepare("SELECT json FROM notifications").all();
      return (results || []).map((r) => JSON.parse(r.json));
    },
    async putTask(row) {
      await db
        .prepare("INSERT OR REPLACE INTO tasks (id, kind, status, lock_until, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(row.id, row.kind || "", row.status || "", row.lockUntil || "", JSON.stringify(row), new Date().toISOString())
        .run();
    },
    async getTask(id) {
      const row = await readJson("SELECT json FROM tasks WHERE id = ?", id);
      return row?.json ? JSON.parse(row.json) : null;
    },
    async acquireLock(name, untilIso) {
      const row = await readJson("SELECT lock_until FROM tasks WHERE id = ?", "lock:" + name);
      if (row?.lock_until && Date.parse(row.lock_until) > Date.now()) return false;
      await db
        .prepare("INSERT OR REPLACE INTO tasks (id, kind, status, lock_until, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("lock:" + name, "lock", "held", untilIso, "{}", new Date().toISOString())
        .run();
      return true;
    },
    async releaseLock(name) {
      await db.prepare("DELETE FROM tasks WHERE id = ?").bind("lock:" + name).run();
    },
    async putSourceHealth(row) {
      await db
        .prepare("INSERT OR REPLACE INTO source_health (source, json) VALUES (?, ?)")
        .bind(row.source, JSON.stringify(row))
        .run();
    },
    async listSourceHealth() {
      const { results } = await db.prepare("SELECT json FROM source_health").all();
      return (results || []).map((r) => JSON.parse(r.json));
    },
    async putSnapshot(name, json) {
      await db
        .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
        .bind(name, JSON.stringify(json), new Date().toISOString())
        .run();
    },
    async getSnapshot(name) {
      const row = await readJson("SELECT json, at FROM snapshots WHERE name = ?", name);
      return row ? { json: JSON.parse(row.json), at: row.at } : null;
    },
    async getBudget() {
      const row = await readJson("SELECT json FROM snapshots WHERE name = ?", "budget");
      return row?.json ? JSON.parse(row.json) : null;
    },
    async setBudget(b) {
      await db
        .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
        .bind("budget", JSON.stringify(b), new Date().toISOString())
        .run();
    },
    async exportAll() {
      const members = [];
      for (const ev of await this.listEvents()) {
        members.push([ev.id, await this.getMembers(ev.id)]);
      }
      const { results: mapRows } = await db.prepare("SELECT article_id, event_id, created_at FROM article_event_map").all();
      const { results: cacheRows } = await db.prepare("SELECT key, value, created_at FROM cache_entries").all();
      const { results: taskRows } = await db.prepare("SELECT id, json, lock_until FROM tasks").all();
      const locks = (taskRows || [])
        .filter((r) => String(r.id).startsWith("lock:"))
        .map((r) => [String(r.id).slice(5), r.lock_until]);
      return {
        events: (await this.listEvents()).map((e) => [e.id, e]),
        articles: (await this.listArticles()).map((a) => [a.id, a]),
        members,
        articleEvent: (mapRows || []).map((r) => [r.article_id, r.event_id]),
        prefs: await this.getPrefs(),
        favorites: (await this.listFavorites()).map((f) => [f.eventId, f]),
        feedback: await this.listFeedback(),
        reads: Object.entries(await this.listReads()),
        notifications: await this.listNotifications(),
        cache: (cacheRows || []).map((r) => [r.key, { value: JSON.parse(r.value), createdAt: r.created_at }]),
        tasks: (taskRows || [])
          .filter((r) => !String(r.id).startsWith("lock:"))
          .map((r) => [r.id, JSON.parse(r.json)]),
        sourceHealth: (await this.listSourceHealth()).map((h) => [h.source, h]),
        snapshots: ((await db.prepare("SELECT name, json, at FROM snapshots").all()).results || [])
          .filter((r) => r.name !== "budget")
          .map((r) => [r.name, { json: JSON.parse(r.json), at: r.at }]),
        budget: await this.getBudget(),
        locks,
      };
    },
    async importAll(data) {
      if (!data) return;
      for (const [, article] of data.articles || []) await this.putArticle(article);
      for (const [, event] of data.events || []) await this.putEvent(event);
      for (const [eventId, ids] of data.members || []) await this.setMembers(eventId, ids);
      for (const [articleId, eventId] of data.articleEvent || []) {
        await this.mapArticleToEvent(articleId, typeof eventId === "string" ? eventId : eventId.eventId);
      }
      if (data.prefs) await this.setPrefs(data.prefs);
      for (const row of data.feedback || []) await this.addFeedback(row);
      for (const [eventId, readAt] of data.reads || []) await this.setRead(eventId, readAt);
      for (const [eventId, fav] of data.favorites || []) {
        await this.putFavorite(eventId, fav.snapshot || fav);
      }
      for (const [key, val] of data.cache || []) {
        await this.putCache(key, val && val.value ? val.value : val);
      }
      for (const row of data.notifications || []) await this.putNotification(row);
      for (const [, task] of data.tasks || []) await this.putTask(task);
      for (const [name, until] of data.locks || []) await this.acquireLock(name, until);
      for (const [, row] of data.sourceHealth || []) await this.putSourceHealth(row);
      if (data.budget) await this.setBudget(data.budget);
      for (const [name, snap] of data.snapshots || []) {
        await this.putSnapshot(name, snap.json || snap);
      }
    },
  };
}
