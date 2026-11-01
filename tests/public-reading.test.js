import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { handleApi } from '../src/api/handlers.js';
import { startServer } from '../src/server.js';
import { createMemoryStore } from '../src/store/memory.js';
import { beijingYmd } from '../src/time.js';

async function seedPublicEdition() {
  const store = createMemoryStore();
  const publishedAt = new Date(Date.now() - 3600_000).toISOString();
  const items = ['openai', 'bbc', 'github'].map((source, i) => ({
    id: 'public-' + source, source, category: source === 'bbc' ? 'public' : 'tech',
    title: 'Public story ' + source, titleZh: '公开文章 ' + source,
    summary: 'Public original summary.', overviewZh: '公开摘要，所有人都可以阅读。',
    value: .96 - i * .02, publishedAt, firstSeenAt: publishedAt, url: 'https://example.com/' + source,
    ...(source === 'github' ? { githubRepo: { fullName: 'community/project', observedAt: publishedAt, stars: 200 } } : {}),
  }));
  for (const item of items) await store.putEvent(item);
  await store.putSnapshot('events', { items, featured: items.map(item => item.id) });
  await store.putSnapshot('digest:' + beijingYmd(), {
    date: beijingYmd(), items, tech: items.filter(item => item.category === 'tech'), business: [], public: items.filter(item => item.category === 'public'),
  });
  return { store, items };
}

test('public API: news, full daily edition and details work anonymously; personal data stays private', async () => {
  const { store, items } = await seedPublicEdition();
  const env = { store, authMode: 'otp', requireAuth: true };
  const get = path => handleApi(new Request('http://localhost' + path), env);
  await store.putFavorite('legacy-private', { id: 'legacy-private', title: 'PRIVATE_LEGACY', readerNote: 'SECRET_NOTE' });
  await store.putFavorite('owner-private', { id: 'owner-private', title: 'PRIVATE_OWNER' }, { userId: 'owner' });
  await store.putUserFeed({ feedId: 'private-feed', url: 'https://private.example/rss', name: 'PRIVATE_FEED' }, { userId: 'owner' });
  await store.setUserFeedItems('private-feed', [{ id: 'pfi:private', title: 'PRIVATE_FEED_ITEM', url: 'https://private.example/1' }], { userId: 'owner' });
  for (const view of ['featured', 'latest', 'opensource']) {
    const response = await get('/api/v1/events?view=' + view);
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.ok(data.items.length);
    assert.ok(data.items.every(item => item.id.startsWith('public-')));
    assert.equal(JSON.stringify(data).includes('PRIVATE_'), false);
  }
  const detail = await get('/api/v1/events/public-bbc');
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).item.id, 'public-bbc');
  // Project private notes away even if an old digest snapshot contains them.
  await store.putSnapshot('digest:' + beijingYmd(), {
    date: beijingYmd(), items: items.map(item => ({ ...item, readerNote: 'SECRET_NOTE', readerTags: ['SECRET_TAG'] })),
    tech: [{ ...items[0], readerNote: 'SECRET_NOTE' }], business: [], public: [items[1]],
  });
  const digest = await get('/api/v1/digest');
  assert.equal(digest.status, 200);
  const body = await digest.json();
  assert.equal(body.digest.items.length, 3);
  assert.ok(body.digest.items.some(item => item.source === 'bbc'));
  assert.equal(JSON.stringify(body).includes('SECRET_'), false);
  for (const path of ['/api/v1/favorites', '/api/v1/settings', '/api/v1/feeds', '/api/v1/export']) assert.equal((await get(path)).status, 401, path);
  for (const id of ['legacy-private', 'owner-private', 'pfi:private']) assert.equal((await get('/api/v1/events/' + id)).status, 404, id);
  const write = await handleApi(new Request('http://localhost/api/v1/reader/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selectedSources: ['bbc'] }) }), env);
  assert.equal(write.status, 401);
});

test('public web: clean visitor reads every section and digest without account services or subscriptions', async () => {
  const { store } = await seedPublicEdition();
  const server = await startServer({ store, port: 0 });
  const browser = await chromium.launch({ headless: true });
  let releaseAccount;
  const accountHeld = new Promise(resolve => { releaseAccount = resolve; });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route(/\/api\/v1\/(me|reads|favorites|reader\/catalog)(\?|$)/, async route => {
      await accountHeld;
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"account service unavailable"}' });
    });
    const base = 'http://127.0.0.1:' + server.port;
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.locator('#list .story').first().waitFor({ timeout: 5000 });
    assert.match(page.url(), /#\/featured$/);
    assert.equal(await page.locator('.reader-onboarding').count(), 0);
    assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
    assert.equal(await page.evaluate(() => localStorage.getItem('aquasight-reader-guest')), null);
    for (const view of ['latest', 'opensource']) {
      await page.locator(`[data-reading-mode="${view}"]`).click();
      await page.locator('#list .story').first().waitFor();
      assert.equal(await page.locator('.reader-onboarding').count(), 0);
    }
    await page.locator('[data-reading-mode="digest"]').click();
    await page.locator('.digest-story').first().waitFor();
    assert.equal(await page.locator('.digest-story').count(), 3);
    await page.locator('.digest-story h2 a').filter({ hasText: 'bbc' }).click();
    await page.locator('#detail h1').waitFor();
    assert.match(await page.locator('#detail h1').textContent(), /bbc/);
    assert.equal(page.url().includes('reader=1'), false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#detail h1').waitFor();
    assert.match(await page.locator('#detail h1').textContent(), /bbc/);
    releaseAccount();
    await page.locator('.bottom-nav [data-view="featured"]').click();
    await page.locator('#list .story').first().waitFor();
    await page.locator('.save-btn').first().click();
    await page.locator('.bottom-nav [data-view="saved"]').click();
    await page.locator('.library-card').first().waitFor();
    assert.equal(await page.locator('#modal').evaluate(el => el.open), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    releaseAccount();
    await browser.close();
    await new Promise(resolve => server.server.close(resolve));
  }
});
