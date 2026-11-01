import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const script = await readFile(new URL('../web/public-language.js', import.meta.url), 'utf8');
function run({ current='zh-CN', browser='en-US', saved, query='', blocked=false }={}) {
  let redirected, stored=saved;
  const context={
    URL, URLSearchParams,
    document:{documentElement:{lang:current,dataset:{publicPage:'support'}},querySelectorAll:()=>[]},
    navigator:{language:browser},
    location:{search:query,hash:'#accounts',href:'https://quack.weichao.ren/support.html'+query+'#accounts',replace:url=>redirected=url},
    localStorage:{getItem:()=>{if(blocked)throw Error('blocked');return stored;},setItem:(_,value)=>{stored=value;}},
  };
  vm.runInNewContext(script,context);
  return {redirected,stored};
}
test('public pages follow browser language and preserve section links',()=>{
  assert.equal(run().redirected,'https://quack.weichao.ren/support-en.html#accounts');
  assert.equal(run({saved:'en'}).redirected,'https://quack.weichao.ren/support-en.html#accounts');
  assert.equal(run({current:'en',saved:'en'}).redirected,undefined);
});
test('explicit public page language wins over saved preference and persists',()=>{
  assert.deepEqual(run({saved:'en',query:'?lang=zh'}),{redirected:undefined,stored:'zh'});
  assert.equal(run({current:'en',saved:'zh'}).redirected,'https://quack.weichao.ren/support.html#accounts');
});
test('unavailable local storage does not prevent public page language resolution',()=>{
  assert.equal(run({blocked:true}).redirected,'https://quack.weichao.ren/support-en.html#accounts');
  assert.equal(run({browser:'zh-TW',blocked:true}).redirected,undefined);
});
