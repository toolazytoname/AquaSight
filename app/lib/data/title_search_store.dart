import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// App-documents path for the persisted title-search query.
const titleSearchRelativePath = 'aquasight/title_search.json';

File titleSearchFile(Directory documents) {
  return File('${documents.path}/$titleSearchRelativePath');
}

Future<Directory> _documentsDirectory([Directory? documents]) async {
  return documents ?? await getApplicationDocumentsDirectory();
}

/// Parse a JSON query string. Missing, invalid, or non-string input yields ''.
String parseTitleSearch(String raw) {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! String) return '';
    return decoded.trim();
  } catch (_) {
    return '';
  }
}

Future<String> loadTitleSearch([Directory? documents]) async {
  try {
    final file = titleSearchFile(await _documentsDirectory(documents));
    if (!await file.exists()) return '';
    return parseTitleSearch(await file.readAsString());
  } catch (_) {
    return '';
  }
}

Future<void> saveTitleSearch(String value, [Directory? documents]) async {
  final file = titleSearchFile(await _documentsDirectory(documents));
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(jsonEncode(_accepted(value)), flush: true);
  await tmp.rename(file.path);
}

String _accepted(String value) {
  return value.trim();
}

/// Persists the title-search query. Production default is the documents file.
/// Tests inject [loadValue] / [saveValue] backed by an in-memory [String].
class TitleSearchStore {
  TitleSearchStore({
    Future<String> Function()? loadValue,
    Future<void> Function(String value)? saveValue,
  })  : loadValue = loadValue ?? loadTitleSearch,
        saveValue = saveValue ?? saveTitleSearch;

  final Future<String> Function() loadValue;
  final Future<void> Function(String value) saveValue;
  String _value = '';
  bool _saved = false;

  /// Shared in-memory query. [load] / [save] keep [value] and the store in sync.
  factory TitleSearchStore.memory([String value = '']) {
    var stored = value;
    return TitleSearchStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        stored = next;
      },
    ).._value = stored;
  }

  factory TitleSearchStore.documents() {
    return TitleSearchStore(
      loadValue: loadTitleSearch,
      saveValue: saveTitleSearch,
    );
  }

  String get value => _value;

  Future<String> load() async {
    try {
      final loaded = await loadValue();
      if (!_saved) {
        _value = _accepted(loaded);
      }
    } catch (_) {
      if (!_saved) {
        _value = '';
      }
    }
    return _value;
  }

  Future<void> save(String value) async {
    _saved = true;
    _value = _accepted(value);
    try {
      await saveValue(_value);
    } catch (_) {
      // Disk errors must not crash the search field.
    }
  }
}
