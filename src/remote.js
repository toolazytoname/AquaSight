export async function loadRemotePrefs(opts = {}) {
  const ingestUrl = opts.ingestUrl || process.env.INGEST_URL || "";
  const token = opts.token || process.env.INGEST_TOKEN || "";
  const base =
    opts.apiBase ||
    process.env.API_BASE_URL ||
    String(ingestUrl).replace(/\/api\/v1\/ingest\/?$/, "");
  if (!base || !token) return null;
  const fetchImpl = opts.fetchImpl || fetch;
  const res = await fetchImpl(String(base).replace(/\/$/, "") + "/api/v1/settings", {
    headers: { Authorization: "Bearer " + token, Accept: "application/json" },
  });
  if (!res || !res.ok) return null;
  const data = await res.json();
  return data.prefs || null;
}
