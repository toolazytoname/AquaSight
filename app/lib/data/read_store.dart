import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// App-documents path for ids marked read after a successful original-URL open.
const readIdsRelativePath = 'aquasight/read_ids.json';

File readIdsFile(Directory documents) {
  return File('${documents.path}/$readIdsRelativePath');
}

Future<Directory> _documentsDirectory([Directory? documents]) async {
  return documents ?? await getApplicationDocumentsDirectory();
}

/// Parse a JSON array of item ids. Invalid or non-array input yields empty.
Set<String> parseReadIds(String raw) {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! List) return {};
    return {
      for (final item in decoded)
        if (item is String && item.isNotEmpty) item,
    };
  } catch (_) {
    return {};
  }
}

Future<Set<String>> loadReadIds([Directory? documents]) async {
  try {
    final file = readIdsFile(await _documentsDirectory(documents));
    if (!await file.exists()) return {};
    return parseReadIds(await file.readAsString());
  } catch (_) {
    return {};
  }
}

Future<void> saveReadIds(Set<String> ids, [Directory? documents]) async {
  final file = readIdsFile(await _documentsDirectory(documents));
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(jsonEncode(ids.toList()), flush: true);
  await tmp.rename(file.path);
}

/// Persists read [item.id] values. Production default is the documents file.
/// Tests inject [loadIds] / [saveIds] backed by an in-memory [Set] or [Map].
class ReadStore {
  ReadStore({
    Future<Set<String>> Function()? loadIds,
    Future<void> Function(Set<String> ids)? saveIds,
  })  : loadIds = loadIds ?? loadReadIds,
        saveIds = saveIds ?? saveReadIds;

  final Future<Set<String>> Function() loadIds;
  final Future<void> Function(Set<String> ids) saveIds;
  final Set<String> _ids = <String>{};

  /// Shared in-memory set. [load] / [markRead] keep [ids] and the store in sync.
  factory ReadStore.memory([Set<String>? ids]) {
    final stored = ids ?? <String>{};
    return ReadStore(
      loadIds: () async => Set<String>.from(stored),
      saveIds: (next) async {
        stored
          ..clear()
          ..addAll(next);
      },
    ).._ids.addAll(stored);
  }

  factory ReadStore.documents() {
    return ReadStore(loadIds: loadReadIds, saveIds: saveReadIds);
  }

  Set<String> get ids => Set<String>.unmodifiable(_ids);

  bool isRead(String id) => _ids.contains(id);

  Future<void> load() async {
    try {
      final loaded = await loadIds();
      _ids
        ..clear()
        ..addAll(loaded);
    } catch (_) {
      // Missing plugin, corrupt file, or IO — start unread.
    }
  }

  Future<void> markRead(String id) async {
    if (id.isEmpty || _ids.contains(id)) return;
    _ids.add(id);
    try {
      await saveIds(Set<String>.from(_ids));
    } catch (_) {
      // Disk errors must not crash after a successful open.
    }
  }
}
