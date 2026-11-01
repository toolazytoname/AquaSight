import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { SECURITY_HEADERS } from "./security-headers.js";
import { fetchPinned } from "./import-fetch-node.js";
import { requestBodyLimit, RequestBodyError } from "./api/body.js";
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

function bodyOf(req) {
  const limit = requestBodyLimit(new URL(req.url, "http://localhost").pathname);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off("data", data); req.off("end", end); req.off("error", error); req.off("aborted", aborted);
    };
    const error = e => { cleanup(); reject(e); };
    const aborted = () => error(new RequestBodyError("request aborted", 400));
    const data = chunk => {
      size += chunk.length;
      if (size > limit) {
        req.pause();
        error(new RequestBodyError("body too large", 413));
      } else chunks.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => { req.pause(); error(new RequestBodyError("request timeout", 408)); }, 15_000);
    if (Number(req.headers["content-length"]) > limit) {
      error(new RequestBodyError("body too large", 413));
      return;
    }
    req.on("data", data); req.on("end", end); req.on("error", error); req.on("aborted", aborted);
  });
}

export async function startServer(opts = {}) {
  const store = opts.store || (await loadFileStore(opts.storePath || STORE));
  const env = {
    store,
    ingestToken: process.env.INGEST_TOKEN || "",
    authToken: process.env.AUTH_TOKEN || "",
    allowedEmail: process.env.ACCESS_EMAIL || "",
    requireAuth: process.env.REQUIRE_AUTH === "1",
    authMode: process.env.AUTH_MODE || "",
    mailApiKey: process.env.MAIL_API_KEY || "",
    mailFrom: process.env.MAIL_FROM || "",
    mailDriver: process.env.MAIL_DRIVER || "log",
    cookieSecure: false,
    env: process.env,
    // 测试注入口：SSRF 安全拉取的网络实现可整体替换（不出网）。
    fetchImpl: opts.fetchImpl,
    importFetchImpl: opts.fetchImpl || fetchPinned,
    lookupImpl: opts.lookupImpl,
  };
  const server = createServer({ headersTimeout: 15_000, requestTimeout: 20_000 }, async (req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
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
      if (!file.startsWith(WEB + sep)) {
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
      const status = e instanceof RequestBodyError ? e.status : 500;
      if (status === 500) console.error("request failed", e);
      if (res.headersSent) { res.destroy(); return; }
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", connection: "close" });
      res.end(JSON.stringify({ error: status === 500 ? "internal" : e.message, apiVersion: "v1" }));
    }
  });
  const port = opts.port != null ? opts.port : PORT;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const addr = server.address();
  return { server, store, port: addr.port };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startServer().then(({ port }) => {
    console.log("AquaSight local http://127.0.0.1:" + port + "/");
  });
}
