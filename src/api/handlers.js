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
import { ingestAllowed, isPublicApi, otpAuthEnabled, readAuth } from "../access.js";
import { ingestPayload } from "../ingest.js";
import {
  requestCode,
  verifyCode,
  logoutSession,
  logoutAll,
  sessionCookie,
  clearSessionCookie,
  COOKIE,
} from "../auth.js";

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

export function itemMatchesFilters(it, { q, category, source, unread, reads } = {}) {
  if (!it) return false;
  if (q) {
    const blob = [it.title, it.titleZh, it.overviewZh, it.summary].join(" ").toLowerCase();
    if (!blob.includes(String(q).toLowerCase())) return false;
  }
  if (category && it.category !== category) return false;
  if (source) {
    const sources = Array.isArray(it.sources) ? it.sources : [];
    if (it.source !== source && !sources.some((s) => s && s.source === source)) return false;
  }
  if (unread && reads && reads[it.id]) return false;
  return true;
}

function clientIp(req) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "127.0.0.1";
}

function cookieSecure(env) {
  return env.cookieSecure !== false && env.COOKIE_SECURE !== "0";
}

function personalOpts(auth) {
  return { userId: auth.userId || "" };
}

function filtersFromUrl(url) {
  return {
    q: (url.searchParams.get("q") || "").trim().toLowerCase(),
    category: (url.searchParams.get("category") || url.searchParams.get("topic") || "").trim(),
    source: (url.searchParams.get("source") || "").trim(),
    unread: url.searchParams.get("unread") === "1",
  };
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
    const storedBudget = (await store.getBudget()) || {};
    const savedPricing =
      Object.hasOwn(storedBudget, "pricingKnown") || storedBudget.hard === false
        ? { ...storedBudget, pricingKnown: storedBudget.pricingKnown ?? false }
        : undefined;
    const budget = createBudget(storedBudget, new Date(), { pricing: savedPricing });
    const snap = budget.snapshot();
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
        budgetCaps: {
          hard: snap.hard !== false,
          pricingKnown: snap.pricingKnown,
          blockedReason: snap.blockedReason,
        },
      })
    );
  }

  if (path === "/api/v1/auth/request-code" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    await requestCode(
      store,
      { email: body.email, ip: clientIp(req) },
      { ...env, MAIL_API_KEY: env.mailApiKey || env.MAIL_API_KEY, MAIL_FROM: env.mailFrom || env.MAIL_FROM, MAIL_DRIVER: env.mailDriver }
    );
    return json(envelope(env, { ok: true, retryAfterSec: 60 }));
  }
  if (path === "/api/v1/auth/verify" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const result = await verifyCode(store, {
      email: body.email,
      code: body.code,
      userAgent: req.headers.get("user-agent") || "",
      ip: clientIp(req),
    }, env);
    if (!result.ok) return json({ error: "invalid-code", apiVersion: API_VERSION }, 401);
    const headers = {
      "set-cookie": sessionCookie(result.token, { secure: cookieSecure(env) }),
    };
    return json(
      envelope(env, {
        ok: true,
        token: result.token,
        user: { id: result.user.id, email: result.user.email },
        cookie: COOKIE,
      }),
      200,
      headers
    );
  }

  const auth = await readAuth(req, env);
  const ingestPath = path === "/api/v1/ingest";
  if (!auth.ok && isPublicApi(req.method, path)) {
    // news remains readable
  } else if (!auth.ok) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
  if (auth.role === "ingest" && !ingestAllowed(req.method, path)) {
    return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
  }
  if (ingestPath && auth.role !== "ingest" && auth.role !== "local") {
    return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
  }
  const me = personalOpts(auth);
  const needUser = otpAuthEnabled(env) && !auth.userId && auth.role !== "local" && auth.role !== "ingest";
  const personalPath = /^\/api\/v1\/(me|settings|reads|favorites|feedback|import|export|review|sync)/.test(path);
  if (needUser && personalPath) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);

  if (path === "/api/v1/auth/logout" && req.method === "POST") {
    await logoutSession(store, auth.token);
    return json(envelope(env, { ok: true }), 200, { "set-cookie": clearSessionCookie({ secure: cookieSecure(env) }) });
  }
  if (path === "/api/v1/auth/logout-all" && req.method === "POST") {
    if (!auth.userId) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    await logoutAll(store, auth.userId);
    return json(envelope(env, { ok: true }), 200, { "set-cookie": clearSessionCookie({ secure: cookieSecure(env) }) });
  }
  if (path === "/api/v1/me" && req.method === "GET") {
    if (!auth.userId && auth.role !== "local") return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    return json(envelope(env, { user: { id: auth.userId || "local", email: auth.email || "" }, guest: !auth.userId }));
  }
  if (path === "/api/v1/me" && req.method === "DELETE") {
    if (!auth.userId) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    await store.deleteUserData(auth.userId);
    return json(envelope(env, { ok: true }), 200, { "set-cookie": clearSessionCookie({ secure: cookieSecure(env) }) });
  }
  if (path === "/api/v1/sync/merge" && req.method === "POST") {
    if (!auth.userId) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    const body = await req.json().catch(() => ({}));
    const reads = body.reads && typeof body.reads === "object" ? body.reads : {};
    for (const [eventId, at] of Object.entries(reads)) {
      const existing = (await store.listReads(me))[eventId];
      if (!existing && at) await store.setRead(eventId, at, me);
    }
    for (const it of body.favorites || []) {
      const id = it && (it.id || it.eventId);
      if (!id) continue;
      const prev = typeof store.peekFavorite === "function" ? await store.peekFavorite(id, me) : await store.getFavorite(id, me);
      if (it.deleted) {
        await store.deleteFavorite(id, me);
      } else if (prev && prev.deleted) {
        // last delete wins; do not resurrect
      } else if (!prev) {
        await store.putFavorite(id, it.snapshot || it, me);
      }
    }
    if (body.prefs) {
      const cur = await store.getPrefs(me);
      await store.setPrefs({ ...cur, ...body.prefs, blockedSources: body.prefs.blockedSources || cur.blockedSources }, me);
    }
    return json(
      envelope(env, {
        ok: true,
        prefs: await store.getPrefs(me),
        reads: await store.listReads(me),
        favorites: await store.listFavorites(me),
      })
    );
  }
  if (path === "/api/v1/admin/migrate-legacy" && req.method === "POST") {
    if (auth.role !== "ingest" && auth.role !== "local") return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
    const body = await req.json().catch(() => ({}));
    const email = String(body.email || env.legacyOwnerEmail || "").toLowerCase();
    if (!email) return json({ error: "email-required", apiVersion: API_VERSION }, 400);
    let user = await store.getUserByEmail(email);
    if (!user) user = await store.putUser({ id: "usr:legacy", email, createdAt: new Date().toISOString() });
    await store.migrateLegacyToUser(user.id);
    return json(envelope(env, { ok: true, userId: user.id, email: user.email }));
  }

  if (req.method === "POST" && ingestPath) {
    const body = await req.json();
    const result = await ingestPayload(store, body);
    return json(envelope(env, { ok: true, count: result.count, snapshotAt: result.snapshotAt }));
  }

  if (path === "/api/v1/status" && req.method === "GET") {
    const health = await store.listSourceHealth();
    const notes = await store.listNotifications();
    const storedBudget = (await store.getBudget()) || {};
    // Collector pricing is authoritative; Workers need not have model credentials.
    const savedPricing = Object.hasOwn(storedBudget, "pricingKnown") || storedBudget.hard === false
      ? { ...storedBudget, pricingKnown: storedBudget.pricingKnown ?? false }
      : undefined;
    const budget = createBudget(storedBudget, new Date(), { pricing: savedPricing });
    const events = await store.listEvents();
    const last = await store.getSnapshot("events");
    const failedCollect = health.length > 0 && health.every((h) => h.ok === false);
    return json(
      envelope(env, {
        sources: health,
        catalog: SOURCE_CATALOG,
        notifications: notes.slice(-20),
        budget: budget.snapshot(),
        budgetCaps: {
          monthlyCny: MONTHLY_CNY,
          dailyCny: DAILY_CNY,
          hard: budget.snapshot().hard !== false,
          pricingKnown: budget.snapshot().pricingKnown,
          blockedReason: budget.snapshot().blockedReason,
        },
        eventCount: events.length,
        lastSnapshotAt: last?.at || null,
        emptyMeansFailure: failedCollect,
        x: xSubscriptionStatus(env.env || process.env),
        instantNotifyEnabled: (await store.getPrefs(me)).instantNotifyEnabled,
      })
    );
  }

  if (path === "/api/v1/settings" && req.method === "GET") {
    return json(envelope(env, { prefs: await store.getPrefs(me) }));
  }
  if (path === "/api/v1/settings" && (req.method === "PUT" || req.method === "POST")) {
    const body = await req.json();
    const prefs = await store.setPrefs(normalizePrefs({ ...(await store.getPrefs(me)), ...body }), me);
    return json(envelope(env, { prefs }));
  }

  if (path === "/api/v1/events" && req.method === "GET") {
    const view = url.searchParams.get("view") || "featured";
    const filters = filtersFromUrl(url);
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30));
    const sitePrefs = await store.getPrefs();
    const userPrefs = await store.getPrefs(me);
    let items = await store.listEvents();
    const reads = filters.unread ? await store.listReads(me) : {};
    items = items.filter((it) => itemMatchesFilters(it, { ...filters, reads }));
    const now = new Date();
    if (view === "latest") items = selectLatest(items, { now, prefs: sitePrefs });
    else if (view === "digest") {
      const snap = await store.getSnapshot("digest:" + beijingYmd());
      items = (snap && snap.json && Array.isArray(snap.json.items) ? snap.json.items : []).filter((it) =>
        itemMatchesFilters(it, { ...filters, reads })
      );
    } else items = selectFeatured(items, { now, prefs: sitePrefs });
    items = items.filter(
      (it) =>
        !(userPrefs.blockedSources || []).includes(it.source) &&
        !(userPrefs.hiddenEventIds || []).includes(it.id)
    );
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
      const fav = await store.getFavorite(id, me);
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
    const digest = snap?.json || {
      date: beijingYmd(),
      tech: [],
      business: [],
      public: [],
      items: [],
      missing: true,
    };
    const filters = filtersFromUrl(url);
    const reads = filters.unread ? await store.listReads(me) : {};
    const keep = (it) => itemMatchesFilters(it, { ...filters, reads });
    return json(
      envelope(env, {
        digest: {
          ...digest,
          items: (digest.items || []).filter(keep),
          tech: (digest.tech || []).filter(keep),
          business: (digest.business || []).filter(keep),
          public: (digest.public || []).filter(keep),
        },
      })
    );
  }

  if (path === "/api/v1/reads" && req.method === "POST") {
    const body = await req.json();
    await store.setRead(body.eventId, body.read === false ? "" : new Date().toISOString(), me);
    return json(envelope(env, { ok: true, reads: await store.listReads(me) }));
  }
  if (path === "/api/v1/reads" && req.method === "GET") {
    return json(envelope(env, { reads: await store.listReads(me) }));
  }

  if (path === "/api/v1/favorites" && req.method === "GET") {
    const filters = filtersFromUrl(url);
    const reads = filters.unread ? await store.listReads(me) : {};
    const items = (await store.listFavorites(me))
      .map((f) => f.snapshot || f)
      .filter((it) => itemMatchesFilters(it, { ...filters, reads }));
    return json(envelope(env, { items }));
  }
  if (path === "/api/v1/favorites" && req.method === "POST") {
    const body = await req.json();
    const ev = (await store.getEvent(body.eventId)) || body.snapshot;
    if (!ev) return json({ error: "not found", apiVersion: API_VERSION }, 404);
    const row = await store.putFavorite(body.eventId || ev.id, { ...ev }, me);
    return json(envelope(env, { ok: true, rev: row && row.rev }));
  }
  const favDel = path.match(/^\/api\/v1\/favorites\/([^/]+)$/);
  if (favDel && req.method === "DELETE") {
    const row = await store.deleteFavorite(decodeURIComponent(favDel[1]), me);
    return json(envelope(env, { ok: true, rev: row && row.rev }));
  }

  if (path === "/api/v1/feedback" && req.method === "POST") {
    const body = await req.json();
    if (body.undoId) {
      const prev = await store.getFeedback(body.undoId, me);
      if (!prev) return json({ error: "not found", apiVersion: API_VERSION }, 404);
      const prefs = undoFeedback(await store.getPrefs(me), prev);
      await store.setPrefs(prefs, me);
      const row = await store.addFeedback({ kind: "undo", undoOf: body.undoId }, me);
      return json(envelope(env, { ok: true, feedback: row, prefs }));
    }
    const row = await store.addFeedback(body, me);
    const prefs = applyFeedback(await store.getPrefs(me), body);
    await store.setPrefs(prefs, me);
    return json(envelope(env, { ok: true, feedback: row, prefs }));
  }

  if (path === "/api/v1/import" && req.method === "POST") {
    const body = await req.json();
    if (body.kind === "x" || (body.url && /x\.com|twitter\.com/i.test(body.url))) {
      const article = fromManualImport({ url: body.url, excerpt: body.excerpt, title: body.title });
      const existingId =
        typeof store.eventIdForArticle === "function"
          ? await store.eventIdForArticle(article.id)
          : store.articleEventMap().get(article.id);
      if (existingId) {
        const ev = await store.getEvent(existingId);
        return json(envelope(env, { ok: true, items: ev ? [ev] : [], reused: true }));
      }
      await store.putArticle(article);
      const map =
        typeof store.loadArticleEventMap === "function"
          ? await store.loadArticleEventMap()
          : store.articleEventMap();
      const cards = cluster([article], { articleEventMap: map });
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
    const map =
      typeof store.loadArticleEventMap === "function"
        ? await store.loadArticleEventMap()
        : store.articleEventMap();
    const cards = cluster([article], { articleEventMap: map });
    for (const ev of cards) {
      await store.putEvent(ev);
      await store.setMembers(ev.id, ev.articleIds || []);
    }
    return json(envelope(env, { ok: true, items: cards, url: spec.url }));
  }

  if (path === "/api/v1/me/export" && req.method === "GET") {
    if (!auth.userId && auth.role !== "local") return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    return json(envelope(env, { dump: await store.exportUser(auth.userId || "") }));
  }
  if (path === "/api/v1/export" && req.method === "GET") {
    if (otpAuthEnabled(env) && auth.role !== "ingest" && auth.role !== "local") {
      return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
    }
    return json(envelope(env, { dump: await store.exportAll() }));
  }
  if (path === "/api/v1/import-backup" && req.method === "POST") {
    const body = await req.json();
    await store.importAll(body.dump || body);
    return json(envelope(env, { ok: true }));
  }

  if (path === "/api/v1/review" && req.method === "GET") {
    const items = selectFeatured(await store.listEvents(), { prefs: await store.getPrefs() });
    const fb = await store.listFeedback(me);
    const samples = fb.filter((f) => f.kind === "like" || f.kind === "dislike");
    return json(envelope(env, { items: items.slice(0, 40), samples, needed: 30 }));
  }

  return json({ error: "not found", apiVersion: API_VERSION }, 404);
}
