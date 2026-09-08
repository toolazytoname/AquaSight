export const DEFAULT_PREFS = {
  hiddenEventIds: [],
  blockedSources: [],
  topicWeights: {},
  instantNotifyEnabled: false,
  digestEnabled: true,
  digestHour: 8,
  digestMinute: 5,
  instantMaxPerDay: 3,
  silentStart: "23:00",
  silentEnd: "08:00",
  timezone: "Asia/Shanghai",
};

export function normalizePrefs(raw) {
  const p = { ...DEFAULT_PREFS, ...(raw || {}) };
  p.hiddenEventIds = Array.isArray(p.hiddenEventIds) ? p.hiddenEventIds.map(String) : [];
  p.blockedSources = Array.isArray(p.blockedSources) ? p.blockedSources.map(String) : [];
  p.topicWeights =
    p.topicWeights && typeof p.topicWeights === "object" && !Array.isArray(p.topicWeights)
      ? p.topicWeights
      : {};
  p.instantNotifyEnabled = Boolean(p.instantNotifyEnabled);
  p.digestEnabled = p.digestEnabled !== false;
  p.instantMaxPerDay = Number.isFinite(Number(p.instantMaxPerDay))
    ? Math.max(0, Number(p.instantMaxPerDay))
    : 3;
  return p;
}

export function applyFeedback(prefs, feedback) {
  const next = normalizePrefs(prefs);
  const kind = feedback?.kind;
  const eventId = String(feedback?.eventId || "");
  const source = String(feedback?.source || "");
  const topic = String(feedback?.topic || "");
  if (kind === "hide" && eventId) {
    if (!next.hiddenEventIds.includes(eventId)) next.hiddenEventIds.push(eventId);
  } else if (kind === "unhide" && eventId) {
    next.hiddenEventIds = next.hiddenEventIds.filter((id) => id !== eventId);
  } else if (kind === "block-source" && source) {
    if (!next.blockedSources.includes(source)) next.blockedSources.push(source);
  } else if (kind === "unblock-source" && source) {
    next.blockedSources = next.blockedSources.filter((s) => s !== source);
  } else if (kind === "downweight-topic" && topic) {
    const cur = Number(next.topicWeights[topic]);
    next.topicWeights[topic] = Number.isFinite(cur) ? Math.max(0, cur * 0.5) : 0.5;
  } else if (kind === "reset-topic" && topic) {
    delete next.topicWeights[topic];
  }
  return next;
}

export function undoFeedback(prefs, feedback) {
  if (!feedback) return normalizePrefs(prefs);
  const inverse = {
    hide: "unhide",
    unhide: "hide",
    "block-source": "unblock-source",
    "unblock-source": "block-source",
    "downweight-topic": "reset-topic",
    "reset-topic": "downweight-topic",
  };
  const kind = inverse[feedback.kind] || "";
  if (!kind) return normalizePrefs(prefs);
  return applyFeedback(prefs, { ...feedback, kind });
}
