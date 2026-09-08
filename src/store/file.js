import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { createMemoryStore } from "./memory.js";

export async function loadFileStore(path) {
  let seed = {};
  try {
    seed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    seed = {};
  }
  const store = createMemoryStore(seed);
  store.kind = "file";
  store.path = path;
  const persist = async () => {
    await mkdir(dirname(path), { recursive: true });
    const json = JSON.stringify(await store.exportAll(), null, 2) + "\n";
    const tmp = path + ".tmp";
    await writeFile(tmp, json, "utf8");
    await rename(tmp, path);
  };
  const wrap = (name) => {
    const orig = store[name].bind(store);
    store[name] = async (...args) => {
      const result = await orig(...args);
      if (
        name.startsWith("put") ||
        name.startsWith("set") ||
        name.startsWith("add") ||
        name.startsWith("map") ||
        name.startsWith("delete") ||
        name === "acquireLock" ||
        name === "releaseLock" ||
        name === "importAll"
      ) {
        await persist();
      }
      return result;
    };
  };
  for (const name of Object.keys(store)) {
    if (typeof store[name] === "function" && name !== "exportAll" && name !== "articleEventMap") {
      wrap(name);
    }
  }
  store.persist = persist;
  return store;
}
