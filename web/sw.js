const SHELL = "aquasight-shell-v17";
const NEWS_PUBLIC = "aquasight-news-public-v17";
const NEWS_PREFIX = "aquasight-news-v17";
const SHELL_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./rules.js",
  "./favorites.js",
  "./guest-merge.js",
  "./manifest.webmanifest",
  "./icon.svg",
];

// Account-scoped endpoints are never cached by the service worker: favorites,
// reads and prefs already have durable localStorage mirrors, and a stale
// cross-account response is worse than a missed offline read.
const PERSONAL_PATH_RE = /^\/api\/v1\/(me|settings|reads|favorites|feedback|import|export|sync|review|auth)/;

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function matchShell(req) {
  const url = new URL(req.url, self.location.href);
  const cache = await caches.open(SHELL);
  const keys = [req, url.href, "./" + url.pathname.split("/").filter(Boolean).pop()];
  for (const key of keys) {
    if (!key) continue;
    const hit = await cache.match(key, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
}

function markCached(res) {
  if (!res) return res;
  const headers = new Headers(res.headers);
  headers.set("X-AquaSight-Cache", "1");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        // drop every cache from older versions, including per-user news caches
        Promise.all(
          keys
            .filter((k) => k !== SHELL && k !== NEWS_PUBLIC && !k.startsWith(NEWS_PREFIX + "-"))
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

async function cacheNameFor(req) {
  // A request that carries credentials gets its own cache namespace, so user
  // A can never read user B's personalized news responses from the cache.
  const cred = req.headers.get("cookie") || req.headers.get("authorization") || "";
  if (!cred) return NEWS_PUBLIC;
  const hash = await sha256Hex(cred);
  return NEWS_PREFIX + "-" + hash;
}

async function handleApi(req) {
  const url = new URL(req.url);
  if (PERSONAL_PATH_RE.test(url.pathname)) {
    return fetch(req).catch(
      () =>
        new Response(JSON.stringify({ error: "offline", apiVersion: "v1" }), {
          status: 503,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        })
    );
  }
  const cacheName = await cacheNameFor(req);
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const copy = res.clone();
      const cache = await caches.open(cacheName);
      await cache.put(req, copy);
    } else if (res && (res.status === 401 || res.status === 403)) {
      // Credentials changed: drop this namespace so the next login starts clean.
      await caches.delete(cacheName).catch(() => {});
    }
    return res;
  } catch {
    const cache = await caches.open(cacheName);
    const hit = await cache.match(req);
    return hit ? markCached(hit) : Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApi(req));
    return;
  }
  event.respondWith(
    matchShell(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (
            res &&
            res.ok &&
            (url.pathname.endsWith(".js") ||
              url.pathname.endsWith(".css") ||
              url.pathname.endsWith(".html") ||
              url.pathname.endsWith(".webmanifest") ||
              url.pathname.endsWith("/"))
          ) {
            const copy = res.clone();
            caches.open(SHELL).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          if (req.mode === "navigate") {
            return (await matchShell("./index.html")) || (await matchShell("./"));
          }
          throw new Error("offline");
        });
    })
  );
});
