import 'package:flutter/material.dart';

import '../data/events_repository.dart';
import '../data/read_store.dart';
import '../models/event.dart';
import '../timeline/grouping.dart';
import 'event_card.dart';

class TimelinePage extends StatefulWidget {
  const TimelinePage({
    super.key,
    required this.repository,
    required this.openUrl,
    this.readStore,
  });

  final EventsRepository repository;
  final OpenUrl openUrl;
  final ReadStore? readStore;

  @override
  State<TimelinePage> createState() => _TimelinePageState();
}

class _TimelinePageState extends State<TimelinePage> {
  final GlobalKey<RefreshIndicatorState> _refreshKey =
      GlobalKey<RefreshIndicatorState>();

  late final ReadStore _readStore;
  bool _initialLoad = true;
  bool _refreshing = false;
  EventsFile? _file;
  String? _errorMessage;

  bool get _showingList =>
      _file != null && _file!.items.isNotEmpty && _errorMessage == null;

  bool get _showingError => _errorMessage != null && !_showingList;

  @override
  void initState() {
    super.initState();
    _readStore = widget.readStore ?? ReadStore.documents();
    _loadInitial();
  }

  String _messageOf(Object error) {
    return error is EventsLoadException ? error.message : error.toString();
  }

  Future<void> _loadInitial() async {
    try {
      await _readStore.load();
      final file = await widget.repository.load();
      if (!mounted) return;
      setState(() {
        _file = file;
        _errorMessage = null;
        _initialLoad = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = _messageOf(e);
        _initialLoad = false;
      });
    }
  }

  Future<void> _reload() async {
    if (_refreshing) return;
    _refreshing = true;
    try {
      final file = await widget.repository.load();
      if (!mounted) return;
      setState(() {
        _file = file;
        _errorMessage = null;
      });
    } catch (e) {
      if (!mounted) return;
      final message = _messageOf(e);
      if (_showingList) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
      } else if (_showingError) {
        setState(() {
          _errorMessage = message;
        });
      } else {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(SnackBar(content: Text(message)));
      }
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _retryFromError() {
    return _refreshKey.currentState?.show() ?? _reload();
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
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_initialLoad) {
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
    if (_errorMessage != null) {
      return _refreshable(
        fill: true,
        child: Center(
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
                Text(_errorMessage!, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _retryFromError,
                  child: const Text('重试'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final file = _file!;
    if (file.items.isEmpty) {
      return _refreshable(
        fill: true,
        child: const Center(
          key: Key('timeline-empty'),
          child: Text('暂无事件'),
        ),
      );
    }
    final groups = groupTimeline(file);
    return _refreshable(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final group in groups)
            _DaySection(
              group: group,
              openUrl: widget.openUrl,
              readStore: _readStore,
            ),
        ],
      ),
    );
  }

  Widget _refreshable({required Widget child, bool fill = false}) {
    return RefreshIndicator(
      key: _refreshKey,
      onRefresh: _reload,
      child: fill
          ? CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverFillRemaining(hasScrollBody: false, child: child),
              ],
            )
          : SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
              child: child,
            ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.group,
    required this.openUrl,
    required this.readStore,
  });

  final DayGroup group;
  final OpenUrl openUrl;
  final ReadStore readStore;

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
          for (final item in group.items)
            EventCard(item: item, openUrl: openUrl, readStore: readStore),
        ],
      ),
    );
  }
}
