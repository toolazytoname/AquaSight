import { sha256HexAsync, randomBytesHex, randomDigits } from "./webcrypto.js";
import { sendOtpEmail } from "./mail.js";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_RESEND_MS = 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const EMAIL_HOUR_CAP = 5;
export const EMAIL_DAY_CAP = 12;
export const IP_HOUR_CAP = 10;
export const GLOBAL_DAY_CAP = 80;
export const COOKIE = "aqs_session";

const GENERIC_REQUEST = { ok: true, retryAfterSec: 60 };
const GENERIC_VERIFY_FAIL = { ok: false, error: "invalid-code" };

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function looksLikeEmail(email) {
  const e = normalizeEmail(email);
  return e.length > 4 && e.length < 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure = true, maxAgeSec = SESSION_TTL_MS / 1000 } = {}) {
  return (
    COOKIE +
    "=" +
    encodeURIComponent(token) +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" +
    Math.floor(maxAgeSec) +
    (secure ? "; Secure" : "")
  );
}

export function clearSessionCookie({ secure = true } = {}) {
  return COOKIE + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" + (secure ? "; Secure" : "");
}

export function bearerOrCookie(req) {
  const authz = req.headers.get("authorization") || "";
  if (authz.toLowerCase().startsWith("bearer ")) return authz.slice(7).trim();
  return parseCookies(req.headers.get("cookie") || "")[COOKIE] || "";
}

function windowKey(kind, id, span) {
  const slot = Math.floor(Date.now() / span);
  return kind + ":" + id + ":" + slot;
}

async function peppered(store, raw) {
  const pepper = (store && store.authPepper) || "";
  return sha256HexAsync(pepper + ":" + raw);
}

export async function requestCode(store, { email, ip }, env = {}) {
  const addr = normalizeEmail(email);
  if (!looksLikeEmail(addr)) return { ...GENERIC_REQUEST };
  const hourEmail = windowKey("email-h", addr, 60 * 60 * 1000);
  const dayEmail = windowKey("email-d", addr, 24 * 60 * 60 * 1000);
  const hourIp = windowKey("ip-h", ip || "0", 60 * 60 * 1000);
  const dayAll = windowKey("all-d", "global", 24 * 60 * 60 * 1000);
  const counts = await Promise.all([
    store.bumpRate(hourEmail, EMAIL_HOUR_CAP),
    store.bumpRate(dayEmail, EMAIL_DAY_CAP),
    store.bumpRate(hourIp, IP_HOUR_CAP),
    store.bumpRate(dayAll, GLOBAL_DAY_CAP),
  ]);
  if (counts.some((c) => c.limited)) return { ...GENERIC_REQUEST, limited: true };

  const prev = await store.getOtp(addr);
  if (prev && Date.now() - Date.parse(prev.sentAt) < OTP_RESEND_MS) {
    return { ...GENERIC_REQUEST };
  }
  const code = env.otpCode || randomDigits(6);
  const row = {
    email: addr,
    codeHash: await peppered(store, code),
    expiresAt: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    attempts: 0,
    sentAt: new Date().toISOString(),
    ip: ip || "",
  };
  await store.putOtp(row);
  const sent = await sendOtpEmail({ to: addr, code, env, fetchImpl: env.fetchImpl });
  if (!sent.ok && !sent.skipped) {
    return { ...GENERIC_REQUEST, mailError: true };
  }
  return { ...GENERIC_REQUEST, debugCode: env.exposeOtp ? code : undefined, skipped: sent.skipped };
}

export async function verifyCode(store, { email, code, userAgent, ip }, env = {}) {
  const addr = normalizeEmail(email);
  if (!looksLikeEmail(addr) || !String(code || "").trim()) return GENERIC_VERIFY_FAIL;
  const row = await store.getOtp(addr);
  if (!row) return GENERIC_VERIFY_FAIL;
  if (Date.parse(row.expiresAt) < Date.now()) {
    await store.deleteOtp(addr);
    return GENERIC_VERIFY_FAIL;
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) return GENERIC_VERIFY_FAIL;
  const hash = await peppered(store, String(code).trim());
  if (hash !== row.codeHash) {
    await store.putOtp({ ...row, attempts: row.attempts + 1 });
    return GENERIC_VERIFY_FAIL;
  }
  await store.deleteOtp(addr);
  let user = await store.getUserByEmail(addr);
  if (!user) {
    user = await store.putUser({
      id: "usr:" + randomBytesHex(16),
      email: addr,
      createdAt: new Date().toISOString(),
    });
  }
  const token = randomBytesHex(32);
  const session = {
    id: "ses:" + randomBytesHex(12),
    userId: user.id,
    email: user.email,
    tokenHash: await peppered(store, token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    userAgent: String(userAgent || "").slice(0, 200),
    ip: ip || "",
  };
  await store.putSession(session);
  return { ok: true, token, session, user };
}

export async function loadSession(store, token) {
  if (!token) return null;
  const hash = await peppered(store, token);
  const session = await store.getSessionByHash(hash);
  if (!session || session.revokedAt) return null;
  if (Date.parse(session.expiresAt) < Date.now()) return null;
  const user = await store.getUser(session.userId);
  if (!user || user.deletedAt) return null;
  return { ...session, user };
}

export async function logoutSession(store, token) {
  const session = await loadSession(store, token);
  if (!session) return { ok: true };
  await store.revokeSession(session.id);
  return { ok: true };
}

export async function logoutAll(store, userId) {
  await store.revokeUserSessions(userId);
  return { ok: true };
}
