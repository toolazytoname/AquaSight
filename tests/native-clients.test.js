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
