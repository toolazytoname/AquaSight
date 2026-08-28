import 'dart:convert';
import 'dart:io';

import 'package:flutter/services.dart' show rootBundle;
import 'package:path_provider/path_provider.dart';

import '../models/event.dart';

/// Live Pages feed. Only the running app should request this URL.
const liveEventsUrl = 'https://toolazytoname.github.io/AquaSight/events.json';

/// App-documents cache written only after a successful live parse.
const cachedEventsRelativePath = 'aquasight/events.json';

/// Bundled snapshot used only after live, cache, and sibling files fail.
const bundledEventsAsset = 'assets/events.json';

/// Loads `events.json`. Production hits [liveEventsUrl], then the documents
/// cache, then a local sibling `web/events.json`, then the bundled
/// [bundledEventsAsset]. Live success never reads cache/sibling/asset first.
/// Tests inject fixture bytes and must not open HTTP or the device docs dir.
class EventsRepository {
  EventsRepository({
    required this.loadLive,
    this.loadCache,
    this.saveCache,
    this.loadFallback,
    this.loadAsset,
  });

  final Future<String> Function() loadLive;
  final Future<String?> Function()? loadCache;
  final Future<void> Function(String raw)? saveCache;
  final Future<String?> Function()? loadFallback;
  final Future<String?> Function()? loadAsset;

  factory EventsRepository.fromJsonString(String json) {
    return EventsRepository(loadLive: () async => json);
  }

  factory EventsRepository.live({
    Future<String> Function(Uri uri)? httpGet,
    List<File>? fallbackFiles,
    Future<String?> Function()? loadCache,
    Future<void> Function(String raw)? saveCache,
    Future<String?> Function()? loadAsset,
  }) {
    return EventsRepository(
      loadLive: () => (httpGet ?? httpGetText)(Uri.parse(liveEventsUrl)),
      loadCache: loadCache ?? loadCachedEvents,
      saveCache: saveCache ?? saveCachedEvents,
      loadFallback: () => readFirstExistingFile(
        fallbackFiles ?? defaultFallbackFiles(),
      ),
      loadAsset: loadAsset ?? loadBundledAsset,
    );
  }

  Future<EventsFile> load() async {
    Object? liveError;
    try {
      final raw = await loadLive();
      final parsed = EventsFile.parse(raw);
      await _trySaveCache(raw);
      return parsed;
    } catch (e) {
      liveError = e;
    }

    final cached = await _tryParse(loadCache);
    if (cached != null) return cached;

    final sibling = await _tryParse(loadFallback);
    if (sibling != null) return sibling;

    final asset = await _tryParse(loadAsset);
    if (asset != null) return asset;

    if (liveError is EventsLoadException) {
      throw liveError;
    }
    throw EventsLoadException('无法加载事件：$liveError');
  }

  Future<void> _trySaveCache(String raw) async {
    final save = saveCache;
    if (save == null) return;
    try {
      await save(raw);
    } catch (_) {
      // Disk errors must not hide a successful live parse.
    }
  }

  Future<EventsFile?> _tryParse(Future<String?> Function()? loader) async {
    if (loader == null) return null;
    try {
      final raw = await loader();
      if (raw == null || raw.trim().isEmpty) return null;
      return EventsFile.parse(raw);
    } catch (_) {
      return null;
    }
  }
}

Future<String?> loadBundledAsset([String key = bundledEventsAsset]) async {
  try {
    return await rootBundle.loadString(key);
  } catch (_) {
    return null;
  }
}

Future<String> httpGetText(Uri uri) async {
  final client = HttpClient();
  try {
    final request = await client.getUrl(uri);
    final response = await request.close().timeout(const Duration(seconds: 15));
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw EventsLoadException('HTTP ${response.statusCode}');
    }
    return await response.transform(utf8.decoder).join();
  } on EventsLoadException {
    rethrow;
  } catch (e) {
    throw EventsLoadException('无法连接：$e');
  } finally {
    client.close(force: true);
  }
}

List<File> defaultFallbackFiles() {
  final cwd = Directory.current.path;
  return [
    File('$cwd/../web/events.json'),
    File('$cwd/web/events.json'),
  ];
}

Future<String?> readFirstExistingFile(List<File> files) async {
  for (final file in files) {
    try {
      if (await file.exists()) {
        return await file.readAsString();
      }
    } catch (_) {
      // skip unreadable path
    }
  }
  return null;
}

File cachedEventsFile(Directory documents) {
  return File('${documents.path}/$cachedEventsRelativePath');
}

Future<Directory> _documentsDirectory([Directory? documents]) async {
  return documents ?? await getApplicationDocumentsDirectory();
}

Future<String?> loadCachedEvents([Directory? documents]) async {
  try {
    final file = cachedEventsFile(await _documentsDirectory(documents));
    if (!await file.exists()) return null;
    return await file.readAsString();
  } catch (_) {
    return null;
  }
}

Future<void> saveCachedEvents(String raw, [Directory? documents]) async {
  final file = cachedEventsFile(await _documentsDirectory(documents));
  await file.parent.create(recursive: true);
  final tmp = File('${file.path}.tmp');
  await tmp.writeAsString(raw, flush: true);
  await tmp.rename(file.path);
}
