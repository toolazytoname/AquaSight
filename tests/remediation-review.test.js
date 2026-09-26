import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ensureDigestScheduled, ensureCollectScheduled, schedulerStatus } from '../src/scheduler.js';
import { fetchRemoteDigest } from '../src/remote.js';
import { extractFeaturedBodies, collectOnce } from '../src/pipeline.js';
import { createMemoryStore } from '../src/store/memory.js';
import { ingestPayload } from '../src/ingest.js';
const env = { GITHUB_REPO: 'owner/repo', GITHUB_DISPATCH_TOKEN: 'test' };
const now = new Date('2026-09-26T08:35:00Z');
function github(active = false) {
  return async (url, init = {}) => {
    if (init.method === 'POST') return new Response(null, { status: 204 });
    return Response.json(String(url).includes('/runs?') ? { workflow_runs: active ? [{ status: 'in_progress' }] : [] } : { default_branch: 'main' });
  };
}
test('scheduler uses runtime fetch and does not mistake missing placeholder for publication', async () => {
  const store = createMemoryStore();
  await store.putSnapshot('digest:2026-09-26', { date: '2026-09-26', items: [], missing: true });
  const original = globalThis.fetch;
  globalThis.fetch = github();
  try {
    const result = await ensureDigestScheduled({ store, now, env });
    assert.equal(result.dispatched, true);
  } finally { globalThis.fetch = original; }
});
test('active collect runs do not exhaust retries and collect slot state is visible', async () => {
  const store = createMemoryStore();
  for (let i = 0; i < 4; i++) {
    const result = await ensureCollectScheduled({ store, env, now: new Date(now.getTime() + i * 60000), fetchImpl: github(true) });
    assert.equal(result.skipped, 'in-progress');
  }
  const status = await schedulerStatus(store, { now, env });
  assert.equal(status.slots.collect.length, 1);
  assert.equal(status.slots.collect[0].attempts, 0);
  const result = await ensureCollectScheduled({ store, env, now, fetchImpl: github() });
  assert.equal(result.dispatched, true);
});
test('remote history fails closed on malformed shape and mismatched missing response', async () => {
  for (const data of [{}, { digest: { missing: true } }, { digest: { date: '2026-09-25', missing: true, items: [] } }]) {
    await assert.rejects(fetchRemoteDigest({ date: '2026-09-26', apiBase: 'https://example.com', fetchImpl: async () => Response.json(data) }), /shape mismatch/);
  }
  assert.equal(await fetchRemoteDigest({ date: '2026-09-26', apiBase: 'https://example.com', fetchImpl: async () => Response.json({ digest: { date: '2026-09-26', missing: true, items: [] } }) }), null);
});
test('automatic article fetch rejects private targets, private redirects and oversized bodies', async () => {
  let calls = 0;
  const opts = { lookupImpl: async () => ['93.184.216.34'], bodyFetchImpl: async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }); } };
  const [privateItem] = await extractFeaturedBodies([{ id: 'a', url: 'http://127.0.0.1/private' }], opts);
  assert.equal(calls, 0);
  assert.equal(privateItem.body, undefined);
  const [redirected] = await extractFeaturedBodies([{ id: 'b', url: 'https://example.com/a' }], opts);
  assert.equal(calls, 1);
  assert.equal(redirected.body, undefined);
  const [large] = await extractFeaturedBodies([{ id: 'c', url: 'https://example.com/c' }], { ...opts, bodyFetchImpl: async () => new Response('x'.repeat(500001)) });
  assert.equal(large.body, undefined);
});
test('collector accounts for real model fetches and preserves diagnostics through ingest', async () => {
  const store = createMemoryStore();
  let requests = 0;
  const payload = await collectOnce({ store, now, raw: [{ id: 'chip', articleId: 'chip', title: 'Chip company releases a new processor', category: 'tech', source: 'ithome', url: 'https://example.com/chip', publishedAt: now.toISOString() }], enrich: true, extractBody: false, skipNotify: true, apiKey: 'test', model: 'free', baseUrl: 'https://relay.test/v1', usdPerMtokIn: 0, usdPerMtokOut: 0, fetchImpl: async () => {
    requests++;
    return Response.json({ choices: [{ message: { content: JSON.stringify({ category: 'tech', titleZh: '芯片公司发布新处理器', overviewZh: '芯片公司发布新处理器。', entities: [], facts: ['芯片公司发布新处理器。'], impact: '', evidence: [], uncertainty: [], attribution: [], insufficient: false }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 200 } });
  } });
  assert.ok(requests > 0);
  assert.equal(payload.diagnostics.ai.fetch.requests, requests);
  assert.equal(payload.diagnostics.ai.fetch.httpOk, requests);
  assert.ok(payload.diagnostics.ai.ready > 0);
  const remote = createMemoryStore();
  await ingestPayload(remote, payload);
  assert.deepEqual((await remote.getSnapshot('events')).json.diagnostics.ai, payload.diagnostics.ai);
});
