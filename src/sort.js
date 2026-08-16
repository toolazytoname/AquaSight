export function scoreOf(item) {
  const n = item && item.score;
  return Number.isFinite(n) ? n : 0;
}

export function sortByScore(items) {
  return (items || [])
    .map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const d = scoreOf(b.it) - scoreOf(a.it);
      return d !== 0 ? d : a.i - b.i;
    })
    .map((x) => x.it);
}
