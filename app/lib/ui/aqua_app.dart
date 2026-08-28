import 'package:flutter/material.dart';

import '../data/events_repository.dart';
import 'timeline_page.dart';

class AquaApp extends StatelessWidget {
  const AquaApp({super.key, required this.repository});

  final EventsRepository repository;

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
      home: TimelinePage(repository: repository),
    );
  }
}
