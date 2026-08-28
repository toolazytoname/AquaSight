import 'package:flutter/material.dart';

import '../data/events_repository.dart';
import '../models/event.dart';
import '../timeline/grouping.dart';
import 'event_card.dart';

class TimelinePage extends StatefulWidget {
  const TimelinePage({super.key, required this.repository});

  final EventsRepository repository;

  @override
  State<TimelinePage> createState() => _TimelinePageState();
}

class _TimelinePageState extends State<TimelinePage> {
  late Future<EventsFile> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.repository.load();
  }

  Future<void> _reload() async {
    setState(() {
      _future = widget.repository.load();
    });
    await _future;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF4EFE4),
      appBar: AppBar(
        title: const Text('鸭先知'),
        backgroundColor: const Color(0xFFF4EFE4),
        foregroundColor: const Color(0xFF14201C),
        elevation: 0,
      ),
      body: FutureBuilder<EventsFile>(
        future: _future,
        builder: (context, snapshot) {
          if (snapshot.connectionState != ConnectionState.done) {
            return const Center(
              key: Key('timeline-loading'),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 12),
                  Text('加载中…'),
                ],
              ),
            );
          }
          if (snapshot.hasError) {
            final error = snapshot.error;
            final message = error is EventsLoadException
                ? error.message
                : error.toString();
            return Center(
              key: const Key('timeline-error'),
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '加载失败',
                      style: Theme.of(context).textTheme.titleLarge,
                    ),
                    const SizedBox(height: 8),
                    Text(message, textAlign: TextAlign.center),
                  ],
                ),
              ),
            );
          }
          final file = snapshot.data!;
          if (file.items.isEmpty) {
            return const Center(
              key: Key('timeline-empty'),
              child: Text('暂无事件'),
            );
          }
          final groups = groupTimeline(file);
          return RefreshIndicator(
            onRefresh: _reload,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final group in groups) _DaySection(group: group),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({required this.group});

  final DayGroup group;

  @override
  Widget build(BuildContext context) {
    return Padding(
      key: Key('day-group-${group.label}'),
      padding: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 16, 4, 8),
            child: Text(
              group.label,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    color: group.label == unknownDateLabel
                        ? const Color(0xFF5B6B64)
                        : const Color(0xFF1F4D3A),
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
          for (final item in group.items) EventCard(item: item),
        ],
      ),
    );
  }
}
