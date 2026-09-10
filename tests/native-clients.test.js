import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

async function collect(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await collect(p, out);
    else out.push(p);
  }
  return out;
}

test("android is a committed kotlin reading app with encrypted session", async () => {
  const android = join(root, "clients/android");
  const files = await collect(android);
  const rel = files.map((f) => f.slice(android.length + 1)).join("\n");
  assert.match(rel, /MainActivity\.kt/);
  assert.match(rel, /AndroidManifest\.xml/);
  assert.match(rel, /app\/build\.gradle/);
  const src = (
    await Promise.all(files.filter((f) => f.endsWith(".kt") || f.endsWith(".xml")).map((f) => readFile(f, "utf8")))
  ).join("\n");
  for (const label of ["精选", "最新", "早报", "收藏"]) assert.match(src, new RegExp(label));
  assert.match(src, /搜索标题或概述/);
  assert.match(src, /EncryptedSharedPreferences/);
  assert.match(src, /Authorization/);
  assert.match(src, /Bearer/);
  assert.match(src, /\/api\/v1\/sync\/merge/);
  assert.match(src, /deleted/);
  assert.match(src, /#\/event\//);
  assert.match(src, /request-code/);
  assert.match(src, /auth\/verify/);
  const manifest = await readFile(join(android, "app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /MAIN/);
  assert.match(manifest, /LAUNCHER/);
  assert.match(manifest, /VIEW/);
  assert.match(manifest, /aquasight\.lazywc\.workers\.dev/);
});

test("ios is a committed swift reading app with keychain session", async () => {
  const ios = join(root, "clients/ios");
  const files = await collect(ios);
  const rel = files.map((f) => f.slice(ios.length + 1)).join("\n");
  assert.match(rel, /App\.swift/);
  assert.match(rel, /ContentView\.swift/);
  assert.match(rel, /AquaSight\.xcodeproj\/project\.pbxproj/);
  const src = (
    await Promise.all(files.filter((f) => f.endsWith(".swift") || f.endsWith(".plist") || f.endsWith("pbxproj")).map((f) => readFile(f, "utf8")))
  ).join("\n");
  for (const label of ["精选", "最新", "早报", "收藏"]) assert.match(src, new RegExp(label));
  assert.match(src, /搜索标题或概述/);
  assert.match(src, /kSecClassGenericPassword/);
  assert.match(src, /KeychainStore/);
  assert.equal(src.includes("UserDefaults.standard.set(token"), false);
  assert.match(src, /Authorization/);
  assert.match(src, /Bearer/);
  assert.match(src, /\/api\/v1\/sync\/merge/);
  assert.match(src, /deleted/);
  assert.match(src, /#\/event\//);
  assert.match(src, /request-code/);
  assert.match(src, /auth\/verify/);
  assert.match(src, /@main/);
  const pbx = await readFile(join(ios, "AquaSight.xcodeproj/project.pbxproj"), "utf8");
  assert.match(pbx, /PBXNativeTarget/);
  assert.match(pbx, /com.apple.product-type.application/);
  await stat(join(ios, "AquaSight/Info.plist"));
});

test("android onNewIntent feeds eventIdFrom into Compose incomingEventId", async () => {
  const src = await readFile(join(root, "clients/android/app/src/main/java/com/aquasight/app/MainActivity.kt"), "utf8");
  const onNew = src.split("override fun onNewIntent")[1];
  assert.ok(onNew, "onNewIntent missing");
  const body = onNew.slice(0, onNew.indexOf("\n}"));
  assert.match(body, /setIntent\(intent\)/);
  assert.match(body, /incomingEventId\.value = eventIdFrom\(intent\)/);
  const parser = src.slice(src.indexOf("fun eventIdFrom"), src.indexOf("private val Ink"));
  assert.match(parser, /fragment\.startsWith\("\/event\/"\)/);
  const href = "https://aquasight.lazywc.workers.dev/#/event/evt:warm";
  const u = new URL(href);
  assert.equal(u.hash, "#/event/evt:warm");
  assert.equal(u.hash.replace(/^#/, "").replace(/^\/event\//, ""), "evt:warm");
  const launched = src.slice(src.indexOf("LaunchedEffect(incomingEventId.value)"));
  assert.match(launched, /openEvent\(id\)/);
});

test("android login overlay renders the OTP notice text", async () => {
  const src = await readFile(join(root, "clients/android/app/src/main/java/com/aquasight/app/MainActivity.kt"), "utf8");
  const login = src.split("if (showLogin)")[1].split("if (showSettings)")[0];
  assert.match(login, /if \(notice\.isNotBlank\(\)\) Text\(notice/);
  assert.match(login, /暂时发不出验证码/);
  assert.match(login, /验证码无效或已过期/);
  assert.match(login, /已提交。验证码 10 分钟内有效。/);
  const settings = src.split("if (showSettings)")[1].split("@Composable\nprivate fun Overlay")[0];
  assert.match(settings, /if \(notice\.isNotBlank\(\)\) Text\(notice/);
});

test("ios login and settings sheets bind model.notice", async () => {
  const src = await readFile(join(root, "clients/ios/AquaSight/ContentView.swift"), "utf8");
  const login = src.split("var login:")[1].split("var settings:")[0];
  assert.match(login, /model\.notice/);
  assert.match(login, /发送验证码/);
  const settings = src.split("var settings:")[1];
  assert.match(settings, /model\.notice/);
  const app = await readFile(join(root, "clients/ios/AquaSight/App.swift"), "utf8");
  assert.match(app, /notice = "已提交。验证码 10 分钟内有效。"/);
  assert.match(app, /notice = "暂时发不出验证码"/);
  assert.match(app, /notice = "验证码无效或已过期"/);
});

