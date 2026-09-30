import { mailConfig } from "../mail.js";
import { selectFeatured, selectLatest, selectDigest, applyPrefs } from "../select.js";
import { applyFeedback, undoFeedback, normalizePrefs } from "../prefs.js";
import { assertSafeImportUrl, fetchImported } from "../ssrf.js";
import { fromManualImport, xSubscriptionStatus } from "../x.js";
import { stripHtml, extractMainText } from "../html.js";
import { articleId } from "../identity.js";
import { SOURCE_CATALOG, isOpensourceSource, REPO_OBSERVATION_WINDOW_MS } from "../catalog.js";
import { createBudget, MONTHLY_CNY, DAILY_CNY } from "../budget.js";
import { beijingYmd, isValidCalendarDate } from "../time.js";
import { ingestAllowed, isPublicApi, otpAuthEnabled, readAuth } from "../access.js";
import {
  readerCatalog,
  normalizeReader,
  effectiveSources,
  readerAllowed,
  sortReaderItems,
  guestEffectiveSources,
  READER_SOURCE_IDS,
} from "../reader.js";
import { ingestPayload } from "../ingest.js";
import { schedulerStatus } from "../scheduler.js";
import {
  requestCode,
  loginPassword,
  resetPassword,
  verifyCode,
  logoutSession,
  logoutAll,
  purgeAuthArtifacts,
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
    const decoded = JSON.parse(txt);
    return Number.isSafeInteger(decoded?.o) && decoded.o >= 0 ? { o: decoded.o } : { o: 0 };
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

/**
 * Site-wide admin for destructive endpoints: local dev, or the operator's
 * Cloudflare Access identity. The ingest credential is deliberately NOT admin
 * (it is held by the collector and can only POST /api/v1/ingest).
 */
function isSiteAdmin(auth, env) {
  if (auth.role === "local") return true;
  const allowed = String(env.allowedEmail || "").trim().toLowerCase();
  return Boolean(
    allowed && auth.role === "user" && !auth.userId && auth.email === allowed
  );
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
  // Browser login/reset requests must come from this site. Native clients do
  // not send Origin; foreign browser forms must not plant an attacker session.
  const origin = req.headers.get("origin");
  if (req.method === "POST" && path.startsWith("/api/v1/auth/") && origin && origin !== url.origin) {
    return json({ error: "forbidden-origin", apiVersion: API_VERSION }, 403);
  }
  const store = env.store;
  // Metadata-only read: every response needs just the timestamp, not the
  // full events snapshot JSON.
  const snapshotAt =
    (typeof store.getSnapshotAt === "function"
      ? await store.getSnapshotAt("events")
      : (await store.getSnapshot("events"))?.at) || new Date().toISOString();
  env.snapshotAt = snapshotAt;

  if (path === "/api/v1/health" || path === "/api/v1/status/public") {
    const health = await store.listSourceHealth();
    const storedBudget = (await store.getBudget()) || {};
    const savedPricing =
      Object.hasOwn(storedBudget, "pricingKnown") || storedBudget.hard === false
        ? { ...storedBudget, pricingKnown: storedBudget.pricingKnown ?? false }
        : undefined;
    const budget = createBudget(storedBudget, new Date(), { pricing: savedPricing, dailyCandidateCap: storedBudget.dailyCandidateCap });
    const snap = budget.snapshot();
    return json(
      envelope(env, {
        ok: true,
        x: xSubscriptionStatus(env.env || process.env),
        sources: health.map((h) => ({
          source: h.source,
          ok: h.ok,
          purpose: h.purpose,
          warnings: h.warnings || [],
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
    const sent = await requestCode(
      store,
      { email: body.email, ip: clientIp(req) },
      { ...env, MAIL_API_KEY: env.mailApiKey || env.MAIL_API_KEY, MAIL_FROM: env.mailFrom || env.MAIL_FROM, MAIL_DRIVER: env.mailDriver }
    );
    // `delivery` must depend only on the global mail configuration, never on the
    // email address, or it becomes an account-enumeration oracle. Limited or
    // resend-throttled requests keep the generic "sent" answer.
    const mail = mailConfig({ ...env, MAIL_API_KEY: env.mailApiKey || env.MAIL_API_KEY, MAIL_FROM: env.mailFrom || env.MAIL_FROM, MAIL_DRIVER: env.mailDriver || env.MAIL_DRIVER });
    let delivery = "sent";
    if (otpAuthEnabled(env) && (mail.driver === "log" || !mail.apiKey)) {
      delivery = "unavailable";
    } else if (sent.mailError) {
      console.error("otp mail delivery failed for request");
      delivery = "unavailable";
    } else if (sent.skipped && otpAuthEnabled(env)) {
      console.error("otp mail driver is not configured in production mode");
      delivery = "unavailable";
    }
    return json(envelope(env, { ok: true, retryAfterSec: 60, delivery }));
  }
  if (["/api/v1/auth/login", "/api/v1/auth/password-reset"].includes(path) && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const input = { email: body.email, password: body.password, code: body.code, ip: clientIp(req), userAgent: req.headers.get("user-agent") || "" };
    const result = path.endsWith("/login") ? await loginPassword(store, input) : await resetPassword(store, input, env);
    if (!result.ok) {
      const status = result.error === "rate-limited" ? 429 : result.error === "invalid-password" ? 400 : 401;
      return json({ error: result.error, apiVersion: API_VERSION, ...(status === 429 ? { retryAfterSec: 900 } : {}) }, status);
    }
    return json(envelope(env, { ok: true, token: result.token, user: { id: result.user.id, email: result.user.email } }), 200,
      { "set-cookie": sessionCookie(result.token, { secure: cookieSecure(env) }) });
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
  // reader 路径不进 needUser 网关：GET 必须公开（未登录返回默认值），
  // PUT 由各 handler 自带的 auth.userId 强校验把关。
  const personalPath = /^\/api\/v1\/(me|settings|reads|favorites|feedback|import|export|review|sync)/.test(path);
  if (needUser && personalPath) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);

  // ---- 个人订阅（阅读器）----
  // GET 公开：目录对所有人可见（iOS 首启引导也需要）；PUT 只允许真实
  // 登录账户（auth.userId）写自己的 prefs，guest/local/site-admin 都不能
  // 写全局。
  if (path === "/api/v1/reader/catalog" && req.method === "GET") {
    return json(envelope(env, { sources: readerCatalog() }));
  }
  if (path === "/api/v1/reader/settings" && req.method === "GET") {
    const reader = auth.userId
      ? normalizeReader((await store.getPrefs(me)).reader)
      : normalizeReader(null);
    return json(envelope(env, { reader }));
  }
  if (path === "/api/v1/reader/settings" && (req.method === "PUT" || req.method === "POST")) {
    if (!auth.userId) return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    const body = await req.json().catch(() => ({}));
    const next = {};
    if (Object.prototype.hasOwnProperty.call(body, "selectedSources")) {
      if (!Array.isArray(body.selectedSources)) {
        return json({ error: "invalid selectedSources", apiVersion: API_VERSION }, 400);
      }
      // 严格字符串校验：任意对象不允许经 String() 变形混入。
      if (body.selectedSources.some((s) => typeof s !== "string")) {
        return json({ error: "invalid source id", apiVersion: API_VERSION }, 400);
      }
      const ids = [...new Set(body.selectedSources)];
      if (ids.some((id) => !READER_SOURCE_IDS.has(id))) {
        return json({ error: "invalid source id", apiVersion: API_VERSION }, 400);
      }
      next.selectedSources = ids;
    }
    if (Object.prototype.hasOwnProperty.call(body, "moreSourcesEnabled")) {
      if (typeof body.moreSourcesEnabled !== "boolean") {
        return json({ error: "invalid moreSourcesEnabled", apiVersion: API_VERSION }, 400);
      }
      next.moreSourcesEnabled = body.moreSourcesEnabled;
    }
    const saved = { ...next, configured: true };
    const prefs = await store.setReaderPrefs(saved, me);
    return json(envelope(env, { ok: true, reader: normalizeReader(prefs.reader) }));
  }

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
      // reader 是 /api/v1/reader/settings 的专属字段；merge/同步不得越权
      // 注入另一个上下文的订阅配置。
      const incoming = { ...body.prefs };
      delete incoming.reader;
      await store.setPrefs({ ...cur, ...incoming, blockedSources: incoming.blockedSources || cur.blockedSources }, me);
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
    // Collector cadence doubles as housekeeping for expired auth rows.
    await purgeAuthArtifacts(store);
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
    const budget = createBudget(storedBudget, new Date(), { pricing: savedPricing, dailyCandidateCap: storedBudget.dailyCandidateCap });
    const last = await store.getSnapshot("events");
    const failedCollect = health.length > 0 && health.every((h) => h.ok === false);
    const eventCount =
      typeof store.countEvents === "function"
        ? await store.countEvents()
        : (await store.listEvents()).length;
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
        eventCount,
        lastSnapshotAt: last?.at || null,
        diagnostics: last?.json?.diagnostics || null,
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
    // 通用设置通道不允许写 reader 订阅对象（只能经 /api/v1/reader/settings
    // 的白名单校验路径），防止 guest/merge 之外的旁路注入。
    delete body.reader;
    const prefs = await store.setPrefs(normalizePrefs({ ...(await store.getPrefs(me)), ...body }), me);
    return json(envelope(env, { prefs }));
  }

  if (path === "/api/v1/events" && req.method === "GET") {
    const view = url.searchParams.get("view") || "featured";
    const filters = filtersFromUrl(url);
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const limit = Math.floor(Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 30)));
    const sitePrefs = view === "reader" ? {} : await store.getPrefs();
    const userPrefs = auth.userId ? await store.getPrefs(me) : sitePrefs;
    const now = new Date();
    const reads = filters.unread ? await store.listReads(me) : {};
    const matchFilters = (it) => itemMatchesFilters(it, { ...filters, reads });
    let items;
    let windowed = false;

    if (view === "reader") {
      // 个人订阅流：登录用账户已存的有效来源；游客用 query sources=（仅
      // 基础集，缺省空集→空结果，不回退全站）。分支优先：绝不加载全表。
      // 来源集合 + hidden 排除在 SQL 以索引列谓词下推为轻量元数据索引
      // （不搬运 JSON 大对象）；URL 安全性、文本过滤与 repo observedAt
      // 排序在索引上精确执行（语义与旧全量路径一致，含并列 id 次序与
      // total 计数），最后仅按页取回完整事件行 —— 有界分页。
      const effective = auth.userId
        ? effectiveSources(normalizeReader(userPrefs.reader))
        : guestEffectiveSources(url.searchParams.get("sources"));
      const index =
        typeof store.readerIndex === "function"
          ? await store.readerIndex({ sources: effective })
          : await store.listEvents();
      const sorted = sortReaderItems(
        index
          .filter(matchFilters)
          .filter((it) => readerAllowed(it, effective))
      );
      const total = sorted.length;
      const start = cursor.o || 0;
      const pageIds = sorted.slice(start, start + limit).map((it) => it.id);
      const rows = pageIds.length
        ? (typeof store.getEventsByIds === "function"
          ? await store.getEventsByIds(pageIds)
          : (await store.listEvents()).filter((it) => pageIds.includes(it.id)))
        : [];
      const byId = new Map(rows.map((it) => [it.id, it]));
      const page = pageIds.map((id) => byId.get(id))
        .filter((it) => it && readerAllowed(it, effective) && matchFilters(it));
      // Advance over requested IDs even if an event was deleted/changed while
      // this isolate's metadata cache was warm; never repeat the same cursor.
      const next = start + pageIds.length < total ? encodeCursor({ o: start + pageIds.length }) : null;
      return json(
        envelope(env, {
          view,
          reader: true,
          items: page.map(publicEvent),
          cursor: next,
          total,
          windowed,
        })
      );
    }

    if (view === "latest") {
      const index = typeof store.feedIndex === "function"
        ? await store.feedIndex() : await store.listEvents();
      items = selectLatest(index.filter(matchFilters), { now, prefs: sitePrefs });
    } else if (view === "opensource") {
      // Lightweight project browsing entry ordered by the LATEST OBSERVATION
      // (githubRepo.observedAt, falling back to firstSeenAt for payloads
      // without repo metadata) — deliberately separate from news publishedAt.
      // Projects not observed within the window drop out of the entry.
      const lastObserved = (it) =>
        Date.parse(it.githubRepo?.observedAt || it.observedAt || it.firstSeenAt || it.seenAt || "") || 0;
      const index = typeof store.feedIndex === "function"
        ? await store.feedIndex() : await store.listEvents();
      items = index.filter(matchFilters);
      items = applyPrefs(items, sitePrefs)
        .filter((it) => it.category !== "hidden")
        .filter((it) => it.githubRepo || isOpensourceSource(it.source))
        .filter((it) => {
          const t = lastObserved(it);
          return !t || (t <= now.getTime() + 300000 && now.getTime() - t <= REPO_OBSERVATION_WINDOW_MS);
        })
        .sort((a, b) => lastObserved(b) - lastObserved(a));
    } else if (view === "digest") {
      // Digest items come from the digest snapshot; the events table is not
      // touched at all for this view.
      const snap = await store.getSnapshot("digest:" + beijingYmd());
      items = (snap && snap.json && Array.isArray(snap.json.items) ? snap.json.items : []).filter((it) =>
        itemMatchesFilters(it, { ...filters, reads })
      );
    } else {
      const featuredIds =
        typeof store.getFeaturedIds === "function"
          ? await store.getFeaturedIds()
          : (await store.getSnapshot("events"))?.json?.featured;
      if (Array.isArray(featuredIds)) {
        // Featured snapshot already pins the curated ID list: fetch exactly
        // those rows (bounded IN queries / cache) and apply the same
        // q/category/source/unread filters before selection — no full-table
        // read, same order and same curated pool as the legacy path.
        const rows =
          typeof store.getEventsByIds === "function"
            ? await store.getEventsByIds(featuredIds)
            : (await store.listEvents()).filter((it) => featuredIds.includes(it.id) && matchFilters(it));
        const matched = rows.filter(matchFilters);
        const byId = new Map(matched.map((it) => [it.id, it]));
        items = selectFeatured(featuredIds.map((id) => byId.get(id)).filter(Boolean), { now, prefs: sitePrefs });
      } else {
        items = selectFeatured((await store.listEvents()).filter(matchFilters), { now, prefs: sitePrefs });
      }
    }
    // 订阅流是独立的来源选择字段，不再叠加旧 blockedSources/hiddenEventIds
    // 过滤（否则网页旧设置关掉过的来源会让 iOS 新订阅显示为空）。
    // 旧视图行为保持不变。
    if (view !== "reader") {
      items = items.filter(
        (it) =>
          !(userPrefs.blockedSources || []).includes(it.source) &&
          !(userPrefs.hiddenEventIds || []).includes(it.id)
      );
    }
    const start = cursor.o || 0;
    const slice = items.slice(start, start + limit);
    let page = slice;
    if ((view === "latest" || view === "opensource") && typeof store.getEventsByIds === "function") {
      const rows = await store.getEventsByIds(slice.map((it) => it.id));
      const byId = new Map(rows.map((it) => [it.id, it]));
      page = slice.map((it) => byId.get(it.id)).filter(Boolean);
      page = applyPrefs(page.filter(matchFilters), sitePrefs).filter((it) =>
        !(userPrefs.blockedSources || []).includes(it.source) &&
        !(userPrefs.hiddenEventIds || []).includes(it.id));
    }
    const next = start + slice.length < items.length ? encodeCursor({ o: start + slice.length }) : null;
    return json(
      envelope(env, {
        view,
        ...(view === "reader" ? { reader: true } : {}),
        items: page.map(publicEvent),
        cursor: next,
        total: items.length,
        windowed,
      })
    );
  }

  const eventMatch = path.match(/^\/api\/v1\/events\/([^/]+)$/);
  if (eventMatch && req.method === "GET") {
    const id = decodeURIComponent(eventMatch[1]);
    const ev = await store.getEvent(id);
    if (url.searchParams.get("reader") === "1") {
      // 订阅模式详情：与 view=reader 同一有效来源规则；仅当前登录账户
      // （auth.userId）自己的收藏快照可读。guest/local 没有 userId，不能
      // 借站点全局 favorites 兜底读取他人私人快照。未选来源 / 无安全原文
      // 链接 → 404，不回退普通详情。
      const userPrefs = await store.getPrefs(me);
      const effective = auth.userId
        ? effectiveSources(normalizeReader(userPrefs.reader))
        : guestEffectiveSources(url.searchParams.get("sources"));
      if (!ev || !readerAllowed(ev, effective)) {
        if (auth.userId) {
          const fav = await store.getFavorite(id, me);
          if (fav?.snapshot) return json(envelope(env, { item: publicEvent(fav.snapshot), fromFavorite: true }));
        }
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
    const requestedDate = url.searchParams.get("date");
    if (requestedDate && !isValidCalendarDate(requestedDate)) {
      return json({ error: "invalid digest date", apiVersion: API_VERSION }, 400);
    }
    const digestDate = requestedDate || beijingYmd();
    const snap = await store.getSnapshot("digest:" + digestDate);
    const digest = snap?.json || {
      date: digestDate,
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

  if (path === "/api/v1/scheduler/status" && req.method === "GET") {
    // Auth-gated (not in isPublicApi): scheduler state and credential
    // health are operational, not reader-facing.
    const status = await schedulerStatus(store, { now: new Date(), env: env.env || process.env });
    return json(envelope(env, status));
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
    // Personal "save a link". Imported content is scoped to the requesting
    // account as a favorite snapshot; it must never enter the public event or
    // article tables, otherwise any registered user could pollute the feed.
    const body = await req.json();
    let card;
    if (body.kind === "x" || (body.url && /x\.com|twitter\.com/i.test(body.url))) {
      const article = fromManualImport({ url: body.url, excerpt: body.excerpt, title: body.title });
      card = { ...article, provenance: { kind: "manual-import" } };
    } else {
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
      const summary = body.excerpt
        ? String(body.excerpt).slice(0, 2000)
        : extractMainText(fetched.text).slice(0, 2000);
      const article = {
        title,
        url: spec.url,
        source: "import",
        role: "import",
        summary,
        publishedAt: new Date().toISOString(),
        provenance: { kind: "manual-import" },
      };
      article.externalId = spec.url;
      article.id = articleId(article);
      article.articleId = article.id;
      card = article;
    }
    await store.putFavorite(card.id, card, me);
    return json(envelope(env, { ok: true, items: [publicEvent(card)], private: true, reused: false }));
  }

  if (path === "/api/v1/me/export" && req.method === "GET") {
    if (!auth.userId && auth.role !== "local") return json({ error: "unauthorized", apiVersion: API_VERSION }, 401);
    return json(envelope(env, { dump: await store.exportUser(auth.userId || "") }));
  }
  if (path === "/api/v1/export" && req.method === "GET") {
    if (!isSiteAdmin(auth, env)) {
      return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
    }
    return json(envelope(env, { dump: await store.exportAll() }));
  }
  if (path === "/api/v1/import-backup" && req.method === "POST") {
    // Whole-site restore runs importAll, which DELETEs site tables first.
    // Default-deny: only local dev or the operator's Access identity may call.
    if (!isSiteAdmin(auth, env)) {
      return json({ error: "forbidden", apiVersion: API_VERSION }, 403);
    }
    const body = await req.json();
    await store.importAll(body.dump || body);
    return json(envelope(env, { ok: true }));
  }

  if (path === "/api/v1/review" && req.method === "GET") {
    // Same curated pool as the featured view: pinned IDs from the events
    // snapshot (metadata projection), fetched directly — no full-table read.
    const featuredIds =
      typeof store.getFeaturedIds === "function"
        ? await store.getFeaturedIds()
        : (await store.getSnapshot("events"))?.json?.featured;
    const candidates =
      Array.isArray(featuredIds) && typeof store.getEventsByIds === "function"
        ? await store.getEventsByIds(featuredIds)
        : await store.listEvents();
    const items = selectFeatured(candidates, { prefs: await store.getPrefs() });
    const fb = await store.listFeedback(me);
    const samples = fb.filter((f) => f.kind === "like" || f.kind === "dislike");
    return json(envelope(env, { items: items.slice(0, 40), samples, needed: 30 }));
  }

  return json({ error: "not found", apiVersion: API_VERSION }, 404);
}
