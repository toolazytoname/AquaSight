import '../models/event.dart';

/// Group label when publishedAt, seenAt, and file updatedAt are all missing.
const unknownDateLabel = '未知日期';

class DayGroup {
  const DayGroup({required this.label, required this.items});

  final String label;
  final List<EventItem> items;
}

/// Asia/Shanghai calendar date (CST, UTC+8, no DST).
/// Naive timestamps are treated as UTC so tests do not depend on the host TZ.
String? beijingCalendarDate(String? iso) {
  final utc = parseAsUtc(iso);
  if (utc == null) return null;
  final beijing = utc.add(const Duration(hours: 8));
  final y = beijing.year.toString().padLeft(4, '0');
  final m = beijing.month.toString().padLeft(2, '0');
  final d = beijing.day.toString().padLeft(2, '0');
  return '$y-$m-$d';
}

DateTime? parseAsUtc(String? raw) {
  if (raw == null) return null;
  final text = raw.trim();
  if (text.isEmpty) return null;
  final parsed = DateTime.tryParse(text);
  if (parsed == null) return null;
  if (parsed.isUtc) return parsed;
  return DateTime.utc(
    parsed.year,
    parsed.month,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
    parsed.millisecond,
    parsed.microsecond,
  );
}

/// Group cards by Beijing date. Within a day: breaking first, then score desc.
List<DayGroup> groupTimeline(EventsFile file) {
  final buckets = <String, List<EventItem>>{};
  for (final item in file.items) {
    final stamp = item.resolvedTimestamp(file.updatedAt);
    final label = beijingCalendarDate(stamp) ?? unknownDateLabel;
    buckets.putIfAbsent(label, () => []).add(item);
  }

  for (final list in buckets.values) {
    list.sort(_compareCards);
  }

  final labels = buckets.keys.toList()
    ..sort((a, b) {
      if (a == unknownDateLabel) return 1;
      if (b == unknownDateLabel) return -1;
      return b.compareTo(a);
    });

  return [
    for (final label in labels) DayGroup(label: label, items: buckets[label]!),
  ];
}

int _compareCards(EventItem a, EventItem b) {
  final byLevel = (a.isBreaking ? 0 : 1).compareTo(b.isBreaking ? 0 : 1);
  if (byLevel != 0) return byLevel;
  final scoreA = a.score;
  final scoreB = b.score;
  if (scoreA != null && scoreB != null) {
    final byScore = scoreB.compareTo(scoreA);
    if (byScore != 0) return byScore;
  } else if (scoreA != null) {
    return -1;
  } else if (scoreB != null) {
    return 1;
  }
  return a.index.compareTo(b.index);
}
