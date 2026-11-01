import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startServer } from '../src/server.js';
import { createMemoryStore } from '../src/store/memory.js';

// Exercise the new reading controls against real local handlers and storage.
// No public service, private account, or remote feed is used.
test('reading design: discovery routes, density persistence, date groups and responsive themes', async () => {
  const store = createMemoryStore();
  for (const [i, source] of ['openai', 'github', 'openai'].entries()) {
    const publishedAt = new Date(Date.now() - (i === 2 ? 36 : 1) * 3600_000).toISOString();
    await store.putEvent({
      id: `design-${i}`, source, category: 'tech', value: .95,
      title: 'Original headline ' + i, titleZh: '值得阅读的文章 ' + i,
      summary: 'Original summary for reading.', overviewZh: '一段完整的摘要，帮助读者判断是否继续阅读。',
      url: `https://example.com/article/${i}`, publishedAt, firstSeenAt: publishedAt,
      ...(source === 'github' ? { githubRepo: { fullName: 'community/tool', stars: 100, observedAt: publishedAt } } : {}),
    });
  }
  const server = await startServer({ store, port: 0 });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.addInitScript(() => localStorage.setItem('aquasight-reader-guest', JSON.stringify({ selected: ['openai', 'github'], configured: true })));
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const base = `http://127.0.0.1:${server.port}`;
    await page.goto(base + "/#/reader");
    await page.locator('.reader-story').first().waitFor();
    assert.equal(await page.locator('.reader-story').count(), 3);
    assert.equal(await page.locator('.day-group').count(), 2);
    assert.deepEqual(await page.locator('.date-count').allTextContents(), ['2 篇', '1 篇']);
    assert.match(await page.locator('#rail-sources').innerText(), /已订阅 2 个信息源/);
    await page.locator('#density-toggle').click();
    assert.equal(await page.locator('#density-toggle').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('.reader-story .summary').first().isVisible(), false);
    await page.reload();
    await page.locator('.reader-story').first().waitFor();
    assert.equal(await page.locator('#density-toggle').getAttribute('aria-pressed'), 'true');
    await page.locator('#density-toggle').click();
    assert.equal(await page.locator('.reader-story .summary').first().isVisible(), true);
    await page.locator('[data-reading-mode="discover"]').click();
    await page.waitForFunction(() => document.querySelector('#view-title').textContent === '精选');
    assert.equal(await page.locator('[data-reading-mode="discover"]').getAttribute('aria-current'), 'page');
    for (const [view, title] of [['latest', '最新'], ['opensource', '开源项目']]) {
      await page.locator(`[data-reading-mode="${view}"]`).click();
      await page.waitForFunction(title => document.querySelector('#view-title').textContent === title, title);
      assert.equal(await page.locator(`[data-reading-mode="${view}"]`).getAttribute('aria-current'), 'page');
    }
    await page.locator('.nav [data-view="reader"]').click();
    await page.locator('.reader-story').first().waitFor();
    // Narrow phones, tablet, desktop, both themes: no horizontal scrolling.
    for (const width of [320, 390, 768, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(theme => { localStorage.setItem('aquasight-theme', theme); document.documentElement.dataset.theme = theme; }, theme);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${width}px ${theme} overflow`);
        assert.equal(await page.locator('#density-toggle').isVisible(), true);
        assert.equal(await page.locator('#reading-aside').isVisible(), width >= 1200);
      }
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.reader-story h2 a').first().click();
    await page.locator('#detail h1').waitFor();
    assert.equal(await page.locator('#feed-navigation').isVisible(), false);
    assert.equal(await page.locator('#reading-aside').isVisible(), false);
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.server.close(resolve));
  }
});
