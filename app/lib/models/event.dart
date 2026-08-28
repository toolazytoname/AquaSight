import 'dart:convert';

class EventsLoadException implements Exception {
  EventsLoadException(this.message);
  final String message;

  @override
  String toString() => message;
}

class SourceRef {
  const SourceRef({required this.source, this.url, this.title});

  final String source;
  final String? url;
  final String? title;

  factory SourceRef.fromJson(Map<String, dynamic> json) {
    return SourceRef(
      source: (json['source'] ?? '').toString(),
      url: json['url']?.toString(),
      title: json['title']?.toString(),
    );
  }
}

class EventItem {
  const EventItem({
    required this.id,
    required this.title,
    this.titleZh,
    required this.url,
    required this.source,
    required this.level,
    required this.reason,
    this.score,
    this.sources = const [],
    this.publishedAt,
    this.seenAt,
    this.index = 0,
  });

  final String id;
  final String title;
  final String? titleZh;
  final String url;
  final String source;
  final String level;
  final String reason;
  final double? score;
  final List<SourceRef> sources;
  final String? publishedAt;
  final String? seenAt;
  final int index;

  bool get isBreaking => level == 'breaking';

  /// `titleZh` when non-empty, otherwise `title`.
  String get displayTitle {
    final zh = (titleZh ?? '').trim();
    if (zh.isNotEmpty) return zh;
    final raw = title.trim();
    return raw.isEmpty ? '(无标题)' : raw;
  }

  List<String> get sourceChips {
    if (sources.isNotEmpty) {
      return sources
          .map((s) => s.source.trim())
          .where((s) => s.isNotEmpty)
          .toList();
    }
    final single = source.trim();
    return single.isEmpty ? const [] : [single];
  }

  String? get scoreLabel {
    if (score == null) return null;
    if (score == score!.roundToDouble()) {
      return score!.toInt().toString();
    }
    return score.toString();
  }

  String? resolvedTimestamp(String? fileUpdatedAt) {
    if (_nonEmpty(publishedAt)) return publishedAt;
    if (_nonEmpty(seenAt)) return seenAt;
    if (_nonEmpty(fileUpdatedAt)) return fileUpdatedAt;
    return null;
  }

  factory EventItem.fromJson(Map<String, dynamic> json, {int index = 0}) {
    final rawSources = json['sources'];
    final sources = <SourceRef>[];
    if (rawSources is List) {
      for (final row in rawSources) {
        if (row is Map) {
          sources.add(SourceRef.fromJson(Map<String, dynamic>.from(row)));
        }
      }
    }
    return EventItem(
      id: (json['id'] ?? '').toString(),
      title: (json['title'] ?? '').toString(),
      titleZh: json['titleZh']?.toString(),
      url: (json['url'] ?? '').toString(),
      source: (json['source'] ?? '').toString(),
      level: (json['level'] ?? '').toString(),
      reason: (json['reason'] ?? '').toString(),
      score: _readScore(json['score']),
      sources: sources,
      publishedAt: json['publishedAt']?.toString(),
      seenAt: json['seenAt']?.toString(),
      index: index,
    );
  }

  static double? _readScore(dynamic value) {
    if (value is num) return value.toDouble();
    if (value is String) return double.tryParse(value);
    return null;
  }
}

class EventsFile {
  const EventsFile({this.updatedAt, required this.items});

  final String? updatedAt;
  final List<EventItem> items;

  factory EventsFile.parse(String body) {
    final dynamic decoded;
    try {
      decoded = jsonDecode(body);
    } on FormatException catch (e) {
      throw EventsLoadException('events.json 不是合法 JSON：$e');
    }
    if (decoded is! Map) {
      throw EventsLoadException('events.json 必须是对象');
    }
    return EventsFile.fromJson(Map<String, dynamic>.from(decoded));
  }

  factory EventsFile.fromJson(Map<String, dynamic> json) {
    final rawItems = json['items'];
    if (rawItems == null) {
      throw EventsLoadException('events.json 缺少 items');
    }
    if (rawItems is! List) {
      throw EventsLoadException('events.json 的 items 必须是数组');
    }
    final items = <EventItem>[];
    for (var i = 0; i < rawItems.length; i++) {
      final row = rawItems[i];
      if (row is Map) {
        items.add(EventItem.fromJson(Map<String, dynamic>.from(row), index: i));
      }
    }
    return EventsFile(
      updatedAt: json['updatedAt']?.toString(),
      items: items,
    );
  }
}

bool _nonEmpty(String? value) => value != null && value.trim().isNotEmpty;
