import { sourceFamily, VETO_RE } from "./classify.js";
import { sortByScore } from "./sort.js";

export const ENT_DISPLAY_RE = /明星|演唱会|票房|剧集|追剧|短剧|综艺|晚会/;
export const NORMAL_CAP = 30;

export function isHotEntertainment(item) {
  if (sourceFamily(item && item.source) !== "hot") return false;
  const title = String((item && item.title) || "");
  return VETO_RE.test(title) || ENT_DISPLAY_RE.test(title);
}

export function breakingListForPage(items) {
  return sortByScore((items || []).filter((i) => i.level === "breaking"));
}

export function normalListForPage(items) {
  const raw = (items || []).filter(
    (i) => i.level !== "breaking" && !isHotEntertainment(i)
  );
  return sortByScore(raw).slice(0, NORMAL_CAP);
}
