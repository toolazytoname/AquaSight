/** Static events.json for the web fallback when /api/v1 is unavailable. */

export function publicItem(it) {
  return {
    id: it.id,
    title: it.title,
    titleZh: it.titleZh,
    url: it.url,
    summary: it.summary,
    summaryZh: it.summaryZh || it.overviewZh,
    overviewZh: it.overviewZh,
    facts: it.facts,
    level: it.level,
    reason: it.reason,
    score: it.score,
    value: it.value,
    category: it.category,
    source: it.source,
    sources: it.sources,
    publishedAt: it.publishedAt,
    seenAt: it.seenAt || it.firstSeenAt,
    firstSeenAt: it.firstSeenAt,
    occurredAt: it.occurredAt,
    memberIds: it.memberIds || it.articleIds,
    subject: it.subject,
    enrichInsufficient: it.enrichInsufficient,
  };
}

export function eventsPayload({ items, sourceErrors, sourceHealth, featured, updatedAt, snapshotAt }) {
  return {
    apiVersion: "v1",
    updatedAt: updatedAt || new Date().toISOString(),
    snapshotAt: snapshotAt || updatedAt || new Date().toISOString(),
    items: (items || []).map(publicItem),
    featured: (featured || []).map((it) => it.id),
    sourceErrors: sourceErrors || [],
    sourceHealth: sourceHealth || [],
  };
}
