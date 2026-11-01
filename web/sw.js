const SHELL = "aquasight-shell-v34";
const SHELL_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./public-page.css",
  "./app.js",
  "./rules.js",
  "./favorites.js",
  "./urlnorm.js",
  "./guest-merge.js",
  "./i18n.js",
  "./public-language.js",
  "./privacy.html",
  "./privacy-en.html",
  "./support.html",
  "./support-en.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
];

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
            .filter((k) => k.startsWith("aquasight-") && k !== SHELL)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Cookie headers are not exposed to service workers. Even /events and /digest
// can vary by account (hidden sources, unread state). No API response is safe
// to place in a shared CacheStorage namespace. Offline reading is handled by
// the application's account-scoped storage and public static snapshot.
async function handleApi(req) {
  return fetch(req).catch(() => new Response(JSON.stringify({ error: "offline", apiVersion: "v1" }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  }));
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const target = new URL(req.url);
  if (target.origin !== new URL(self.location.href).origin) return;
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
