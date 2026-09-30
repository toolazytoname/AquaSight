import { scrypt, randomBytes, timingSafeEqual } from "node:crypto";

// OWASP's 16 MiB scrypt profile fits the Worker memory envelope.
const OPTIONS = { N: 16384, r: 8, p: 5, maxmem: 32 * 1024 * 1024 };
export function validPassword(password) {
  return typeof password === "string" && [...password].length >= 12 && [...password].length <= 128 && Buffer.byteLength(password, "utf8") <= 512;
}
function derive(password, salt) {
  return new Promise((resolve, reject) => scrypt(password, salt, 32, OPTIONS, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password) {
  if (!validPassword(password)) throw new Error("invalid-password");
  const salt = randomBytes(16).toString("hex");
  const hash = await derive(password, salt);
  return `scrypt-v1$${salt}$${hash.toString("hex")}`;
}
export async function checkPassword(password, encoded) {
  // Missing accounts still pay the same KDF cost; callers rate-limit before this.
  const parts = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(String(encoded || ""));
  const bounded = typeof password === "string" && Buffer.byteLength(password) <= 512 ? password : "invalid-input";
  const actual = await derive(bounded, parts?.[1] || "00000000000000000000000000000000");
  const expected = Buffer.from(parts?.[2] || "00".repeat(32), "hex");
  return timingSafeEqual(actual, expected) && Boolean(parts) && validPassword(password);
}
