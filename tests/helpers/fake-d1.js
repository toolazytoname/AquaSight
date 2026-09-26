/** Minimal in-memory D1 emulator for tests. Only the SQL shapes the store
 * actually emits are supported; anything else fails loudly. */

const D1_PK = {
  events: "id",
  articles: "id",
  event_members: ["event_id", "article_id"],
  article_event_map: ["article_id", "event_id"],
  preferences: "id",
  user_prefs: ["user_id"],
  users: "id",
  sessions: "id",
  otp_codes: "email",
  rate_limits: "key",
  reads: ["user_id", "event_id"],
  user_reads: ["user_id", "event_id"],
  favorites: ["user_id", "event_id"],
  user_favorites: ["user_id", "event_id"],
  feedback: "id",
  user_feedback: "id",
  cache_entries: "key",
  notifications: "id",
  tasks: "id",
  source_health: "source",
  snapshots: "name",
};

// COALESCE(NULLIF(a,''), NULLIF(b,''), c) → first non-empty of [a, b, c].
function coalesceEvaluator(expr) {
  const m = String(expr).match(
    /^COALESCE\((NULLIF\((\w+),\s*''\)(?:,\s*NULLIF\((\w+),\s*''\))?(?:,\s*(\w+))?)\)$/i
  );
  if (!m) return null;
  const cols = [m[2], m[3], m[4]].filter(Boolean);
  return (row) => {
    for (const c of cols) {
      const v = row[c];
      if (v != null && v !== "") return v;
    }
    return null;
  };
}

export function createFakeD1(opts = {}) {
  const tables = {};
  for (const name of Object.keys(D1_PK)) tables[name] = new Map();

  function keyOf(table, row) {
    const pk = D1_PK[table];
    if (Array.isArray(pk)) return pk.map((c) => row[c]).join("\0");
    return row[pk];
  }

  function snapshot() {
    const out = {};
    for (const [name, map] of Object.entries(tables)) out[name] = new Map(map);
    return out;
  }

  function restore(snap) {
    for (const name of Object.keys(tables)) {
      tables[name] = new Map(snap[name]);
    }
  }

// VALUES list may mix ? placeholders and quoted literals.
function parseValues(list, binds) {
  const out = [];
  let i = 0;
  const s = String(list || "");
  while (i < s.length) {
    const ch = s[i];
    if (ch === "?") {
      out.push(binds.shift());
      i += 1;
    } else if (ch === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) throw new Error("unterminated literal: " + s);
      out.push(s.slice(i + 1, end));
      i = end + 1;
    } else if (ch === ",") {
      i += 1;
    } else if (/\s/.test(ch)) {
      i += 1;
    } else {
      throw new Error("unsupported values token at " + i + ": " + s);
    }
  }
  return out;
}

  function exec(sql, binds) {
    if (opts.failInsert && String(sql).includes("INSERT") && binds.includes(opts.failInsert)) {
      throw new Error("insert fail");
    }
    const s = String(sql || "").replace(/\s+/g, " ").trim();
    const del2 = s.match(/^DELETE FROM (\w+) WHERE (\w+) = \? AND (\w+) = \?$/i);
    if (del2) {
      const table = del2[1];
      let changes = 0;
      for (const [k, row] of [...tables[table].entries()]) {
        if (row[del2[2]] === binds[0] && row[del2[3]] === binds[1]) {
          tables[table].delete(k);
          changes += 1;
        }
      }
      return { results: [], meta: { changes } };
    }
    const del = s.match(/^DELETE FROM (\w+)(?: WHERE (\w+) = \?)?$/i);
    if (del) {
      const table = del[1];
      if (!del[2]) {
        const changes = tables[table].size;
        tables[table].clear();
        return { results: [], meta: { changes } };
      }
      const col = del[2];
      let changes = 0;
      for (const [k, row] of [...tables[table].entries()]) {
        if (row[col] === binds[0]) {
          tables[table].delete(k);
          changes += 1;
        }
      }
      return { results: [], meta: { changes } };
    }
    // INSERT ... ON CONFLICT(pk) DO UPDATE SET ... WHERE <existing-row guard>
    const up = s.match(
      /^INSERT INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\) ON CONFLICT\((\w+)\) DO UPDATE SET (.+?) WHERE (.+)$/i
    );
    if (up) {
      const table = up[1];
      const cols = up[2].split(",").map((c) => c.trim());
      const row = {};
      const values = parseValues(up[3], [...binds]);
      cols.forEach((c, i) => {
        row[c] = values[i];
      });
      const threshold = binds[binds.length - 1]; // guard's trailing ?
      const key = keyOf(table, row);
      const prev = tables[table].get(key);
      // Guard: "tasks.lock_until IS NULL OR tasks.lock_until <= ?"
      const guard = up[6];
      const m = guard.match(/^(\w+)\.(\w+) IS NULL OR \1\.\2 <= \?$/i);
      if (!m) throw new Error("unsupported upsert guard: " + guard);
      const guardCol = m[2];
      const takeIt = !prev || prev[guardCol] == null || String(prev[guardCol]) <= String(threshold);
      if (prev) {
        if (!takeIt) return { results: [], meta: { changes: 0 } };
        const setCols = up[5].split(",").map((p) => p.trim().match(/^(\w+) = excluded\.(\w+)$/i)).filter(Boolean);
        const next = { ...prev };
        for (const sm of setCols) next[sm[1]] = row[sm[2]];
        tables[table].set(key, next);
        return { results: [], meta: { changes: 1 } };
      }
      tables[table].set(key, row);
      return { results: [], meta: { changes: 1 } };
    }
    const ins = s.match(/^INSERT(?: OR REPLACE)? INTO (\w+) \(([^)]+)\) VALUES \(([^)]+)\)$/i);
    if (ins) {
      const table = ins[1];
      const cols = ins[2].split(",").map((c) => c.trim());
      const row = {};
      const values = parseValues(ins[3], [...binds]);
      cols.forEach((c, i) => {
        row[c] = values[i];
      });
      tables[table].set(keyOf(table, row), row);
      return { results: [], meta: { changes: 1 } };
    }
    const sel = s.match(
      /^SELECT (.+) FROM (\w+)(?: WHERE (\w+) = \?)?(?: ORDER BY (.+?))?(?: LIMIT \?)?$/i
    );
    if (sel) {
      const table = sel[2];
      const whereCol = sel[3];
      let rows = [...tables[table].values()];
      if (whereCol) rows = rows.filter((r) => r[whereCol] === binds[0]);
      const countMatch = sel[1].match(/^COUNT\(\*\)(?: AS (\w+))?$/i);
      if (countMatch) {
        return { results: [{ [countMatch[1] || "COUNT(*)"]: rows.length }] };
      }
      if (sel[4]) {
        const dir = /DESC$/i.test(sel[4]) ? -1 : 1;
        const evalCoalesce = coalesceEvaluator(sel[4].replace(/\s+(ASC|DESC)$/i, ""));
        if (!evalCoalesce) throw new Error("unsupported order by: " + sel[4]);
        rows = rows.sort((a, b) => {
          const va = evalCoalesce(a) || "";
          const vb = evalCoalesce(b) || "";
          if (va === vb) return 0;
          return (va < vb ? -1 : 1) * dir;
        });
      }
      if (/ LIMIT \?$/i.test(s)) {
        const n = Number(binds[binds.length - 1]);
        if (Number.isFinite(n) && n > 0) rows = rows.slice(0, n);
      }
      const cols = sel[1].split(",").map((part) => {
        const m = part.trim().match(/^(\w+)(?: AS (\w+))?$/i);
        if (!m) throw new Error("unsupported column: " + part);
        return { from: m[1], as: m[2] || m[1] };
      });
      const results = rows.map((r) => {
        const out = {};
        for (const c of cols) out[c.as] = r[c.from];
        return out;
      });
      return { results };
    }
    throw new Error("unsupported sql: " + s);
  }

  function stmt(sql) {
    let binds = [];
    const run = async () => exec(sql, binds);
    return {
      bind(...args) {
        binds = args;
        return this;
      },
      run,
      first: async () => (await run()).results[0] || null,
      all: async () => ({ results: (await run()).results }),
    };
  }

  return {
    prepare(sql) {
      return stmt(sql);
    },
    async batch(stmts) {
      if (!stmts || !stmts.length) throw new Error("D1_ERROR: No SQL statements detected");
      const snap = snapshot();
      try {
        for (const st of stmts) await st.run();
      } catch (e) {
        restore(snap);
        throw e;
      }
    },
  };
}
