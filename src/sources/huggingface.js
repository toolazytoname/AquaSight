import { getJson } from "../http.js";
import { articleId } from "../identity.js";

// Both endpoints are keyless; shapes verified against the live API.
const PAPERS_URL = "https://huggingface.co/api/daily_papers";
const MODELS_URL =
  "https://huggingface.co/api/models?sort=likes7d&direction=-1&limit=10";

function clampSummary(text, max = 280) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function paperItem(entry) {
  const paper = (entry && entry.paper) || entry || {};
  const title = String(paper.title || "").trim();
  const pid = String(paper.id || "").trim();
  if (!title || !pid) return null;
  const upvotes = Number.isFinite(paper.upvotes)
    ? paper.upvotes
    : Number.isFinite(entry && entry.upvotes)
      ? entry.upvotes
      : undefined;
  const item = {
    title,
    url: "https://huggingface.co/papers/" + pid,
    source: "huggingface",
    role: "article",
    kind: "paper",
    externalId: pid,
  };
  // The arXiv date can be a week old; what matters to a news radar is when
  // the paper landed on the daily list.
  const when = paper.submittedOnDailyAt || (entry && entry.publishedAt) || paper.publishedAt;
  if (when) item.publishedAt = when;
  if (Number.isFinite(upvotes)) item.points = upvotes;
  const summary = clampSummary(paper.summary);
  if (summary) item.summary = summary;
  item.id = articleId(item);
  item.articleId = item.id;
  return item;
}

function modelItem(m) {
  const id = String(m.id || m.modelId || "").trim();
  if (!id) return null;
  const item = {
    title: id + " · Hugging Face 本周热门模型",
    url: "https://huggingface.co/" + id,
    source: "huggingface",
    role: "opensource",
    kind: "model-trending",
    externalId: id,
  };
  // No publishedAt: the list itself is the "now" signal, so items score as
  // fresh instead of stale-dating against the model's creation date.
  if (Number.isFinite(m.likes)) item.points = m.likes;
  const bits = [];
  if (m.pipeline_tag) bits.push(String(m.pipeline_tag));
  if (Number.isFinite(m.downloads)) bits.push("下载 " + m.downloads);
  const summary = clampSummary(bits.join(" · "));
  if (summary) item.summary = summary;
  item.id = articleId(item);
  item.articleId = item.id;
  return item;
}

export async function fetchHuggingFace() {
  let papers = [];
  let models = [];
  let firstError = null;
  try {
    papers = await getJson(PAPERS_URL);
  } catch (e) {
    firstError = e;
  }
  try {
    models = await getJson(MODELS_URL);
  } catch (e) {
    firstError = firstError || e;
  }
  const out = [];
  for (const p of Array.isArray(papers) ? papers.slice(0, 12) : []) {
    const it = paperItem(p);
    if (it) out.push(it);
  }
  for (const m of Array.isArray(models) ? models.slice(0, 8) : []) {
    const it = modelItem(m);
    if (it) out.push(it);
  }
  if (!out.length) throw firstError || new Error("huggingface: no usable items");
  return out;
}
