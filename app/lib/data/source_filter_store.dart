import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// App-documents path for the persisted source-filter chip.
const sourceFilterRelativePath = 'aquasight/source_filter.json';

File sourceFilterFile(Directory documents) {
  return File('${documents.path}/$sourceFilterRelativePath');
}

Future<Directory> _documentsDirectory([Directory? documents]) async {
  return documents ?? await getApplicationDocumentsDirectory();
}

/// Parse a JSON source-name string. Missing, invalid, or blank input yields null.
String? parseSourceFilter(String raw) {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! String) return null;
    final trimmed = decoded.trim();
    return trimmed.isEmpty ? null : trimmed;
  } catch (_) {
    return null;
  }
}

Future<String?> loadSourceFilter([Directory? documents]) async {
  try {
    final file = sourceFilterFile(await _documentsDirectory(documents));
    if (!await file.exists()) return null;
    return parseSourceFilter(await file.readAsString());
  } catch (_) {
    return null;
  }
}

Future<void> saveSourceFilter(String? value, [Directory? documents]) async {
  final file = sourceFilterFile(await _documentsDirectory(documents));
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(jsonEncode(value), flush: true);
  await tmp.rename(file.path);
}

/// Persists the source-filter chip. Production default is the documents file.
/// Tests inject [loadValue] / [saveValue] backed by an in-memory [String?].
class SourceFilterStore {
  SourceFilterStore({
    Future<String?> Function()? loadValue,
    Future<void> Function(String? value)? saveValue,
  })  : loadValue = loadValue ?? loadSourceFilter,
        saveValue = saveValue ?? saveSourceFilter;

  final Future<String?> Function() loadValue;
  final Future<void> Function(String? value) saveValue;
  String? _value;
  bool _saved = false;

  /// Shared in-memory name. [load] / [save] keep [value] and the store in sync.
  factory SourceFilterStore.memory([String? value]) {
    var stored = value;
    return SourceFilterStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        stored = next;
      },
    ).._value = stored;
  }

  factory SourceFilterStore.documents() {
    return SourceFilterStore(
      loadValue: loadSourceFilter,
      saveValue: saveSourceFilter,
    );
  }

  String? get value => _value;

  Future<String?> load() async {
    try {
      final loaded = await loadValue();
      if (!_saved) {
        _value = _accepted(loaded);
      }
    } catch (_) {
      if (!_saved) {
        _value = null;
      }
    }
    return _value;
  }

  Future<void> save(String? value) async {
    _saved = true;
    _value = _accepted(value);
    try {
      await saveValue(_value);
    } catch (_) {
      // Disk errors must not crash the chip.
    }
  }

  static String? _accepted(String? value) {
    if (value == null) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }
}
