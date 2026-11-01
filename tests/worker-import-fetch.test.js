import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportFetch } from '../worker/src/import-fetch.js';

test('same-origin RSS resolves public assets without credentials or recursive API dispatch', async () => {
  let calls = 0;
  const fetcher = createImportFetch('https://quack.weichao.ren', {fetch: async req => {
    calls++;
    assert.equal(req.url, 'https://quack.weichao.ren/guide/reader.xml');
    assert.equal(req.headers.get('cookie'), null);
    assert.equal(req.headers.get('authorization'), null);
    assert.equal(req.redirect, 'manual');
    return new Response('<rss/>', {headers: {'content-type': 'application/xml'}});
  }}, () => { throw Error('self-origin network fetch'); });
  assert.equal(await (await fetcher('https://quack.weichao.ren/guide/reader.xml', {headers:{cookie:'secret', authorization:'secret'}})).text(), '<rss/>');
  assert.equal((await fetcher('https://quack.weichao.ren/api/v1/feeds')).status, 404);
  assert.equal(calls, 1);
});
test('external RSS retains normal network fetch options and missing assets falls back', async () => {
  for (const assets of [undefined, {fetch: () => { throw Error('wrong binding'); }}]) {
    const options = {redirect:'manual'};
    const fetcher = createImportFetch('https://quack.weichao.ren', assets, async (url, init) => {
      assert.equal(url, 'https://publisher.example/rss'); assert.equal(init, options);
      return new Response('feed');
    });
    assert.equal(await (await fetcher('https://publisher.example/rss', options)).text(), 'feed');
  }
});
