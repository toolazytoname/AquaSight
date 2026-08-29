import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// App-documents path for the persisted 「只看未读」 toggle.
const unreadOnlyRelativePath = 'aquasight/unread_only.json';

File unreadOnlyFile(Directory documents) {
  return File('${documents.path}/$unreadOnlyRelativePath');
}

Future<Directory> _documentsDirectory([Directory? documents]) async {
  return documents ?? await getApplicationDocumentsDirectory();
}

/// Parse a JSON boolean. Missing, invalid, or non-bool input yields false.
bool parseUnreadOnly(String raw) {
  try {
    final decoded = jsonDecode(raw);
    return decoded is bool && decoded;
  } catch (_) {
    return false;
  }
}

Future<bool> loadUnreadOnly([Directory? documents]) async {
  try {
    final file = unreadOnlyFile(await _documentsDirectory(documents));
    if (!await file.exists()) return false;
    return parseUnreadOnly(await file.readAsString());
  } catch (_) {
    return false;
  }
}

Future<void> saveUnreadOnly(bool value, [Directory? documents]) async {
  final file = unreadOnlyFile(await _documentsDirectory(documents));
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(jsonEncode(value), flush: true);
  await tmp.rename(file.path);
}

/// Persists the unread-only toggle. Production default is the documents file.
/// Tests inject [loadValue] / [saveValue] backed by an in-memory [bool].
class UnreadOnlyStore {
  UnreadOnlyStore({
    Future<bool> Function()? loadValue,
    Future<void> Function(bool value)? saveValue,
  })  : loadValue = loadValue ?? loadUnreadOnly,
        saveValue = saveValue ?? saveUnreadOnly;

  final Future<bool> Function() loadValue;
  final Future<void> Function(bool value) saveValue;
  bool _value = false;
  bool _saved = false;

  /// Shared in-memory flag. [load] / [save] keep [value] and the store in sync.
  factory UnreadOnlyStore.memory([bool value = false]) {
    var stored = value;
    return UnreadOnlyStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        stored = next;
      },
    ).._value = stored;
  }

  factory UnreadOnlyStore.documents() {
    return UnreadOnlyStore(
      loadValue: loadUnreadOnly,
      saveValue: saveUnreadOnly,
    );
  }

  bool get value => _value;

  Future<bool> load() async {
    try {
      final loaded = await loadValue();
      if (!_saved) {
        _value = loaded;
      }
    } catch (_) {
      if (!_saved) {
        _value = false;
      }
    }
    return _value;
  }

  Future<void> save(bool value) async {
    _saved = true;
    _value = value;
    try {
      await saveValue(value);
    } catch (_) {
      // Disk errors must not crash the toggle.
    }
  }
}
