/** Classify heuristics. No network. No rank-based breaking. */

export const HOT_SOURCES = new Set(["weibo", "baidu", "toutiao", "hot"]);
export const TECH_SOURCES = new Set(["hn", "hackernews", "github", "36kr", "kr", "ithome", "qbitai", "v2ex", "techcrunch", "verge", "openai"]);
export const WORLD_SOURCES = new Set(["wallstreetcn", "bbc"]);

export const LAB_RE =
  /DeepSeek|OpenAI|\u82f1\u4f1f\u8fbe|NVIDIA|\u534e\u4e3a|Kimi|\bK3\b|Qwen|Claude|GPT|Gemini/i;
export const STRONG_RE = /\u53d1\u5e03|\u5f00\u6e90|\u51fb\u8d25|\u540a\u6253|\u5e02\u503c|\u5d29|\u7a81\u7834|\u8d85\u8d8a/;
export const HARD_IMPACT_RE =
  /\u53bb\u4e16|\u901d\u4e16|\u75c5\u901d|\u9047\u96be|\u7a7a\u96be|\u5730\u9707|\u5ba3\u6218|\u5f00\u6218|\u5d29\u76d8|\u5e02\u503c\u84b8\u53d1|\u706b\u5316|\u9057\u4f53|\u8ffd\u60bc\u4f1a/;
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
  if (WORLD_SOURCES.has(s)) return "world";
  return "other";
}

/**
 * @param {{ title?: string, source?: string, rank?: number }} event
 * @param {Array<{ title?: string, source?: string }>} [allEvents]
 * @returns {{ level: "breaking" | "normal", reason: string }}
 */
function eventDecay(event, now = Date.now()) {
  const t = Date.parse(event?.publishedAt || event?.seenAt || "");
  const ageH = (now - (Number.isFinite(t) ? t : now)) / 3600000;
  if (ageH <= 6) return 1;
  if (ageH <= 24) return 0.6;
  if (ageH <= 72) return 0.3;
  return 0.1;
}

export function classify(event, allEvents = []) {
  const title = event?.title || "";
  const decay = eventDecay(event);

  if (HARD_IMPACT_RE.test(title)) {
    return { level: "breaking", reason: "hard impact keyword" };
  }

  if (VETO_RE.test(title)) {
    return { level: "normal", reason: "veto entertainment unless hard impact" };
  }

  if (LAB_RE.test(title) && STRONG_RE.test(title) && decay >= 0.6) {
    return { level: "breaking", reason: "tech source hit lab + strong event" };
  }

  const norm = normalizeTitle(title);
  if (norm) {
    const families = new Set();
    const sources = new Set();
    for (const e of [event, ...allEvents]) {
      if (normalizeTitle(e?.title) !== norm) continue;
      const f = sourceFamily(e?.source);
      if (f !== "other") families.add(f);
      const src = String(e?.source || "").toLowerCase();
      if (src) sources.add(src);
    }
    const heat = Math.min(sources.size, 5);
    if (families.size >= 2 && heat >= 3 && decay >= 0.6) {
      return { level: "breaking", reason: "cross-family heat" };
    }
  }

  return { level: "normal", reason: "no breaking rule matched" };
}
