// Opt-in local harness: real HTTP/auth/store, loopback only; no real email.
import { createMemoryStore } from "../../src/store/memory.js";
import { startServer } from "../../src/server.js";
import { requestCode, resetPassword } from "../../src/auth.js";
import { writeFile } from "node:fs/promises";
process.env.AUTH_MODE = "otp";
process.env.MAIL_DRIVER = "log";
const store = createMemoryStore();
const email = "cross-client@example.com", password = "Reader-test-2026!";
const challenge = await requestCode(store, { email, ip: "local-test" }, { MAIL_DRIVER: "log", exposeOtp: true });
const account = await resetPassword(store, { email, password, code: challenge.debugCode });
if (!account.ok) throw new Error("test account setup failed");
for (const [id,title] of [["cross-web","网页加入的阅读"],["cross-ios","手机加入的阅读"]]) {
  await store.putEvent({ id, title, source:"openai", url:"https://openai.com/", category:"tech", publishedAt:new Date().toISOString(), firstSeenAt:new Date().toISOString(), value:0.9, overviewZh:"用于双端联测的本地内容，不写入生产数据。" });
}
const server = await startServer({ store, port: 8798 });
const existing = server.server.listeners("request"); server.server.removeAllListeners("request");
let phase = "seeded";
server.server.on("request", async (req,res) => {
  if (req.url?.startsWith("/__test__/phase")) {
    const url = new URL(req.url,"http://127.0.0.1");
    if (req.method === "POST") phase = url.searchParams.get("value") || phase;
    res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({ phase }));return;
  }
  existing[0](req,res);
});
await writeFile("/tmp/aquasight-cross-client-ready.json",JSON.stringify({ base:"http://127.0.0.1:8798" }));
console.log("Loopback cross-client server ready; test-only account seeded.");
