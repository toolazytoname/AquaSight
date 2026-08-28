import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/events_repository.dart';
import 'event_card.dart';
import 'timeline_page.dart';

Future<void> launchUrlExternal(Uri uri) {
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

class AquaApp extends StatelessWidget {
  const AquaApp({
    super.key,
    required this.repository,
    this.openUrl = launchUrlExternal,
  });

  final EventsRepository repository;
  final OpenUrl openUrl;

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
      home: TimelinePage(repository: repository, openUrl: openUrl),
    );
  }
}
