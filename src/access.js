function b64urlToBytes(s) {
  const pad = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin =
    typeof Buffer !== "undefined"
      ? Buffer.from(pad, "base64")
      : Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
  return bin instanceof Uint8Array ? bin : new Uint8Array(bin);
}

function decodePart(part) {
  const raw =
    typeof Buffer !== "undefined"
      ? Buffer.from(part, "base64url").toString("utf8")
      : new TextDecoder().decode(b64urlToBytes(part));
  return JSON.parse(raw);
}

async function fetchJwks(team, fetchImpl) {
  const url = "https://" + team + ".cloudflareaccess.com/cdn-cgi/access/certs";
  const res = await (fetchImpl || fetch)(url);
  if (!res || !res.ok) return null;
  return res.json();
}

async function verifyRs256(signingInput, sigB64, jwk) {
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(signingInput)
  );
}

export async function verifyAccessJwt(jwt, env = {}) {
  if (!jwt || String(jwt).split(".").length !== 3) return null;
  const [h, p, s] = String(jwt).split(".");
  let header;
  let payload;
  try {
    header = decodePart(h);
    payload = decodePart(p);
  } catch {
    return null;
  }
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  const aud = env.accessAud;
  if (aud) {
    const okAud =
      payload.aud === aud || (Array.isArray(payload.aud) && payload.aud.includes(aud));
    if (!okAud) return null;
  }
  const jwks = env.jwks || (env.accessTeam ? await fetchJwks(env.accessTeam, env.fetchImpl) : null);
  if (!jwks || !Array.isArray(jwks.keys) || !jwks.keys.length) return null;
  const jwk = jwks.keys.find((k) => k.kid && k.kid === header.kid) || jwks.keys[0];
  const ok = await verifyRs256(h + "." + p, s, jwk);
  if (!ok) return null;
  const email = String(payload.email || "").toLowerCase();
  if (!email) return null;
  return { email, payload };
}

export const INGEST_ALLOW = new Set(["POST /api/v1/ingest", "GET /api/v1/settings"]);

export function ingestAllowed(method, path) {
  return INGEST_ALLOW.has(String(method || "").toUpperCase() + " " + path);
}

export function isPublicApi(method, path) {
  const m = String(method || "").toUpperCase();
  if (m === "GET" && /^\/api\/v1\/(health|status\/public|events|events\/[^/]+|digest)$/.test(path)) return true;
  if (m === "POST" && /^\/api\/v1\/auth\/(request-code|verify)$/.test(path)) return true;
  return false;
}

export function otpAuthEnabled(env = {}) {
  return env.authMode === "otp" || env.AUTH_MODE === "otp" || Boolean(env.mailApiKey || env.MAIL_API_KEY);
}

export async function readAuth(req, env = {}) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const ingest = env.ingestToken || "";
  const authz = req.headers.get("authorization") || "";
  const bearer = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
  if (ingest && bearer === ingest) {
    return { ok: true, role: "ingest", path };
  }
  const token = env.authToken || "";
  if (token && (bearer === token || req.headers.get("x-auth-token") === token)) {
    return { ok: true, role: "user", path };
  }
  if (env.store && typeof env.store.getSessionByHash === "function") {
    const { bearerOrCookie, loadSession } = await import("./auth.js");
    const raw = bearerOrCookie(req);
    const session = await loadSession(env.store, raw);
    if (session) {
      return {
        ok: true,
        role: "user",
        userId: session.userId,
        email: session.email,
        session,
        token: raw,
        path,
      };
    }
  }
  const allowed = String(env.allowedEmail || "").trim().toLowerCase();
  if (allowed) {
    const jwt = req.headers.get("cf-access-jwt-assertion") || "";
    const verified = await verifyAccessJwt(jwt, env);
    if (!verified || verified.email !== allowed) return { ok: false, role: "", path };
    return { ok: true, role: "user", email: verified.email, path };
  }
  if (!env.requireAuth && !otpAuthEnabled(env)) return { ok: true, role: "local", path };
  if (isPublicApi(req.method, path)) return { ok: true, role: "public", path };
  return { ok: false, role: "", path };
}
