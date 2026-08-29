import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// App-documents path for ids marked read after a successful original-URL open.
const readIdsRelativePath = 'aquasight/read_ids.json';

/// Hard cap for persisted read ids. Oldest (index 0) are dropped first.
const readIdsMaxCount = 500;

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
      if (_pruneOldest()) {
        try {
          await saveIds(Set<String>.from(_ids));
        } catch (_) {
          // Disk errors must not crash after prune-on-load.
        }
      }
    } catch (_) {
      // Missing plugin, corrupt file, or IO — start unread.
    }
  }

  Future<void> markRead(String id) async {
    if (id.isEmpty || _ids.contains(id)) return;
    _ids.add(id);
    _pruneOldest();
    try {
      await saveIds(Set<String>.from(_ids));
    } catch (_) {
      // Disk errors must not crash after a successful open.
    }
  }

  /// Removes [id] from the read set. Empty or already-unread ids are no-ops.
  Future<void> markUnread(String id) async {
    if (id.isEmpty || !_ids.contains(id)) return;
    _ids.remove(id);
    try {
      await saveIds(Set<String>.from(_ids));
    } catch (_) {
      // Disk errors must not crash after a successful unread.
    }
  }

  /// Marks every non-empty unread [ids] value. Already-read ids are no-ops.
  /// One save after adding new ids and applying the existing 500 prune.
  Future<void> markAll(Iterable<String> ids) async {
    var added = false;
    for (final id in ids) {
      if (id.isEmpty || _ids.contains(id)) continue;
      _ids.add(id);
      added = true;
    }
    if (!added) return;
    _pruneOldest();
    try {
      await saveIds(Set<String>.from(_ids));
    } catch (_) {
      // Disk errors must not crash after a successful mark-all.
    }
  }

  /// Unmarks every non-empty already-read [ids] value. Already-unread ids are
  /// no-ops. One save after removing ids. Empty input or all no-ops skip disk.
  Future<void> markUnreadAll(Iterable<String> ids) async {
    var removed = false;
    for (final id in ids) {
      if (id.isEmpty || !_ids.contains(id)) continue;
      _ids.remove(id);
      removed = true;
    }
    if (!removed) return;
    try {
      await saveIds(Set<String>.from(_ids));
    } catch (_) {
      // Disk errors must not crash after a successful unread-all.
    }
  }

  /// Drops oldest ids (index 0) until at most [readIdsMaxCount] remain.
  /// Returns true if any id was removed.
  bool _pruneOldest() {
    if (_ids.length <= readIdsMaxCount) return false;
    while (_ids.length > readIdsMaxCount) {
      _ids.remove(_ids.first);
    }
    return true;
  }
}
