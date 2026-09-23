import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function openRealSqlite() {
  let mod;
  try {
    mod = await import("node:sqlite");
  } catch {
    return null; // Node < 22.5 (CI): covered there by the fake-D1 tests.
  }
  const { DatabaseSync } = mod;
  const db = new DatabaseSync(":memory:");
  const schema = await readFile(join(ROOT, "worker", "schema.sql"), "utf8");
  db.exec(schema);
  return db;
}

// node:sqlite speaks .run/.all/.get with positional params; the store speaks
// the D1 surface (.bind/.run/.all/.first + db.batch).
function d1ify(sqlite) {
  const prepare = (sql) => {
    const stmt = sqlite.prepare(sql);
    let binds = [];
    const self = {
      bind(...args) {
        binds = args;
        return self;
      },
      async run() {
        return stmt.run(...binds);
      },
      async all() {
        return { results: stmt.all(...binds) };
      },
      async first() {
        return stmt.get(...binds) ?? null;
      },
    };
    return self;
  };
  return {
    prepare,
    async batch(stmts) {
      for (const st of stmts) await st.run();
    },
  };
}

function insertSession(db, row) {
  db.prepare(
    "INSERT INTO sessions (id, user_id, email, token_hash, created_at, expires_at, revoked_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    row.id,
    row.userId || "usr:1",
    row.email || "u@example.com",
    row.tokenHash || "h:" + row.id,
    row.createdAt || "2026-09-01T00:00:00.000Z",
    row.expiresAt,
    row.revokedAt ?? "",
    "",
    ""
  );
}

test("real SQLite: purge keeps valid, expired-only, and recently-revoked sessions; drops long-revoked", async (t) => {
  const sqlite = await openRealSqlite();
  if (!sqlite) return t.skip("node:sqlite unavailable on this Node version");
  const { createD1Store } = await import("../src/store/d1.js");
  const now = new Date("2026-09-23T12:00:00.000Z");
  const day = 24 * 60 * 60 * 1000;

  insertSession(sqlite, { id: "live", expiresAt: new Date(now.getTime() + day).toISOString() });
  insertSession(sqlite, {
    id: "expired-not-revoked",
    expiresAt: new Date(now.getTime() - day).toISOString(),
  });
  insertSession(sqlite, {
    id: "revoked-recent",
    expiresAt: new Date(now.getTime() + day).toISOString(),
    revokedAt: new Date(now.getTime() - 7 * day).toISOString(),
  });
  insertSession(sqlite, {
    id: "revoked-old",
    expiresAt: new Date(now.getTime() - 60 * day).toISOString(),
    revokedAt: new Date(now.getTime() - 40 * day).toISOString(),
  });
  insertSession(sqlite, {
    id: "revoked-null",
    expiresAt: new Date(now.getTime() + day).toISOString(),
    revokedAt: null,
  });

  const store = createD1Store(d1ify(sqlite));
  await store.purgeAuthArtifacts(now);

  const ids = sqlite.prepare("SELECT id FROM sessions").all().map((r) => r.id).sort();
  // The old SQL (revoked_at < cutoff) also deleted `live`, `expired-not-revoked`
  // is deleted by expiry, `revoked-null` was safe via NULL comparison.
  assert.deepEqual(ids, ["live", "revoked-null", "revoked-recent"]);
});

test("real SQLite: ingest-triggered purge keeps the live HttpOnly-cookie session", async (t) => {
  const sqlite = await openRealSqlite();
  if (!sqlite) return t.skip("node:sqlite unavailable on this Node version");
  const { createD1Store } = await import("../src/store/d1.js");
  const { handleApi } = await import("../src/api/handlers.js");

  const now = new Date();
  insertSession(sqlite, {
    id: "live-cookie",
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });

  const store = createD1Store(d1ify(sqlite));
  const res = await handleApi(
    new Request("http://127.0.0.1/api/v1/ingest", {
      method: "POST",
      headers: { authorization: "Bearer ingest-secret", "content-type": "application/json" },
      body: JSON.stringify({
        updatedAt: now.toISOString(),
        snapshotAt: now.toISOString(),
        items: [
          { id: "evt:x", title: "X", source: "hn", category: "tech", url: "https://x.example/1" },
        ],
      }),
    }),
    { store, ingestToken: "ingest-secret", requireAuth: false }
  );
  assert.equal(res.status, 200);
  const ids = sqlite.prepare("SELECT id FROM sessions").all().map((r) => r.id);
  assert.deepEqual(ids, ["live-cookie"]);
});
