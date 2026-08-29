import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

/// App-documents path for the persisted timeline scroll offset in pixels.
const scrollOffsetRelativePath = 'aquasight/scroll_offset.json';

File scrollOffsetFile(Directory documents) {
  return File('${documents.path}/$scrollOffsetRelativePath');
}

Future<Directory> _documentsDirectory([Directory? documents]) async {
  return documents ?? await getApplicationDocumentsDirectory();
}

/// Parse a JSON number. Missing, invalid, or negative input yields 0.
double parseScrollOffset(String raw) {
  try {
    final decoded = jsonDecode(raw);
    if (decoded is! num) return 0;
    final value = decoded.toDouble();
    return value < 0 ? 0 : value;
  } catch (_) {
    return 0;
  }
}

Future<double> loadScrollOffset([Directory? documents]) async {
  try {
    final file = scrollOffsetFile(await _documentsDirectory(documents));
    if (!await file.exists()) return 0;
    return parseScrollOffset(await file.readAsString());
  } catch (_) {
    return 0;
  }
}

Future<void> saveScrollOffset(double value, [Directory? documents]) async {
  final file = scrollOffsetFile(await _documentsDirectory(documents));
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(jsonEncode(value), flush: true);
  await tmp.rename(file.path);
}

/// Persists the timeline scroll offset. Production default is the documents file.
/// Tests inject [loadValue] / [saveValue] backed by an in-memory [double].
class ScrollOffsetStore {
  ScrollOffsetStore({
    Future<double> Function()? loadValue,
    Future<void> Function(double value)? saveValue,
  })  : loadValue = loadValue ?? loadScrollOffset,
        saveValue = saveValue ?? saveScrollOffset;

  final Future<double> Function() loadValue;
  final Future<void> Function(double value) saveValue;
  double _value = 0;
  bool _saved = false;

  /// Shared in-memory offset. [load] / [save] keep [value] and the store in sync.
  factory ScrollOffsetStore.memory([double offset = 0]) {
    var stored = offset;
    return ScrollOffsetStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        stored = next;
      },
    ).._value = stored;
  }

  factory ScrollOffsetStore.documents() {
    return ScrollOffsetStore(
      loadValue: loadScrollOffset,
      saveValue: saveScrollOffset,
    );
  }

  double get value => _value;

  Future<double> load() async {
    try {
      final loaded = await loadValue();
      if (!_saved) {
        _value = loaded < 0 ? 0 : loaded;
      }
    } catch (_) {
      if (!_saved) {
        _value = 0;
      }
    }
    return _value;
  }

  Future<void> save(double value) async {
    _saved = true;
    _value = value;
    try {
      await saveValue(value);
    } catch (_) {
      // Disk errors must not crash the timeline.
    }
  }
}
