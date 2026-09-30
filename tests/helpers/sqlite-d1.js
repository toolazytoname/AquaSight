/** Real-SQLite D1 adapter for tests (node:sqlite). Exercises the actual SQL
 * text the D1 store emits — including json_extract projections, IN clauses
 * and EXPLAIN QUERY PLAN — against a genuine query planner. */

import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

export async function createSqliteD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(new URL("../../worker/schema.sql", import.meta.url), "utf8"));
  const adapter = {
    __db: db,
    prepare(sql) {
      const statement = db.prepare(sql);
      let args = [];
      const bound = {
        bind(...values) {
          args = values;
          return bound;
        },
        async all() {
          return { results: statement.all(...args) };
        },
        async first() {
          return statement.get(...args) ?? null;
        },
        async run() {
          const result = statement.run(...args);
          // D1 shape: callers inspect res.meta.changes.
          return { meta: { changes: Number(result.changes) || 0 } };
        },
      };
      return bound;
    },
    async batch(stmts) {
      const results = [];
      db.exec("BEGIN");
      try {
        for (const st of stmts) results.push(await st.run());
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      return results;
    },
    close() {
      db.close();
    },
  };
  return adapter;
}

/// Where does the planner send this query? Returns the EXPLAIN QUERY PLAN
/// detail strings (lowercased) for assertions about index usage.
export function queryPlan(d1, sql, ...binds) {
  const rows = d1.__db.prepare("EXPLAIN QUERY PLAN " + sql).all(...binds);
  return rows.map((r) => String(r.detail || "").toLowerCase());
}
