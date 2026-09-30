/**
 * SQL building blocks for bounded event reads shared by the D1 store and
 * tests against real SQLite. Keeps the SQL shapes in one place so the
 * emulated-D1 test helper and the real-SQLite tests exercise identical text.
 *
 * The reader index deliberately projects only lightweight metadata columns
 * plus json_extract()ed scalars: SQLite never ships the heavy JSON blob for
 * index construction, pagination fetches only the page's IDs, and the exact
 * repo-aware ordering / URL-safety / text filters run in JS on the metadata
 * (identical semantics to the legacy full-scan path).
 */

export const SQL_CHUNK = 40;

export function chunk(list, size = SQL_CHUNK) {
  const out = [];
  const arr = [...list];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function placeholders(n) {
  return new Array(n).fill("?").join(", ");
}

function inClause(col, values) {
  return `${col} IN (${placeholders(values.length)})`;
}

/// Reader-feed pushdown: primary-source membership plus hidden exclusion are
/// pure column predicates served by events(json_extract(source), category). Everything the
/// JS side needs for exact filtering/ordering is extracted as scalars.
export const EVENT_META_SELECT =
  "SELECT id, category, title, title_zh, overview_zh, published_at, occurred_at, first_seen_at, " +
  "json_extract(json, '$.source') AS j_source, " +
  "json_extract(json, '$.url') AS j_url, " +
  "json_extract(json, '$.summary') AS j_summary, " +
  "json_extract(json, '$.summaryZh') AS j_summary_zh, " +
  "json_extract(json, '$.observedAt') AS j_observed_at, " +
  "json_extract(json, '$.firstSeenAt') AS j_first_seen_at, " +
  "json_extract(json, '$.seenAt') AS j_seen_at, " +
  "json_extract(json, '$.publishedAt') AS j_published_at, " +
  "json_extract(json, '$.occurredAt') AS j_occurred_at, " +
  "json_type(json, '$.githubRepo') AS j_repo_type, " +
  "CASE WHEN json_type(json, '$.githubRepo') IN ('text', 'integer', 'real') " +
  "THEN json_extract(json, '$.githubRepo') END AS j_repo_scalar, " +
  "json_extract(json, '$.githubRepo.observedAt') AS j_repo_observed_at, " +
  "json_extract(json, '$.sources') AS j_sources FROM events ";

export function readerIndexQueries(sources) {
  const ids = [...new Set([...(sources || [])].map(String).filter(Boolean))].sort();
  if (!ids.length) return [];
  return chunk(ids).map((part) => ({
    sql: EVENT_META_SELECT +
      `WHERE json_extract(json, '$.source') IN (${placeholders(part.length)}) AND (category IS NULL OR category <> 'hidden')`,
    binds: part,
  }));
}

// Preserve the legacy table traversal order for latest/opensource tie breaks.
export const FEED_INDEX_SQL = EVENT_META_SELECT +
  "WHERE (category IS NULL OR category <> 'hidden') ORDER BY rowid";

export function eventsByIdsQueries(ids) {
  const list = [...new Set([...(ids || [])].map(String).filter(Boolean))];
  if (!list.length) return [];
  return chunk(list).map((part) => ({
    sql: `SELECT id, json FROM events WHERE ${inClause("id", part)}`,
    binds: part,
  }));
}

/// Map a metadata row (snake_case + j_ projections) onto the camelCase shape
/// the reader filter/sort helpers expect. Exact same field precedence as the
/// stored event JSON.
export function readerMetaFromRow(r) {
  let sources;
  if (typeof r.j_sources === "string" && r.j_sources) {
    try {
      const parsed = JSON.parse(r.j_sources);
      if (Array.isArray(parsed)) sources = parsed;
    } catch {
      sources = undefined;
    }
  } else if (Array.isArray(r.j_sources)) {
    sources = r.j_sources;
  }
  return {
    id: r.id,
    source: r.j_source ?? "",
    category: r.category ?? undefined,
    title: r.title ?? "",
    titleZh: r.title_zh ?? "",
    overviewZh: r.overview_zh ?? "",
    summary: r.j_summary ?? "",
    summaryZh: r.j_summary_zh ?? "",
    url: r.j_url ?? "",
    publishedAt: r.j_published_at || r.published_at || "",
    occurredAt: r.j_occurred_at || r.occurred_at || "",
    observedAt: r.j_observed_at || "",
    firstSeenAt: r.j_first_seen_at || r.first_seen_at || "",
    seenAt: r.j_seen_at || "",
    githubRepo: (["object", "array", "true"].includes(r.j_repo_type) || Boolean(r.j_repo_scalar))
      ? { observedAt: r.j_repo_observed_at || "" } : null,
    sources,
  };
}
