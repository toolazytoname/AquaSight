import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handleApi } from "./api/handlers.js";
import { loadFileStore } from "./store/file.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "web");
const STORE = join(ROOT, "data", "app-store.json");
const PORT = Number(process.env.PORT || 8765);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function toWebRequest(req, data) {
  const host = req.headers.host || "127.0.0.1:" + PORT;
  const url = "http://" + host + req.url;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return new Request(url, {
    method: req.method,
    headers,
    body: data && req.method !== "GET" && req.method !== "HEAD" ? data : undefined,
  });
}

async function bodyOf(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

export async function startServer(opts = {}) {
  const store = opts.store || (await loadFileStore(opts.storePath || STORE));
  const env = {
    store,
    ingestToken: process.env.INGEST_TOKEN || "",
    authToken: process.env.AUTH_TOKEN || "",
    allowedEmail: process.env.ACCESS_EMAIL || "",
    requireAuth: Boolean(process.env.REQUIRE_AUTH),
    env: process.env,
  };
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname.startsWith("/api/")) {
        const buf = await bodyOf(req);
        const webReq = toWebRequest(req, buf.length ? buf : undefined);
        const out = await handleApi(webReq, env);
        res.writeHead(out.status, Object.fromEntries(out.headers));
        res.end(Buffer.from(await out.arrayBuffer()));
        return;
      }
      let path = url.pathname;
      if (path === "/" || path === "/web" || path === "/web/") path = "/index.html";
      const rel = path.replace(/^\/web\//, "/").replace(/^\//, "");
      const file = join(WEB, rel);
      if (!file.startsWith(WEB)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      try {
        const data = await readFile(file);
        res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
        res.end(data);
      } catch {
        if (path.startsWith("/event/") || path === "/review") {
          const data = await readFile(join(WEB, "index.html"));
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(data);
          return;
        }
        res.writeHead(404);
        res.end("not found");
      }
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e && e.message ? e.message : e) }));
    }
  });
  const port = opts.port != null ? opts.port : PORT;
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const addr = server.address();
  return { server, store, port: addr.port };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().then(({ port }) => {
    console.log("AquaSight local http://127.0.0.1:" + port + "/");
  });
}
