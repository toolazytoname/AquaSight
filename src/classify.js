/** Classify heuristics. No network. No rank-based breaking. */

export const HOT_SOURCES = new Set(["weibo", "baidu", "toutiao", "hot"]);
export const TECH_SOURCES = new Set(["hn", "hackernews", "github", "36kr", "kr"]);

export const LAB_RE =
  /DeepSeek|OpenAI|\u82f1\u4f1f\u8fbe|NVIDIA|\u534e\u4e3a|Kimi|\bK3\b|Qwen|Claude|GPT|Gemini/i;
export const STRONG_RE = /\u53d1\u5e03|\u5f00\u6e90|\u51fb\u8d25|\u540a\u6253|\u5e02\u503c|\u5d29|\u7a81\u7834|\u8d85\u8d8a/;
export const HARD_IMPACT_RE =
  /\u53bb\u4e16|\u901d\u4e16|\u75c5\u901d|\u9047\u96be|\u7a7a\u96be|\u5730\u9707|\u5ba3\u6218|\u5f00\u6218|\u5d29\u76d8|\u5e02\u503c\u84b8\u53d1/;
export const VETO_RE =
  /\u80d6\u4e1c\u6765|\u4f60\u597d\u661f\u671f\u516d|\u8dd1\u7537|\u604b\u7efc|\u7efc\u827a|\u665a\u4f1a/;

export function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

export function sourceFamily(source) {
  const s = String(source || "").toLowerCase();
  if (HOT_SOURCES.has(s)) return "hot";
  if (TECH_SOURCES.has(s)) return "tech";
  return "other";
}

/**
 * @param {{ title?: string, source?: string, rank?: number }} event
 * @param {Array<{ title?: string, source?: string }>} [allEvents]
 * @returns {{ level: "breaking" | "normal", reason: string }}
 */
export function classify(event, allEvents = []) {
  const title = event?.title || "";
  const family = sourceFamily(event?.source);

  if (HARD_IMPACT_RE.test(title)) {
    return { level: "breaking", reason: "hard impact keyword" };
  }

  if (VETO_RE.test(title)) {
    return { level: "normal", reason: "veto entertainment unless hard impact" };
  }

  if (family === "tech" && LAB_RE.test(title) && STRONG_RE.test(title)) {
    return { level: "breaking", reason: "tech source hit lab + strong event" };
  }

  const norm = normalizeTitle(title);
  if (norm) {
    const families = new Set();
    for (const e of [event, ...allEvents]) {
      if (normalizeTitle(e?.title) !== norm) continue;
      const f = sourceFamily(e?.source);
      if (f !== "other") families.add(f);
    }
    if (families.has("hot") && families.has("tech")) {
      return { level: "breaking", reason: "same title across hot + tech" };
    }
  }

  return { level: "normal", reason: "no breaking rule matched" };
}
