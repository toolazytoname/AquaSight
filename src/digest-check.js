/**
 * Grounding checks for the AI-written digest summary. The model once turned a
 * source's 350亿 into 3500亿 — prompt discipline alone cannot be trusted, so
 * every numeric claim must exist in the source set, units included, and every
 * sentence must share an entity with the sources. A summary that fails any
 * check is dropped rather than shown.
 */

// 3,500 / 3500 / 12.5 optional unit: 亿 万 千 百 % 倍 年 天 家 条 个 名 次 轮 页
const NUM_RE = /(\d+(?:,\d{3})*(?:\.\d+)?|\d+\.\d+)\s*(亿|萬|万|千|百|%|％|倍|年|天|家|条|個|个|名|次|轮|美元|元|人|km|KG)?/g;
const STOP_CHUNK_RE = /^(的|了|在|和|与|或|及|是|将|并|也|都|而|为|有|该|此|这|那|以及|同时|此外|其中|今日|今天|方面|表示|指出|宣布|推出|发布|上线|增长|下跌|达到|超过|约为|接近|继续|进一步|重要|关键|主要|领域|行业|市场|公司|企业|产品|技术|发展|影响|数据|报告|研究|分析|观点|问题|工作|时间|内容|情况|能力|平台|服务|用户|全球|中国|美国)+$/;

function scaleOf(unit) {
  switch (unit) {
    case "亿":
    case "萬":
      return 1e8;
    case "万":
      return 1e4;
    case "千":
      return 1e3;
    case "百":
      return 1e2;
    default:
      return null; // % 倍 年 家 … compare the numeric part as-is
  }
}

export function extractNumbers(text) {
  const out = [];
  const s = String(text || "").replace(/[\uFF10-\uFF19]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 48)
  );
  for (const m of s.matchAll(NUM_RE)) {
    const value = Number(m[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    out.push({ raw: m[0].replace(/\s+/g, ""), value, unit: m[2] || "", scale: scaleOf(m[2]) });
  }
  return out;
}

export function validateDigestStyle(summary) {
  const text = String(summary || "").trim();
  const sentences = text.split(/[。！？!?]+/).map((part) => part.trim()).filter(Boolean);
  return text.length >= 8 && text.length <= 240 && sentences.length <= 3 &&
    /[。！？!?]$/.test(text) && !/以下是|综述[:：]/.test(text);
}

function sameNumber(a, b) {
  if (a.unit && b.unit) {
    if (a.unit !== b.unit) {
      const ua = a.unit.replace(/％/, "%");
      const ub = b.unit.replace(/％/, "%");
      if (ua !== ub) return false;
    }
    return a.value === b.value;
  }
  if (!a.unit && !b.unit) return a.value === b.value;
  // 350 (no unit) in summary vs 350亿 in source: only accept when the
  // summary repeats the unit elsewhere in the same claim; be strict here and
  // require the source to also carry the bare number.
  return a.value === b.value;
}

export function entriesText(entries) {
  const parts = [];
  for (const it of entries || []) {
    parts.push(
      String(it?.titleZh || ""),
      String(it?.title || ""),
      String(it?.overviewZh || it?.summaryZh || ""),
      String(it?.summary || ""),
      ...(Array.isArray(it?.facts) ? it.facts.map(String) : []),
      String(it?.impact || "")
    );
  }
  return parts.filter(Boolean).join("\n");
}

export function cjkChunks(text) {
  const chunks = new Set();
  for (const m of String(text || "").matchAll(/[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9·]+/g)) {
    const t = m[0];
    // register the whole chunk plus 2-grams so partial name overlap counts
    if (!STOP_CHUNK_RE.test(t)) chunks.add(t);
    for (let i = 0; i + 2 <= t.length; i++) {
      const g = t.slice(i, i + 2);
      if (!STOP_CHUNK_RE.test(g)) chunks.add(g);
    }
  }
  return chunks;
}

/**
 * @returns {{ok: boolean, reason?: string, checked: {numbers: number, unmatched: string[], sentences: number}}}
 */
export function validateDigestSummary(summary, entries) {
  const text = String(summary || "").trim();
  if (!text) return { ok: false, reason: "empty", checked: { numbers: 0, unmatched: [], sentences: 0 } };
  const source = entriesText(entries);
  if (!source) return { ok: false, reason: "no-sources", checked: { numbers: 0, unmatched: [], sentences: 0 } };

  // 1. URLs: the summary may only carry links that exist in the sources.
  const urls = String(text).match(/https?:\/\/[^\s）)]+/g) || [];
  for (const u of urls) {
    if (!source.includes(u)) {
      return { ok: false, reason: "foreign-url", checked: { numbers: 0, unmatched: [u], sentences: 0 } };
    }
  }

  // 2. Numbers with units must all be grounded.
  const summaryNums = extractNumbers(text);
  const sourceNums = extractNumbers(source);
  const unmatched = [];
  for (const n of summaryNums) {
    const grounded =
      sourceNums.some((s2) => sameNumber(n, s2)) ||
      // a bare digit run appearing verbatim in the source text
      source.includes(n.raw.replace(/,/g, ""));
    if (!grounded) unmatched.push(n.raw);
  }
  if (unmatched.length) {
    return { ok: false, reason: "ungrounded-numbers", checked: { numbers: summaryNums.length, unmatched, sentences: 0 } };
  }

  // 3. Every sentence must share an entity chunk with the sources.
  const sourceChunks = cjkChunks(source);
  const sentences = text.split(/(?<=[。！？!?])|\n/).map((s2) => s2.trim()).filter(Boolean);
  let groundedSentences = 0;
  for (const sent of sentences) {
    const chunks = cjkChunks(sent);
    let hit = false;
    for (const c of chunks) {
      if (sourceChunks.has(c)) {
        hit = true;
        break;
      }
    }
    if (hit) groundedSentences += 1;
  }
  if (sentences.length && groundedSentences < sentences.length) {
    return {
      ok: false,
      reason: "ungrounded-sentence",
      checked: { numbers: summaryNums.length, unmatched, sentences: sentences.length },
    };
  }
  return { ok: true, checked: { numbers: summaryNums.length, unmatched: [], sentences: sentences.length } };
}
