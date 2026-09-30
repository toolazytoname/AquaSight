// Run after cross-client-server.mjs, alongside the opt-in native UI test.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const base="http://127.0.0.1:8798";
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:"block"});
const page=await context.newPage();
page.on("pageerror",e=>console.log("Page error",e.message));
const phase=async value=>{await fetch(base+"/__test__/phase?value="+value,{method:"POST"});};
const waitPhase=async value=>{for(let i=0;i<360;i++){const result=await(await fetch(base+"/__test__/phase")).json();if(result.phase===value)return;await new Promise(r=>setTimeout(r,1000));}throw new Error("Timeout waiting for "+value);};
const json=async path=>{const response=await context.request.get(base+path);assert.equal(response.status(),200);return response.json();};
try {
  await page.goto(base+"/#/reader-settings");
  await page.locator('.tools [data-action="settings"]').click();
  await page.locator('#modal [data-action="login"]').click();
  await page.locator("#login-email").fill("cross-client@example.com");
  await page.locator("#login-password").fill("Reader-test-2026!");
  await page.locator("#login-do").click();
  await page.locator("#reader-more").waitFor();
  await page.locator('[data-reader-source][value="openai"]').check();
  const saved=page.waitForResponse(r=>r.url().endsWith("/reader/settings")&&r.request().method()==="PUT"&&r.ok());
  await page.locator("#reader-save").click(); await saved;
  await page.goto(base+"/#/event/cross-web");
  await page.locator('[data-act="save"][data-id="cross-web"]').click();
  await page.waitForFunction(()=>document.querySelector('[data-act="save"][data-id="cross-web"]')?.getAttribute("aria-pressed")==="true");
  for(let i=0;i<30;i++){if((await json("/api/v1/favorites")).items.some(x=>x.id==="cross-web"))break;await new Promise(r=>setTimeout(r,200));}
  assert.ok((await json("/api/v1/favorites")).items.some(x=>x.id==="cross-web"));
  await phase("web-ready"); console.log("Web password login, subscription selection and favorite creation passed; ready for native.");
  await waitPhase("native-saved");
  await page.goto(base+"/#/saved");
  await page.locator('[data-act="save"][data-id="cross-ios"]').waitFor();
  assert.ok((await json("/api/v1/reader/settings")).reader.selectedSources.includes("huggingface"));
  await mkdir("docs/reviews/ios-password-2026-09-28",{recursive:true});
  await page.screenshot({path:"docs/reviews/ios-password-2026-09-28/cross-client-web.png",fullPage:true});
  await page.locator('[data-act="save"][data-id="cross-ios"]').click();
  for(let i=0;i<30;i++){if(!(await json("/api/v1/favorites")).items.some(x=>x.id==="cross-ios"))break;await new Promise(r=>setTimeout(r,200));}
  assert.ok(!(await json("/api/v1/favorites")).items.some(x=>x.id==="cross-ios"));
  await page.goto(base+"/#/reader-settings");
  await page.locator('[data-reader-source][value="huggingface"]').uncheck();
  const updated=page.waitForResponse(r=>r.url().endsWith("/reader/settings")&&r.request().method()==="PUT"&&r.ok());
  await page.locator("#reader-save").click(); await updated;
  await phase("web-updated");
  await waitPhase("complete");
  await writeFile("/tmp/aquasight-cross-client-result.json",JSON.stringify({passed:true, checks:["Web password UI login","Web subscriptions to native","Web favorite to native","Native password UI login","Native favorite to Web","Native subscription to Web","Web deletion to native","Native logout isolation"]},null,2));
  console.log("PASS: bidirectional Web and native UI sync on real HTTP/auth/store.");
} finally {await browser.close();}
