import { mkdir, readFile, writeFile, rename, open, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { createMemoryStore } from "./memory.js";

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function withWriteLock(lockPath, fn) {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let i = 0; i < 50; i++) {
    try {
      const fh = await open(lockPath, "wx");
      try {
        return await fn();
      } finally {
        await fh.close();
        await rm(lockPath, { force: true });
      }
    } catch (e) {
      if (e && e.code === "EEXIST") {
        try {
          const st = await stat(lockPath);
          if (Date.now() - st.mtimeMs > 30000) await rm(lockPath, { force: true });
        } catch {
          // gone
        }
        await sleep(15);
        continue;
      }
      throw e;
    }
  }
  throw new Error("write lock timeout");
}

function isMutating(name) {
  return (
    name.startsWith("put") ||
    name.startsWith("set") ||
    name.startsWith("add") ||
    name.startsWith("map") ||
    name.startsWith("delete") ||
    name === "applyFeed" ||
    name === "importAll" ||
    name === "purgeExpired"
  );
}

export async function loadFileStore(path) {
  await mkdir(dirname(path), { recursive: true });
  let seed = {};
  try {
    seed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    seed = {};
  }
  const store = createMemoryStore(seed);
  store.kind = "file";
  store.path = path;
  const writeLock = path + ".writelock";
  const raw = {};
  for (const name of Object.keys(store)) {
    if (typeof store[name] === "function") raw[name] = store[name].bind(store);
  }

  async function reload() {
    let next = {};
    try {
      next = JSON.parse(await readFile(path, "utf8"));
    } catch (e) {
      if (e && e.code === "ENOENT") next = {};
      else throw e;
    }
    await raw.importAll(next);
  }

  async function saveUnlocked() {
    await mkdir(dirname(path), { recursive: true });
    const json = JSON.stringify(await raw.exportAll(), null, 2) + "\n";
    const tmp = path + ".tmp." + process.pid + "." + randomBytes(4).toString("hex");
    await writeFile(tmp, json, "utf8");
    await rename(tmp, path);
  }

  for (const name of Object.keys(raw)) {
    if (name === "articleEventMap") continue;
    store[name] = async (...args) => {
      return withWriteLock(writeLock, async () => {
        await reload();
        const result = await raw[name](...args);
        if (isMutating(name)) await saveUnlocked();
        return result;
      });
    };
  }

  store.acquireLock = async (name, untilIso) => {
    await mkdir(dirname(path), { recursive: true });
    const lockPath = path + ".lock." + name;
    const payload = JSON.stringify({ until: untilIso, pid: process.pid, token: randomBytes(8).toString("hex") });
    for (let i = 0; i < 8; i++) {
      try {
        const fh = await open(lockPath, "wx");
        await fh.write(Buffer.from(payload));
        await fh.close();
        return true;
      } catch (e) {
        if (!e || e.code === "ENOENT") {
          await mkdir(dirname(path), { recursive: true });
          continue;
        }
        if (e.code !== "EEXIST") throw e;
        let rawLock;
        try {
          rawLock = JSON.parse(await readFile(lockPath, "utf8"));
        } catch (e2) {
          if (e2 && e2.code === "ENOENT") continue;
          return false;
        }
        if (rawLock && Date.parse(rawLock.until) > Date.now()) return false;
        let again;
        try {
          again = JSON.parse(await readFile(lockPath, "utf8"));
        } catch (e2) {
          if (e2 && e2.code === "ENOENT") continue;
          return false;
        }
        if (!again || again.token !== rawLock.token) return false;
        if (Date.parse(again.until) > Date.now()) return false;
        try {
          await rm(lockPath, { force: true });
        } catch {
          return false;
        }
      }
    }
    return false;
  };
  store.releaseLock = async (name) => {
    await rm(path + ".lock." + name, { force: true });
  };
  store.persist = () =>
    withWriteLock(writeLock, async () => {
      await reload();
      await saveUnlocked();
    });
  return store;
}
