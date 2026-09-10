const SHELL = "aquasight-shell-v10";
const PRIVATE = "aquasight-private-v10";
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

async function matchApi(req) {
  const cache = await caches.open(PRIVATE);
  return cache.match(req);
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
        Promise.all(keys.filter((k) => k !== SHELL && k !== PRIVATE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") {
    event.respondWith(fetch(req));
    return;
  }
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(PRIVATE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          const hit = await matchApi(req);
          return hit ? markCached(hit) : undefined;
        })
    );
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
