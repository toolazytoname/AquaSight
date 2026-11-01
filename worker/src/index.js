import { handleApi } from "../../src/api/handlers.js";
import { createD1Store } from "../../src/store/d1.js";
import { SECURITY_HEADERS } from "../../src/security-headers.js";
import { createImportFetch } from "./import-fetch.js";
import { runScheduler } from "../../src/scheduler.js";

function storeFor(env) {
  if (!env.DB) throw Object.assign(new Error("DB binding missing"), { code: "STORAGE_UNAVAILABLE" });
  return createD1Store(env.DB);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, {
          store: storeFor(env),
          importFetchImpl: createImportFetch(url.origin, env.ASSETS),
          waitUntil: ctx?.waitUntil ? (task) => ctx.waitUntil(task) : undefined,
          ingestToken: env.INGEST_TOKEN || "",
          authToken: env.AUTH_TOKEN || "",
          allowedEmail: env.ACCESS_EMAIL || "",
          accessTeam: env.ACCESS_TEAM || "",
          accessAud: env.ACCESS_AUD || "",
          requireAuth: env.REQUIRE_AUTH === "1",
          authMode: env.AUTH_MODE || "otp",
          mailApiKey: env.MAIL_API_KEY || "",
          mailFrom: env.MAIL_FROM || "",
          mailDriver: env.MAIL_DRIVER || "",
          cookieSecure: env.COOKIE_SECURE !== "0",
          legacyOwnerEmail: env.LEGACY_OWNER_EMAIL || "",
          env,
        });
      } catch (err) {
        const msg = String((err && err.message) || err || "");
        const quota = /D1_ERROR:.*(quota|storage limit|SQLITE_FULL)|row (?:read|write).{0,40}limit exceeded/i.test(msg);
        const missing = err?.code === "STORAGE_UNAVAILABLE";
        return new Response(JSON.stringify({ error: missing ? "storage unavailable" : quota ? "quota" : "internal", apiVersion: "v1" }), {
          status: quota || missing ? 503 : 500,
          headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      }
    }
    if (env.ASSETS && env.ASSETS.fetch) {
      return env.ASSETS.fetch(request);
    }
    return new Response("AquaSight worker", { status: 200 });
  },

  // Cloudflare cron provides an independent retry trigger. The handler
  // re-dispatches the existing workflows only when the persisted state
  // proves today's output is missing, so the GitHub schedules can remain
  // enabled as a fallback without double runs.
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runScheduler({
        store: storeFor(env),
        env,
        log: (m) => console.error(m),
      })
    );
  },
};
