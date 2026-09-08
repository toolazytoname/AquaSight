import { cluster } from "./cluster.js";
import { selectFeatured, selectDigest, selectLatest, selectByQuota } from "./select.js";
import { DAILY_CANDIDATE_CAP, createBudget, resolvePricing } from "./budget.js";
import { enrichItems } from "./enrich.js";
import { notifyInstant, notifyDigest } from "./notify.js";
import { defaultSiteUrl } from "./bark.js";
import { eventsPayload, publicItem } from "./compat.js";
import { withLock } from "./lock.js";
import { SOURCE_CATALOG, sourceMeta } from "./catalog.js";
import { fetchHN } from "./sources/hn.js";
import { fetchGitHub } from "./sources/github.js";
import { fetch36krArticles, fetch36krFlash } from "./sources/kr36.js";
import { fetchWeibo, fetchBaidu, fetchToutiao } from "./sources/hot.js";
import { fetchIthome } from "./sources/ithome.js";
import { fetchQbitai } from "./sources/qbitai.js";
import { fetchV2ex } from "./sources/v2ex.js";
import { fetchWallstreetcn } from "./sources/wallstreetcn.js";
import { fetchTechcrunch } from "./sources/techcrunch.js";
import { fetchBbc } from "./sources/bbc.js";
import { fetchVerge } from "./sources/verge.js";
import { fetchOpenai } from "./sources/openai.js";
import { fromHnCitation } from "./x.js";
import { extractMainText } from "./html.js";
import { getText } from "./http.js";
import { articleId } from "./identity.js";
import { beijingParts, beijingYmd } from "./time.js";
import { normalizePrefs } from "./prefs.js";

export const SOURCES = [
  ["hn", fetchHN],
  ["github", fetchGitHub],
  ["36kr", fetch36krArticles],
  ["36kr-flash", fetch36krFlash],
  ["weibo", fetchWeibo],
  ["baidu", fetchBaidu],
  ["toutiao", fetchToutiao],
  ["ithome", fetchIthome],
  ["qbitai", fetchQbitai],
  ["v2ex", fetchV2ex],
  ["wallstreetcn", fetchWallstreetcn],
  ["techcrunch", fetchTechcrunch],
  ["bbc", fetchBbc],
  ["verge", fetchVerge],
  ["openai", fetchOpenai],
];

export function stampSeenAt(raw, now = new Date()) {
  const iso = now.toISOString();
  return (raw || []).map((it) => {
    if (!it) return it;
    if (it.publishedAt || it.seenAt || it.firstSeenAt) {
      return { ...it, firstSeenAt: it.firstSeenAt || it.seenAt || iso };
    }
    return { ...it, seenAt: iso, firstSeenAt: iso };
  });
}

async function persistArticles(store, articles) {
  if (!store) return;
  for (const a of articles) {
    const id = a.articleId || articleId(a);
    const prev = await store.getArticle(id);
    const firstSeenAt = prev?.firstSeenAt || a.firstSeenAt || a.seenAt;
    await store.putArticle({ ...a, id, articleId: id, firstSeenAt });
    a.firstSeenAt = firstSeenAt;
    a.articleId = id;
    a.id = a.id || id;
  }
}

export async function decorateCards(raw, opts = {}) {
  const now = opts.now || new Date();
  const store = opts.store;
  const articles = stampSeenAt(raw || [], now);
  await persistArticles(store, articles);
  const extra = [];
  for (const a of articles) {
    if (a.source === "hn") {
      const cited = fromHnCitation(a);
      if (cited) extra.push(cited);
    }
  }
  const all = articles.concat(extra);
  let map = opts.articleEventMap || new Map();
  if (store && typeof store.loadArticleEventMap === "function") {
    map = await store.loadArticleEventMap();
  } else if (store && typeof store.articleEventMap === "function") {
    map = store.articleEventMap();
  }
  const items = cluster(all, { now, articleEventMap: map });
  if (store) {
    for (const [articleIdKey, eventId] of map.entries()) {
      await store.mapArticleToEvent(articleIdKey, eventId);
    }
    for (const ev of items) {
      await store.putEvent(ev);
      await store.setMembers(ev.id, ev.articleIds || ev.memberIds || []);
    }
  }
  const prefs = opts.prefs || (store ? await store.getPrefs() : {});
  const shouldEnrich =
    opts.enrich === true ||
    (opts.enrich !== false && Boolean(opts.apiKey || process.env.XAI_API_KEY));
  const pool = selectByQuota(items, {
    now,
    prefs,
    limit: Math.min(100, DAILY_CANDIDATE_CAP),
    quota: { tech: 60, business: 30, public: 10 },
    dropClueOnly: true,
  });
  let working = pool;
  if (shouldEnrich && opts.extractBody !== false) {
    working = await extractFeaturedBodies(pool, opts);
  }
  let enriched = working;
  if (shouldEnrich) {
    const cache = opts.enrichCache || {};
    if (store) {
      for (const it of working) {
        const hit = await store.getCache("event-enrich:" + it.id);
        if (hit) cache[hit.cacheKey || it.id] = hit;
      }
    }
    const budgetState = opts.budgetState || (store ? await store.getBudget() : null);
    const pricing = resolvePricing({ baseUrl: opts.baseUrl, model: opts.model });
    const budget = createBudget(budgetState || {}, now, {
      persist: store ? (snap) => store.setBudget(snap) : undefined,
      pricing,
    });
    enriched = await enrichItems(working, {
      fetchImpl: opts.fetchImpl,
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl,
      model: opts.model,
      cache,
      budget,
      now,
    });
    if (store) {
      await store.setBudget(budget.snapshot());
      for (const it of enriched) {
        if (it.enrich) await store.putCache("event-enrich:" + it.id, it.enrich);
        await store.putEvent(it);
      }
    }
  }
  const byId = new Map(items.map((it) => [it.id, it]));
  for (const it of enriched) byId.set(it.id, it);
  const merged = items.map((it) => byId.get(it.id) || it);
  merged.featured = selectFeatured(merged, { now, prefs });
  merged.prefs = prefs;
  return merged;
}

async function fetchSources(opts = {}) {
  const sourceErrors = [];
  const sourceHealth = [];
  const raw = [];
  const list = opts.sources || SOURCES;
  const nowIso = new Date().toISOString();
  const settled = await Promise.allSettled(
    list.map(async ([name, fn]) => ({ name, items: await fn() }))
  );
  for (let i = 0; i < settled.length; i++) {
    const name = list[i][0];
    const meta = sourceMeta(name);
    const result = settled[i];
    if (result.status === "rejected") {
      const e = result.reason;
      const row = {
        source: name,
        message: e && e.message ? e.message : String(e),
        purpose: meta.purpose,
        role: meta.role,
        ok: false,
        lastAttemptAt: nowIso,
      };
      sourceErrors.push(row);
      sourceHealth.push(row);
      continue;
    }
    const items = result.value.items;
    if (!items.length) {
      const row = {
        source: name,
        message: "empty",
        purpose: meta.purpose,
        role: meta.role,
        ok: false,
        lastAttemptAt: nowIso,
      };
      sourceErrors.push(row);
      sourceHealth.push(row);
      continue;
    }
    raw.push(...items);
    sourceHealth.push({
      source: name,
      purpose: meta.purpose,
      role: meta.role,
      ok: true,
      lastSuccessAt: nowIso,
      lastAttemptAt: nowIso,
      count: items.length,
    });
  }
  return { raw, sourceErrors, sourceHealth };
}

export async function extractFeaturedBodies(featured, opts = {}) {
  const fetchImpl = opts.fetchImpl;
  if (!fetchImpl && typeof fetch !== "function") return featured;
  const out = [];
  for (const ev of featured || []) {
    const next = { ...ev };
    if (next.summary && next.summary.length >= 80) {
      out.push(next);
      continue;
    }
    const url = next.url;
    if (!url || !/^https?:/i.test(url)) {
      out.push(next);
      continue;
    }
    try {
      const { text } = await getText(url, { timeoutMs: 8000 });
      const body = extractMainText(text);
      if (body) next.body = body.slice(0, 8000);
    } catch {
      // keep original readable fields
    }
    out.push(next);
  }
  return out;
}

export async function collectOnce(opts = {}) {
  const store = opts.store;
  const run = async () => {
    const fetched = opts.raw
      ? { raw: opts.raw, sourceErrors: opts.sourceErrors || [], sourceHealth: opts.sourceHealth || [] }
      : await fetchSources(opts);
    const decorated = await decorateCards(fetched.raw, opts);
    const items = Array.isArray(decorated) ? decorated : decorated.items;
    const featured = decorated.featured || selectFeatured(items, { now: opts.now || new Date(), prefs: decorated.prefs });
    const prefs = decorated.prefs || {};
    const now = opts.now || new Date();
    const payload = eventsPayload({
      items,
      featured,
      sourceErrors: fetched.sourceErrors,
      sourceHealth: fetched.sourceHealth,
      updatedAt: now.toISOString(),
      snapshotAt: now.toISOString(),
    });
    payload.articles = [];
    payload.budget = null;
    payload.notifications = [];
    payload.digest = null;
    payload.diagnostics = {
      itemCount: items.length,
      featuredCount: featured.length,
      duplicateRate: duplicateRate(fetched.raw, items),
      enrichFailures: featured.filter((f) => f.enrichInsufficient).length,
      sourceCatalog: SOURCE_CATALOG,
    };
    const collectFailed = !(fetched.raw && fetched.raw.length) && !(items && items.length);
    if (store) {
      for (const h of fetched.sourceHealth) await store.putSourceHealth(h);
      if (collectFailed) {
        const prev =
          (await store.getSnapshot("last-good-events")) || (await store.getSnapshot("events"));
        if (prev && prev.json && Array.isArray(prev.json.items) && prev.json.items.length) {
          payload.items = prev.json.items;
          payload.featured = prev.json.featured || payload.featured;
          payload.updatedAt = prev.json.updatedAt || payload.updatedAt;
          payload.snapshotAt = prev.json.snapshotAt || payload.snapshotAt;
          payload.collectFailed = true;
        }
      } else {
        payload.articles = await store.listArticles();
        payload.budget = await store.getBudget();
        payload.notifications = await store.listNotifications();
        const digestSnap = await store.getSnapshot("digest:" + beijingYmd(now));
        payload.digest = digestSnap && digestSnap.json ? digestSnap.json : null;
        await store.putSnapshot("events", payload);
        await store.putSnapshot("last-good-events", payload);
      }
    }
    let skipNotify = Boolean(opts.skipNotify);
    if (store && !opts.forceNotify) {
      const baseline = await store.getSnapshot("baseline-done");
      if (!baseline) {
        skipNotify = true;
        await store.putSnapshot("baseline-done", {
          silent: true,
          at: now.toISOString(),
        });
      }
    }
    if (store && typeof store.purgeExpired === "function") {
      await store.purgeExpired(now);
    }
    let bark = { attempted: 0, skipped: 0, dryRun: Boolean(opts.dryRun), silentBaseline: skipNotify && !opts.skipNotify };
    if (!skipNotify) {
      bark = await notifyInstant(featured, {
        dryRun: opts.dryRun,
        key: opts.key,
        fetchImpl: opts.fetchImpl,
        sentPath: opts.sentPath,
        sentStore: opts.sentStore,
        prefs,
        now,
        pageUrl: opts.pageUrl || defaultSiteUrl(),
      });
      if (store) {
        await store.putNotification({
          channel: "bark-instant",
          status: bark.sent?.length ? "sent" : bark.unknown?.length ? "unknown" : "skipped",
          json: bark,
        });
      }
    }
    const outItems = (payload.items || []).map(publicItem);
    return { ...payload, items: outItems, bark, featured: payload.featured || featured };
  };
  if (store && !opts.skipLock) {
    try {
      return await withLock(store, "collect", run, { ttlMs: 12 * 60 * 1000 });
    } catch (e) {
      if (e && e.code === "LOCK") {
        const prev = await store.getSnapshot("last-good-events");
        return {
          ...(prev && prev.json ? prev.json : eventsPayload({ items: [], sourceErrors: [] })),
          lockSkipped: true,
        };
      }
      throw e;
    }
  }
  return run();
}

function duplicateRate(raw, events) {
  const n = (raw || []).length;
  if (!n) return 0;
  return Math.round((1 - (events || []).length / n) * 1000) / 1000;
}

export function allSourcesFailed(payload) {
  const errors = payload && payload.sourceErrors;
  const items = payload && payload.items;
  return (
    Array.isArray(errors) &&
    errors.length >= SOURCES.length &&
    (!items || items.length === 0)
  );
}

export function buildDigestFromItems(items, opts = {}) {
  const now = opts.now || new Date();
  const prefs = opts.prefs || {};
  const selected = selectDigest(items, { now, prefs });
  const buckets = { tech: [], business: [], public: [] };
  for (const it of selected) {
    if (buckets[it.category]) buckets[it.category].push(publicItem(it));
  }
  const latest = selectLatest(items, { now, prefs });
  return {
    apiVersion: "v1",
    date: beijingYmd(now),
    generatedAt: now.toISOString(),
    snapshotAt: now.toISOString(),
    tech: buckets.tech,
    business: buckets.business,
    public: buckets.public,
    items: selected.map(publicItem),
    latestCount: latest.length,
  };
}

export function digestSlotUtc(now = new Date()) {
  const p = beijingParts(now);
  return Date.UTC(p.year, p.month - 1, p.day, 0, 5, 0);
}

function digestKeepItem(it, prefs = {}) {
  if (!it) return false;
  if (it.category === "hidden") return false;
  const hidden = new Set((prefs.hiddenEventIds || []).map(String));
  const blocked = new Set((prefs.blockedSources || []).map(String));
  if (hidden.has(String(it.id))) return false;
  if (blocked.has(String(it.source))) return false;
  return true;
}

export function filterDigestByPrefs(digest, prefs = {}) {
  if (!digest || typeof digest !== "object") return digest;
  const keep = (it) => digestKeepItem(it, prefs);
  return {
    ...digest,
    items: (digest.items || []).filter(keep),
    tech: (digest.tech || []).filter(keep),
    business: (digest.business || []).filter(keep),
    public: (digest.public || []).filter(keep),
  };
}

export async function digestOnce(opts = {}) {
  const store = opts.store;
  const now = opts.now || new Date();
  const date = beijingYmd(now);
  const run = async () => {
    const contentKey = "digest:" + date;
    const sentKey = "digest-sent:" + date;
    if (store && !opts.force) {
      const sent = await store.getSnapshot(sentKey);
      if (sent && sent.json && (sent.json.ok || sent.json.unknown)) {
        const content = await store.getSnapshot(contentKey);
        return {
          digest: (content && content.json) || { date, items: [] },
          bark: { attempted: 0, reason: sent.json.unknown ? "unknown" : "idempotent" },
          catchUp: false,
        };
      }
    }
    async function latestPrefs() {
      if (typeof opts.refreshPrefs === "function") {
        const remote = await opts.refreshPrefs();
        if (remote && store) {
          await store.setPrefs(normalizePrefs({ ...(await store.getPrefs()), ...remote }));
        } else if (remote && !store) {
          return normalizePrefs({ ...(opts.prefs || {}), ...remote });
        }
      }
      if (store) return await store.getPrefs();
      return opts.prefs || {};
    }
    async function currentItems() {
      if (store) {
        const listed = await store.listEvents();
        if (listed && listed.length) return listed;
      }
      return opts.items || [];
    }
    let prefs = await latestPrefs();
    let items = await currentItems();
    let digest = buildDigestFromItems(items, { now, prefs });
    if (store) await store.putSnapshot(contentKey, digest);
    prefs = await latestPrefs();
    items = await currentItems();
    digest = filterDigestByPrefs(buildDigestFromItems(items, { now, prefs }), prefs);
    if (store) await store.putSnapshot(contentKey, digest);
    const bark = opts.skipNotify
      ? { attempted: 0 }
      : await notifyDigest(digest, {
          dryRun: opts.dryRun,
          key: opts.key,
          fetchImpl: opts.fetchImpl,
          pageUrl: opts.pageUrl,
          prefs,
        });
    if (store) {
      const kind = bark.result && bark.result.kind;
      const status = bark.ok ? "sent" : kind === "unknown" ? "unknown" : bark.attempted ? "failed" : "skipped";
      await store.putNotification({
        channel: "bark-digest",
        status,
        json: bark,
      });
      if (bark.ok) await store.putSnapshot(sentKey, { ok: true, at: now.toISOString() });
      else if (kind === "unknown") {
        await store.putSnapshot(sentKey, { ok: false, unknown: true, at: now.toISOString() });
      }
    }
    return { digest, bark, catchUp: Boolean(opts.catchUp) };
  };
  if (store && !opts.skipLock) {
    return withLock(store, "digest", run, { ttlMs: 10 * 60 * 1000 });
  }
  return run();
}

export async function maybeCatchUpDigest(store, opts = {}) {
  const now = opts.now || new Date();
  if (now.getTime() < digestSlotUtc(now)) return { skipped: true, reason: "before-slot" };
  const date = beijingYmd(now);
  const sent = await store.getSnapshot("digest-sent:" + date);
  if (sent && sent.json && (sent.json.ok || sent.json.unknown) && !opts.force) {
    return { skipped: true, reason: sent.json.unknown ? "unknown" : "sent" };
  }
  return digestOnce({ ...opts, store, now, catchUp: true });
}
