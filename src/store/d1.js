import { createMemoryStore } from "./memory.js";

/**
 * D1 adapter. Workers should not run clustering or model calls.
 * Collection posts a snapshot; this store serves API reads/writes.
 */
function asJson(value) {
  if (value == null || value === "") return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

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
    async listArticleEventMap() {
      const { results } = await db.prepare("SELECT article_id, event_id FROM article_event_map").all();
      return (results || []).map((r) => [r.article_id, r.event_id]);
    },
    async loadArticleEventMap() {
      const map = mem.articleEventMap();
      map.clear();
      for (const [articleId, eventId] of await this.listArticleEventMap()) {
        if (articleId && eventId) map.set(articleId, eventId);
      }
      return map;
    },
    async applyFeed(feed) {
      const stmts = [];
      const iso = new Date().toISOString();
      for (const it of feed.events || []) {
        if (!it || !it.id) throw new Error("event missing id");
        const prev = await this.getEvent(it.id);
        const firstSeenAt = prev?.firstSeenAt || it.firstSeenAt || it.seenAt || iso;
        const merged = { ...it, firstSeenAt };
        stmts.push(
          db
            .prepare(
              "INSERT OR REPLACE INTO events (id, title, title_zh, overview_zh, category, value, json, occurred_at, published_at, first_seen_at, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(
              merged.id,
              merged.title || "",
              merged.titleZh || "",
              merged.overviewZh || "",
              merged.category || "",
              merged.value || 0,
              JSON.stringify(merged),
              merged.occurredAt || "",
              merged.publishedAt || "",
              firstSeenAt,
              merged.updatedAt || iso,
              iso
            )
        );
        stmts.push(db.prepare("DELETE FROM event_members WHERE event_id = ?").bind(it.id));
      }
      if (Array.isArray(feed.articles)) {
        for (const a of feed.articles) {
          if (!a || !a.id) continue;
          const prev = await this.getArticle(a.id);
          const firstSeenAt = prev?.firstSeenAt || a.firstSeenAt || a.seenAt || iso;
          const merged = { ...a, firstSeenAt };
          stmts.push(
            db
              .prepare(
                "INSERT OR REPLACE INTO articles (id, source, url, title, summary, published_at, first_seen_at, occurred_at, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              )
              .bind(
                merged.id,
                merged.source || "",
                merged.url || "",
                merged.title || "",
                merged.summary || "",
                merged.publishedAt || "",
                firstSeenAt,
                merged.occurredAt || "",
                JSON.stringify(merged),
                iso
              )
          );
        }
      }
      for (const [eventId, ids] of feed.members || []) {
        for (const aid of ids || []) {
          stmts.push(
            db
              .prepare("INSERT OR REPLACE INTO event_members (event_id, article_id) VALUES (?, ?)")
              .bind(eventId, aid)
          );
        }
      }
      for (const [articleId, eventId] of feed.articleEvent || []) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO article_event_map (article_id, event_id, created_at) VALUES (?, ?, ?)")
            .bind(articleId, eventId, iso)
        );
      }
      for (const h of feed.sourceHealth || []) {
        if (h && h.source) {
          stmts.push(
            db
              .prepare("INSERT OR REPLACE INTO source_health (source, json) VALUES (?, ?)")
              .bind(h.source, JSON.stringify(h))
          );
        }
      }
      if (feed.budget) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
            .bind("budget", JSON.stringify(feed.budget), new Date().toISOString())
        );
      }
      if (Array.isArray(feed.notifications) && feed.notifications.length) {
        feed.notifications.forEach((row, i) => {
          const id = row.id || "n:" + i;
          stmts.push(
            db
              .prepare(
                "INSERT OR REPLACE INTO notifications (id, event_id, channel, status, json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
              )
              .bind(
                id,
                row.eventId || "",
                row.channel || "",
                row.status || "",
                JSON.stringify(row),
                new Date().toISOString()
              )
          );
        });
      }
      if (feed.digest && feed.digest.date) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
            .bind("digest:" + feed.digest.date, JSON.stringify(feed.digest), new Date().toISOString())
        );
      }
      if (typeof db.batch === "function") {
        await db.batch(stmts);
      } else {
        for (const st of stmts) await st.run();
      }
      const map = mem.articleEventMap();
      for (const [articleId, eventId] of feed.articleEvent || []) {
        if (articleId && eventId) map.set(articleId, eventId);
      }
    },
    async purgeExpired(now = new Date()) {
      const dumped = await this.exportAll();
      const { purgeExpiredIds } = await import("../retention.js");
      const gone = purgeExpiredIds(dumped, now);
      const stmts = [];
      for (const id of gone.events) {
        stmts.push(db.prepare("DELETE FROM events WHERE id = ?").bind(id));
        stmts.push(db.prepare("DELETE FROM event_members WHERE event_id = ?").bind(id));
      }
      for (const id of gone.articles) {
        stmts.push(db.prepare("DELETE FROM articles WHERE id = ?").bind(id));
      }
      for (const aid of gone.maps) {
        stmts.push(db.prepare("DELETE FROM article_event_map WHERE article_id = ?").bind(aid));
      }
      if (!stmts.length) return;
      if (typeof db.batch === "function") await db.batch(stmts);
      else for (const st of stmts) await st.run();
      const map = mem.articleEventMap();
      for (const aid of gone.maps) map.delete(aid);
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
      return row?.json ? asJson(row.json) : null;
    },
    async listArticles() {
      const { results } = await db.prepare("SELECT raw_json AS json FROM articles").all();
      return (results || []).map((r) => asJson(r.json));
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
      return row?.json ? asJson(row.json) : null;
    },
    async listEvents() {
      const { results } = await db.prepare("SELECT json FROM events").all();
      return (results || []).map((r) => asJson(r.json));
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
      return row?.json ? asJson(row.json) : (await mem.getPrefs());
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
      return (results || []).map((r) => asJson(r.json));
    },
    async getFeedback(id) {
      const row = await readJson("SELECT json FROM feedback WHERE id = ?", id);
      return row?.json ? asJson(row.json) : null;
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
        snapshot: asJson(r.snapshot_json),
        createdAt: r.created_at,
      }));
    },
    async getFavorite(eventId) {
      const row = await readJson(
        "SELECT event_id, snapshot_json, created_at FROM favorites WHERE event_id = ?",
        eventId
      );
      return row
        ? { eventId: row.event_id, snapshot: asJson(row.snapshot_json), createdAt: row.created_at }
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
      return row?.value ? asJson(row.value) : null;
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
      return (results || []).map((r) => asJson(r.json));
    },
    async putTask(row) {
      await db
        .prepare("INSERT OR REPLACE INTO tasks (id, kind, status, lock_until, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(row.id, row.kind || "", row.status || "", row.lockUntil || "", JSON.stringify(row), new Date().toISOString())
        .run();
    },
    async getTask(id) {
      const row = await readJson("SELECT json FROM tasks WHERE id = ?", id);
      return row?.json ? asJson(row.json) : null;
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
      return (results || []).map((r) => asJson(r.json));
    },
    async putSnapshot(name, json) {
      await db
        .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
        .bind(name, JSON.stringify(json), new Date().toISOString())
        .run();
    },
    async getSnapshot(name) {
      const row = await readJson("SELECT json, at FROM snapshots WHERE name = ?", name);
      return row ? { json: asJson(row.json), at: row.at } : null;
    },
    async getBudget() {
      const row = await readJson("SELECT json FROM snapshots WHERE name = ?", "budget");
      return row?.json ? asJson(row.json) : null;
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
        cache: (cacheRows || []).map((r) => [r.key, { value: asJson(r.value), createdAt: r.created_at }]),
        tasks: (taskRows || [])
          .filter((r) => !String(r.id).startsWith("lock:"))
          .map((r) => [r.id, asJson(r.json)]),
        sourceHealth: (await this.listSourceHealth()).map((h) => [h.source, h]),
        snapshots: ((await db.prepare("SELECT name, json, at FROM snapshots").all()).results || [])
          .filter((r) => r.name !== "budget")
          .map((r) => [r.name, { json: asJson(r.json), at: r.at }]),
        budget: await this.getBudget(),
        locks,
      };
    },
    async importAll(data) {
      if (!data) return;
      const iso = new Date().toISOString();
      const stmts = [
        "events",
        "articles",
        "event_members",
        "article_event_map",
        "feedback",
        "reads",
        "favorites",
        "cache_entries",
        "notifications",
        "tasks",
        "source_health",
        "snapshots",
        "preferences",
      ].map((table) => db.prepare("DELETE FROM " + table));
      for (const [, article] of data.articles || []) {
        if (!article || !article.id) continue;
        stmts.push(
          db
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
              iso
            )
        );
      }
      for (const [, event] of data.events || []) {
        if (!event || !event.id) continue;
        stmts.push(
          db
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
              event.updatedAt || iso,
              iso
            )
        );
      }
      for (const [eventId, ids] of data.members || []) {
        for (const aid of ids || []) {
          stmts.push(
            db.prepare("INSERT OR REPLACE INTO event_members (event_id, article_id) VALUES (?, ?)").bind(eventId, aid)
          );
        }
      }
      for (const [articleId, eventId] of data.articleEvent || []) {
        const eid = typeof eventId === "string" ? eventId : eventId && eventId.eventId;
        if (!articleId || !eid) continue;
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO article_event_map (article_id, event_id, created_at) VALUES (?, ?, ?)")
            .bind(articleId, eid, iso)
        );
      }
      if (data.prefs) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO preferences (id, json, updated_at) VALUES (?, ?, ?)")
            .bind("default", JSON.stringify(data.prefs), iso)
        );
      }
      for (const row of data.feedback || []) {
        const item = { id: row.id || "fb:" + Date.now(), createdAt: row.createdAt || iso, ...row };
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO feedback (id, event_id, kind, json, created_at) VALUES (?, ?, ?, ?, ?)")
            .bind(item.id, item.eventId || "", item.kind || "", JSON.stringify(item), item.createdAt)
        );
      }
      for (const [eventId, readAt] of data.reads || []) {
        stmts.push(
          db.prepare("INSERT OR REPLACE INTO reads (event_id, read_at) VALUES (?, ?)").bind(eventId, readAt || "")
        );
      }
      for (const [eventId, fav] of data.favorites || []) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO favorites (event_id, snapshot_json, created_at) VALUES (?, ?, ?)")
            .bind(eventId, JSON.stringify(fav.snapshot || fav), fav.createdAt || iso)
        );
      }
      for (const [key, val] of data.cache || []) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO cache_entries (key, value, created_at) VALUES (?, ?, ?)")
            .bind(key, JSON.stringify(val && val.value ? val.value : val), iso)
        );
      }
      for (const row of data.notifications || []) {
        const id = row.id || "n:" + Date.now();
        stmts.push(
          db
            .prepare(
              "INSERT OR REPLACE INTO notifications (id, event_id, channel, status, json, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(id, row.eventId || "", row.channel || "", row.status || "", JSON.stringify(row), iso)
        );
      }
      for (const [, task] of data.tasks || []) {
        if (!task || !task.id) continue;
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO tasks (id, kind, status, lock_until, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(task.id, task.kind || "", task.status || "", task.lockUntil || "", JSON.stringify(task), iso)
        );
      }
      for (const [name, until] of data.locks || []) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO tasks (id, kind, status, lock_until, json, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind("lock:" + name, "lock", "held", until, "{}", iso)
        );
      }
      for (const [, row] of data.sourceHealth || []) {
        if (!row || !row.source) continue;
        stmts.push(
          db.prepare("INSERT OR REPLACE INTO source_health (source, json) VALUES (?, ?)").bind(row.source, JSON.stringify(row))
        );
      }
      if (data.budget) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
            .bind("budget", JSON.stringify(data.budget), iso)
        );
      }
      for (const [name, snap] of data.snapshots || []) {
        stmts.push(
          db
            .prepare("INSERT OR REPLACE INTO snapshots (name, json, at) VALUES (?, ?, ?)")
            .bind(name, JSON.stringify(snap.json || snap), snap.at || iso)
        );
      }
      const run = async () => {
        if (typeof db.batch === "function") await db.batch(stmts);
        else for (const st of stmts) await st.run();
      };
      try {
        await run();
      } catch (e) {
        throw e;
      }
      const map = mem.articleEventMap();
      map.clear();
      for (const [articleId, eventId] of data.articleEvent || []) {
        const eid = typeof eventId === "string" ? eventId : eventId && eventId.eventId;
        if (articleId && eid) map.set(articleId, eid);
      }
    },
  };
}
