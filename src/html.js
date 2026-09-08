import { Parser } from "htmlparser2";
import { decodeHTML, decodeXML } from "entities";

const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "nav",
  "footer",
  "header",
  "aside",
  "form",
  "iframe",
]);

function decodeAll(s) {
  const once = decodeHTML(decodeXML(String(s || "")));
  return decodeHTML(once);
}

export function decodeEntities(s) {
  return decodeAll(s);
}

export function stripHtml(input) {
  const raw = String(input || "");
  if (!raw) return "";
  if (!/<[a-z/!]/i.test(raw) && !/&[#a-zA-Z0-9]+;/.test(raw)) {
    return decodeAll(raw).replace(/\s+/g, " ").trim();
  }
  let text = "";
  let skip = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIP.has(name)) skip += 1;
        else if (name === "br" || name === "p" || name === "div" || name === "li") {
          if (skip === 0) text += " ";
        }
      },
      onclosetag(name) {
        if (SKIP.has(name) && skip > 0) skip -= 1;
        if (
          skip === 0 &&
          (name === "p" || name === "div" || name === "li" || name === "br")
        ) {
          text += " ";
        }
      },
      ontext(t) {
        if (skip === 0) text += t;
      },
    },
    { decodeEntities: true }
  );
  try {
    parser.write(raw);
    parser.end();
  } catch {
    return decodeAll(raw.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  }
  return decodeAll(text).replace(/\s+/g, " ").trim();
}

export function extractMainText(html) {
  const raw = String(html || "");
  if (!raw) return "";
  const blocks = [];
  let buf = "";
  let skip = 0;
  let inArticle = 0;
  const parser = new Parser(
    {
      onopentag(name) {
        if (SKIP.has(name)) skip += 1;
        if (name === "article" || name === "main") inArticle += 1;
      },
      onclosetag(name) {
        if (SKIP.has(name) && skip > 0) skip -= 1;
        if (name === "article" || name === "main") inArticle = Math.max(0, inArticle - 1);
        if (skip === 0 && (name === "p" || name === "li" || name === "h1" || name === "h2")) {
          const line = decodeAll(buf).replace(/\s+/g, " ").trim();
          if (line.length >= 20) blocks.push(line);
          buf = "";
        }
      },
      ontext(t) {
        if (skip === 0) buf += t;
      },
    },
    { decodeEntities: true }
  );
  try {
    parser.write(raw);
    parser.end();
  } catch {
    return stripHtml(raw);
  }
  const joined = blocks.join("\n\n").trim();
  return joined || stripHtml(raw);
}

export function looksLikeHtml(s) {
  return /<\/?[a-z][\s\S]*>/i.test(String(s || ""));
}

export function preserveTechTokens(s) {
  return String(s || "");
}
