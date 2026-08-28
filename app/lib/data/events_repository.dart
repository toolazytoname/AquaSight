import 'dart:convert';
import 'dart:io';

import '../models/event.dart';

/// Live Pages feed. Only the running app should request this URL.
const liveEventsUrl = 'https://toolazytoname.github.io/AquaSight/events.json';

/// Loads `events.json`. Production hits [liveEventsUrl] then a local sibling
/// `web/events.json`. Tests inject fixture bytes and must not open HTTP.
class EventsRepository {
  EventsRepository({
    required this.loadLive,
    this.loadFallback,
  });

  final Future<String> Function() loadLive;
  final Future<String?> Function()? loadFallback;

  factory EventsRepository.fromJsonString(String json) {
    return EventsRepository(loadLive: () async => json);
  }

  factory EventsRepository.live({
    Future<String> Function(Uri uri)? httpGet,
    List<File>? fallbackFiles,
  }) {
    return EventsRepository(
      loadLive: () => (httpGet ?? httpGetText)(Uri.parse(liveEventsUrl)),
      loadFallback: () => readFirstExistingFile(
        fallbackFiles ?? defaultFallbackFiles(),
      ),
    );
  }

  Future<EventsFile> load() async {
    Object? liveError;
    try {
      return EventsFile.parse(await loadLive());
    } catch (e) {
      liveError = e;
    }
    final fallback = loadFallback == null ? null : await loadFallback!();
    if (fallback != null && fallback.trim().isNotEmpty) {
      return EventsFile.parse(fallback);
    }
    if (liveError is EventsLoadException) {
      throw liveError;
    }
    throw EventsLoadException('无法加载事件：$liveError');
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
