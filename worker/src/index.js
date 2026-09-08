import { handleApi } from "../../src/api/handlers.js";
import { createD1Store } from "../../src/store/d1.js";
import { createMemoryStore } from "../../src/store/memory.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const store = env.DB ? createD1Store(env.DB) : createMemoryStore();
      return handleApi(request, {
        store,
        ingestToken: env.INGEST_TOKEN || "",
        authToken: env.AUTH_TOKEN || "",
        allowedEmail: env.ACCESS_EMAIL || "",
        accessTeam: env.ACCESS_TEAM || "",
        accessAud: env.ACCESS_AUD || "",
        requireAuth: env.REQUIRE_AUTH === "1" || Boolean(env.ACCESS_EMAIL),
        env,
      });
    }
    if (env.ASSETS && env.ASSETS.fetch) {
      return env.ASSETS.fetch(request);
    }
    return new Response("AquaSight worker", { status: 200 });
  },
};
