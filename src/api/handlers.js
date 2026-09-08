import { selectFeatured, selectLatest, selectDigest } from "../select.js";
import { applyFeedback, undoFeedback, normalizePrefs } from "../prefs.js";
import { assertSafeImportUrl, fetchImported } from "../ssrf.js";
import { fromManualImport, xSubscriptionStatus } from "../x.js";
import { stripHtml, extractMainText } from "../html.js";
import { articleId } from "../identity.js";
import { cluster } from "../cluster.js";
import { SOURCE_CATALOG } from "../catalog.js";
import { createBudget, MONTHLY_CNY, DAILY_CNY } from "../budget.js";
import { beijingYmd } from "../time.js";
import { ingestAllowed, readAuth } from "../access.js";
import { ingestPayload } from "../ingest.js";

export const API_VERSION = "v1";

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extra,
    },
  });
}

function encodeCursor(obj) {
  const s = JSON.stringify(obj);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(s, "utf8").toString("base64url");
  }
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(raw) {
  if (!raw) return { o: 0 };
  try {
    const pad = raw.replace(/-/g, "+").replace(/_/g, "/");
    const txt =
      typeof Buffer !== "undefined"
        ? Buffer.from(pad, "base64").toString("utf8")
        : atob(pad);
    return JSON.parse(txt);
  } catch {
    return { o: 0 };
  }
}

function envelope(env, extra) {
  return {
    apiVersion: API_VERSION,
    snapshotAt: env.snapshotAt || new Date().toISOString(),
    ...extra,
  };
}

function publicEvent(it) {
  if (!it) return it;
  const copy = { ...it };
  delete copy.reason;
  delete copy.scoreParts;
  delete copy._prefValue;
  return copy;
}

export async function handleApi(req, env) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const store = env.store;
  const snapshotAt =
    (await store.getSnapshot("events"))?.at || new Date().toISOString();
  env.snapshotAt = snapshotAt;

  if (path === "/api/v1/health" || path === "/api/v1/status/public") {
    const health = await store.listSourceHealth();
    return json(
      envelope(env, {
        ok: true,
        x: xSubscriptionStatus(env.env || process.env),
        sources: health.map((h) => ({
          source: h.source,
          ok: h.ok,
          purpose: h.purpose,
          lastSuccessAt: h.lastSuccessAt || null,
        })),
      })
    );
  }

  const auth = await readAuth(req, env);
  const ingestPath = path === "/api/v1/ingest";
  if (!auth.ok) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
  if (auth.role === "ingest" && !ingestAllowed(req.method, path)) {
    return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
  }
  if (ingestPath && auth.role !== "ingest" && auth.role !== "local") {
    return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
  }

  if (req.method === "POST" && ingestPath) {
    const body = await req.json();
    const result = await ingestPayload(store, body);
    return json(envelope(env, { ok: true, count: result.count, snapshotAt: result.snapshotAt }));
  }

  if (path === "/api/v1/status" && req.method === "GET") {
    const health = await store.listSourceHealth();
    const notes = await store.listNotifications();
    const budget = createBudget((await store.getBudget()) || {});
    const events = await store.listEvents();
    const last = await store.getSnapshot("events");
    const failedCollect = health.length > 0 && health.every((h) => h.ok === false);
    return json(
      envelope(env, {
        sources: health,
        catalog: SOURCE_CATALOG,
        notifications: notes.slice(-20),
        budget: budget.snapshot(),
        budgetCaps: { monthlyCny: MONTHLY_CNY, dailyCny: DAILY_CNY },
        eventCount: events.length,
        lastSnapshotAt: last?.at || null,
        emptyMeansFailure: failedCollect,
        x: xSubscriptionStatus(env.env || process.env),
        instantNotifyEnabled: (await store.getPrefs()).instantNotifyEnabled,
      })
    );
  }

  if (path === "/api/v1/settings" && req.method === "GET") {
    return json(envelope(env, { prefs: await store.getPrefs() }));
  }
  if (path === "/api/v1/settings" && (req.method === "PUT" || req.method === "POST")) {
    const body = await req.json();
    const prefs = await store.setPrefs(normalizePrefs({ ...(await store.getPrefs()), ...body }));
    return json(envelope(env, { prefs }));
  }

  if (path === "/api/v1/events" && req.method === "GET") {
    const view = url.searchParams.get("view") || "featured";
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30));
    const prefs = await store.getPrefs();
    let items = await store.listEvents();
    if (q) {
      items = items.filter((it) =>
        [it.title, it.titleZh, it.overviewZh, it.summary]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    const now = new Date();
    if (view === "latest") items = selectLatest(items, { now, prefs });
    else if (view === "digest") items = selectDigest(items, { now, prefs });
    else items = selectFeatured(items, { now, prefs });
    const start = cursor.o || 0;
    const slice = items.slice(start, start + limit);
    const next = start + slice.length < items.length ? encodeCursor({ o: start + slice.length }) : null;
    return json(
      envelope(env, {
        view,
        items: slice.map(publicEvent),
        cursor: next,
        total: items.length,
      })
    );
  }

  const eventMatch = path.match(/^\/api\/v1\/events\/([^/]+)$/);
  if (eventMatch && req.method === "GET") {
    const id = decodeURIComponent(eventMatch[1]);
    const ev = await store.getEvent(id);
    if (!ev) {
      const fav = await store.getFavorite(id);
      if (fav?.snapshot) return json(envelope(env, { item: publicEvent(fav.snapshot), fromFavorite: true }));
      return json({ error: "not found", apiVersion: API_VERSION }, 404);
    }
    const memberIds = await store.getMembers(id);
    const members = [];
    for (const aid of memberIds) {
      const a = await store.getArticle(aid);
      if (a) members.push(a);
    }
    return json(envelope(env, { item: publicEvent(ev), members }));
  }

  if (path === "/api/v1/digest" && req.method === "GET") {
    const snap = await store.getSnapshot("digest:" + beijingYmd());
    const prefs = await store.getPrefs();
    const items = await store.listEvents();
    const digest = snap?.json || {
      date: "",
      tech: selectDigest(items, { prefs }).filter((i) => i.category === "tech"),
      business: selectDigest(items, { prefs }).filter((i) => i.category === "business"),
      public: selectDigest(items, { prefs }).filter((i) => i.category === "public"),
    };
    return json(envelope(env, { digest }));
  }

  if (path === "/api/v1/reads" && req.method === "POST") {
    const body = await req.json();
    await store.setRead(body.eventId, body.read === false ? "" : new Date().toISOString());
    return json(envelope(env, { ok: true, reads: await store.listReads() }));
  }
  if (path === "/api/v1/reads" && req.method === "GET") {
    return json(envelope(env, { reads: await store.listReads() }));
  }

  if (path === "/api/v1/favorites" && req.method === "GET") {
    return json(envelope(env, { items: (await store.listFavorites()).map((f) => f.snapshot || f) }));
  }
  if (path === "/api/v1/favorites" && req.method === "POST") {
    const body = await req.json();
    const ev = (await store.getEvent(body.eventId)) || body.snapshot;
    if (!ev) return json({ error: "not found", apiVersion: API_VERSION }, 404);
    await store.putFavorite(body.eventId || ev.id, { ...ev });
    return json(envelope(env, { ok: true }));
  }
  const favDel = path.match(/^\/api\/v1\/favorites\/([^/]+)$/);
  if (favDel && req.method === "DELETE") {
    await store.deleteFavorite(decodeURIComponent(favDel[1]));
    return json(envelope(env, { ok: true }));
  }

  if (path === "/api/v1/feedback" && req.method === "POST") {
    const body = await req.json();
    if (body.undoId) {
      const prev = await store.getFeedback(body.undoId);
      if (!prev) return json({ error: "not found", apiVersion: API_VERSION }, 404);
      const prefs = undoFeedback(await store.getPrefs(), prev);
      await store.setPrefs(prefs);
      const row = await store.addFeedback({ kind: "undo", undoOf: body.undoId });
      return json(envelope(env, { ok: true, feedback: row, prefs }));
    }
    const row = await store.addFeedback(body);
    const prefs = applyFeedback(await store.getPrefs(), body);
    await store.setPrefs(prefs);
    return json(envelope(env, { ok: true, feedback: row, prefs }));
  }

  if (path === "/api/v1/import" && req.method === "POST") {
    const body = await req.json();
    if (body.kind === "x" || (body.url && /x\.com|twitter\.com/i.test(body.url))) {
      const article = fromManualImport({ url: body.url, excerpt: body.excerpt, title: body.title });
      await store.putArticle(article);
      const cards = cluster([article], { articleEventMap: store.articleEventMap() });
      for (const ev of cards) {
        await store.putEvent(ev);
        await store.setMembers(ev.id, ev.articleIds || []);
        for (const aid of ev.articleIds || []) await store.mapArticleToEvent(aid, ev.id);
      }
      return json(envelope(env, { ok: true, items: cards }));
    }
    const spec = await assertSafeImportUrl(body.url, {
      maxBytes: body.maxBytes,
      timeoutMs: body.timeoutMs,
      lookupImpl: env.lookupImpl,
      fetchImpl: env.fetchImpl,
    });
    const fetched = await fetchImported(spec.url, {
      fetchImpl: env.fetchImpl,
      maxBytes: spec.maxBytes,
      timeoutMs: spec.timeoutMs,
      maxRedirects: spec.maxRedirects,
    });
    const title = stripHtml(body.title || fetched.text).slice(0, 200) || spec.url;
    const summary = extractMainText(fetched.text).slice(0, 2000);
    const article = {
      title,
      url: spec.url,
      source: "import",
      role: "import",
      summary,
      provenance: { kind: "manual-import" },
    };
    article.externalId = spec.url;
    article.id = articleId(article);
    article.articleId = article.id;
    await store.putArticle(article);
    const cards = cluster([article], { articleEventMap: store.articleEventMap() });
    for (const ev of cards) {
      await store.putEvent(ev);
      await store.setMembers(ev.id, ev.articleIds || []);
    }
    return json(envelope(env, { ok: true, items: cards, url: spec.url }));
  }

  if (path === "/api/v1/export" && req.method === "GET") {
    return json(envelope(env, { dump: await store.exportAll() }));
  }
  if (path === "/api/v1/import-backup" && req.method === "POST") {
    const body = await req.json();
    await store.importAll(body.dump || body);
    return json(envelope(env, { ok: true }));
  }

  if (path === "/api/v1/review" && req.method === "GET") {
    const items = selectFeatured(await store.listEvents(), { prefs: await store.getPrefs() });
    const fb = await store.listFeedback();
    const samples = fb.filter((f) => f.kind === "like" || f.kind === "dislike");
    return json(envelope(env, { items: items.slice(0, 40), samples, needed: 30 }));
  }

  return json({ error: "not found", apiVersion: API_VERSION }, 404);
}
