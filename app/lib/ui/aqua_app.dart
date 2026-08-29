import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/events_repository.dart';
import '../data/read_store.dart';
import '../data/scroll_offset_store.dart';
import '../data/unread_only_store.dart';
import 'event_card.dart';
import 'timeline_page.dart';

export 'event_card.dart' show ShareEvent;

Future<void> launchUrlExternal(Uri uri) {
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

Future<void> shareEventExternal({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) async {
  await SharePlus.instance.share(
    ShareParams(
      text: '$title\n$url',
      sharePositionOrigin: sharePositionOrigin,
    ),
  );
}

class AquaApp extends StatelessWidget {
  const AquaApp({
    super.key,
    required this.repository,
    this.openUrl = launchUrlExternal,
    this.shareEvent = shareEventExternal,
    this.readStore,
    this.unreadOnlyStore,
    this.scrollOffsetStore,
    this.now = DateTime.now,
  });

  final EventsRepository repository;
  final OpenUrl openUrl;
  final ShareEvent shareEvent;

  /// Production default is the documents file. Tests inject [ReadStore.memory].
  final ReadStore? readStore;

  /// Production default is the documents file. Tests inject [UnreadOnlyStore.memory].
  final UnreadOnlyStore? unreadOnlyStore;

  /// Production default is the documents file. Tests inject [ScrollOffsetStore.memory].
  final ScrollOffsetStore? scrollOffsetStore;

  /// Injected clock. Tests pass a fixed UTC instant.
  final DateTime Function() now;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: '鸭先知 AquaSight',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1F4D3A),
          brightness: Brightness.light,
        ),
        useMaterial3: true,
      ),
      darkTheme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: const Color(0xFF1F4D3A),
          brightness: Brightness.dark,
        ),
        useMaterial3: true,
      ),
      themeMode: ThemeMode.system,
      home: TimelinePage(
        repository: repository,
        openUrl: openUrl,
        shareEvent: shareEvent,
        readStore: readStore,
        unreadOnlyStore: unreadOnlyStore,
        scrollOffsetStore: scrollOffsetStore,
        now: now,
      ),
    );
  }
}
