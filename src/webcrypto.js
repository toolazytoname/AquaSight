export async function sha256HexAsync(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text || "")));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomBytesHex(n = 32) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomDigits(len = 6) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  let out = "";
  for (const b of a) out += String(b % 10);
  return out;
}
