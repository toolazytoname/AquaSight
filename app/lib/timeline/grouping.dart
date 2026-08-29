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

/// Beijing wall clock (UTC+8, no DST) as `yyyy-MM-dd HH:mm`.
/// Adds 8 hours to the UTC instant. Does not use the device local timezone.
String beijingClockLabel(DateTime utc) {
  final beijing = utc.toUtc().add(const Duration(hours: 8));
  final y = beijing.year.toString().padLeft(4, '0');
  final m = beijing.month.toString().padLeft(2, '0');
  final d = beijing.day.toString().padLeft(2, '0');
  final h = beijing.hour.toString().padLeft(2, '0');
  final min = beijing.minute.toString().padLeft(2, '0');
  return '$y-$m-$d $h:$min';
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

/// Beijing-oriented relative copy from two UTC instants.
/// [when] null (missing or [parseAsUtc] fail) → `未知`. Future → `刚刚`.
String relativeTimeLabel(DateTime? when, DateTime now) {
  if (when == null) return '未知';
  final duration = now.toUtc().difference(when.toUtc());
  if (duration.isNegative || duration.inSeconds < 60) return '刚刚';
  if (duration.inMinutes < 60) return '${duration.inMinutes}分钟前';
  if (duration.inHours < 24) return '${duration.inHours}小时前';
  final days = duration.inDays < 1 ? 1 : duration.inDays;
  return '$days天前';
}

/// Visible day-section title for a grouping [groupLabel].
///
/// [DayGroup.label] stays the calendar string. Yesterday is Beijing calendar
/// day −1, not 24 hours. Naive [now] is treated as UTC (no DST, UTC+8).
String friendlyDayLabel(String groupLabel, DateTime now) {
  if (groupLabel == unknownDateLabel) return groupLabel;
  final today = beijingCalendarDate(_asUtcIso(now));
  if (groupLabel == today) return '今天';
  if (groupLabel == _beijingCalendarYesterday(now)) return '昨天';
  return groupLabel;
}

String _asUtcIso(DateTime now) {
  if (now.isUtc) return now.toIso8601String();
  return DateTime.utc(
    now.year,
    now.month,
    now.day,
    now.hour,
    now.minute,
    now.second,
    now.millisecond,
    now.microsecond,
  ).toIso8601String();
}

String _beijingCalendarYesterday(DateTime now) {
  final today = beijingCalendarDate(_asUtcIso(now));
  if (today == null) return '';
  final parts = today.split('-');
  final y = int.parse(parts[0]);
  final m = int.parse(parts[1]);
  final d = int.parse(parts[2]);
  final yesterday = DateTime.utc(y, m, d).subtract(const Duration(days: 1));
  final yy = yesterday.year.toString().padLeft(4, '0');
  final mm = yesterday.month.toString().padLeft(2, '0');
  final dd = yesterday.day.toString().padLeft(2, '0');
  return '$yy-$mm-$dd';
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
