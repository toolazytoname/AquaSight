// Shared limits for Worker requests and the Node HTTP adapter. Ingest is a
// trusted bulk operation; interactive endpoints should never buffer that much.
export const API_BODY_MAX_BYTES = 256 * 1024;
export const INGEST_BODY_MAX_BYTES = 8 * 1024 * 1024;

export function requestBodyLimit(path) {
  return ["/api/v1/ingest", "/api/v1/import-backup"].includes(path.replace(/\/+$/, "")) ? INGEST_BODY_MAX_BYTES : API_BODY_MAX_BYTES;
}

export class RequestBodyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody(req) {
  const limit = requestBodyLimit(new URL(req.url).pathname);
  const length = Number(req.headers.get("content-length"));
  if (Number.isFinite(length) && length > limit) throw new RequestBodyError("body too large", 413);
  if (!req.body) throw new RequestBodyError("invalid json");
  const reader = req.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        // Do not await cancellation: an untrusted stream may never settle it.
        void reader.cancel().catch(() => {});
        throw new RequestBodyError("body too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RequestBodyError("invalid json"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestBodyError("expected json object");
  return body;
}
