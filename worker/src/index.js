import { handleApi } from "../../src/api/handlers.js";
import { createD1Store } from "../../src/store/d1.js";
import { createMemoryStore } from "../../src/store/memory.js";
import { runScheduler } from "../../src/scheduler.js";

function storeFor(env) {
  return env.DB ? createD1Store(env.DB) : createMemoryStore();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const store = storeFor(env);
      try {
        return await handleApi(request, {
          store,
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
        return new Response(JSON.stringify({ error: quota ? "quota" : "internal", apiVersion: "v1" }), {
          status: quota ? 503 : 500,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
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
