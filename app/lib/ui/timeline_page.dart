import 'package:flutter/material.dart';

import '../data/events_repository.dart';
import '../data/read_store.dart';
import '../data/unread_only_store.dart';
import '../models/event.dart';
import '../timeline/grouping.dart';
import 'event_card.dart';

class TimelinePage extends StatefulWidget {
  const TimelinePage({
    super.key,
    required this.repository,
    required this.openUrl,
    required this.shareEvent,
    this.readStore,
    this.unreadOnlyStore,
    this.now = DateTime.now,
  });

  final EventsRepository repository;
  final OpenUrl openUrl;
  final ShareEvent shareEvent;
  final ReadStore? readStore;
  final UnreadOnlyStore? unreadOnlyStore;

  /// Injected clock. Tests pass a fixed UTC instant.
  final DateTime Function() now;

  @override
  State<TimelinePage> createState() => _TimelinePageState();
}

class _TimelinePageState extends State<TimelinePage> {
  final GlobalKey<RefreshIndicatorState> _refreshKey =
      GlobalKey<RefreshIndicatorState>();
  final TextEditingController _searchController = TextEditingController();

  late final ReadStore _readStore;
  late final UnreadOnlyStore _unreadOnlyStore;
  bool _unreadOnly = false;
  /// True once [Switch.onChanged] has run in this State lifetime.
  bool _unreadOnlyToggled = false;
  String? _selectedSource;
  bool _initialLoad = true;
  bool _refreshing = false;
  EventsLoad? _load;
  String? _errorMessage;

  EventsFile? get _file => _load?.file;

  bool get _showingList =>
      _file != null && _file!.items.isNotEmpty && _errorMessage == null;

  bool get _showOfflineBanner =>
      !_initialLoad &&
      _errorMessage == null &&
      _load != null &&
      _load!.source != EventsSource.live;

  DateTime? get _parsedFileUpdatedAt => parseAsUtc(_file?.updatedAt);

  /// File `_file.updatedAt` after a successful load. Missing / parse fail: hide.
  bool get _showLastRefresh =>
      !_initialLoad &&
      _errorMessage == null &&
      _file != null &&
      _parsedFileUpdatedAt != null;

  bool get _showingError => _errorMessage != null && !_showingList;

  @override
  void initState() {
    super.initState();
    _readStore = widget.readStore ?? ReadStore.documents();
    _unreadOnlyStore = widget.unreadOnlyStore ?? UnreadOnlyStore.documents();
    _loadInitial();
  }

  @override
  void didUpdateWidget(covariant TimelinePage oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Source and title search are session-only. Unread-only is persisted.
    _selectedSource = null;
    _searchController.clear();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _messageOf(Object error) {
    return error is EventsLoadException ? error.message : error.toString();
  }

  Future<void> _loadInitial() async {
    try {
      await _readStore.load();
      final unreadOnly = await _unreadOnlyStore.load();
      final loaded = await widget.repository.load();
      if (!mounted) return;
      setState(() {
        if (!_unreadOnlyToggled) {
          _unreadOnly = unreadOnly;
        }
        _load = loaded;
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
      final loaded = await widget.repository.load();
      if (!mounted) return;
      setState(() {
        _load = loaded;
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
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: scheme.surface,
      appBar: AppBar(
        title: const Text('鸭先知'),
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        actions: [
          if (_showUnreadCount)
            Text('未读 $_unreadCount', key: const Key('unread-count')),
          Tooltip(
            message: '只看未读',
            child: Semantics(
              label: '只看未读',
              child: Switch(
                key: const Key('unread-only-toggle'),
                value: _unreadOnly,
                onChanged: (value) {
                  setState(() {
                    _unreadOnlyToggled = true;
                    _unreadOnly = value;
                  });
                  _unreadOnlyStore.save(value);
                },
              ),
            ),
          ),
          if (_showMarkAllRead)
            PopupMenuButton<String>(
              key: const Key('appbar-overflow'),
              icon: const Icon(Icons.more_vert),
              onSelected: (_) => _markAllRead(),
              itemBuilder: (context) => [
                const PopupMenuItem<String>(
                  key: Key('mark-all-read'),
                  value: 'mark-all-read',
                  child: Text('全标已读'),
                ),
              ],
            ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_showSessionFilters) ...[
            _TitleSearchField(
              controller: _searchController,
              onChanged: (_) => setState(() {}),
            ),
            _SourceFilterBar(
              names: sourceFilterNames(_file!.items),
              selected: _selectedSource,
              onSelected: (name) {
                setState(() {
                  _selectedSource = name;
                });
              },
            ),
          ],
          if (_showLastRefresh)
            _LastRefreshLabel(
              updatedAt: _parsedFileUpdatedAt!,
              now: widget.now,
            ),
          if (_showOfflineBanner) const _OfflineBanner(),
          Expanded(child: _buildBody()),
        ],
      ),
    );
  }

  bool get _showUnreadCount =>
      !_initialLoad && _errorMessage == null && _file != null;

  bool get _showMarkAllRead => _showUnreadCount && _unreadCount > 0;

  /// Full-file unread count. Ignores source, search, and 「只看未读」.
  int get _unreadCount {
    final file = _file;
    if (file == null) return 0;
    var n = 0;
    for (final item in file.items) {
      if (!_readStore.isRead(item.id)) n++;
    }
    return n;
  }

  bool get _showSessionFilters =>
      !_initialLoad &&
      _errorMessage == null &&
      _file != null &&
      _file!.items.isNotEmpty;

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
    final groups = _visibleGroups(file);
    if (groups.isEmpty) {
      return _refreshable(
        fill: true,
        child: Center(
          key: const Key('timeline-empty'),
          child: Text(_filteredEmptyMessage()),
        ),
      );
    }
    return _refreshable(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final group in groups)
            _DaySection(
              group: group,
              openUrl: widget.openUrl,
              shareEvent: widget.shareEvent,
              readStore: _readStore,
              onMarkedRead: _onMarkedRead,
              fileUpdatedAt: file.updatedAt,
              now: widget.now,
            ),
        ],
      ),
    );
  }

  List<DayGroup> _visibleGroups(EventsFile file) {
    final groups = groupTimeline(file);
    final visible = <DayGroup>[];
    for (final group in groups) {
      final items = _visibleItems(group.items);
      if (items.isNotEmpty) {
        visible.add(DayGroup(label: group.label, items: items));
      }
    }
    return visible;
  }

  List<EventItem> _visibleItems(List<EventItem> items) {
    return [
      for (final item in items)
        if (_matchesSource(item) && _matchesUnread(item) && _matchesTitle(item))
          item,
    ];
  }

  bool _matchesSource(EventItem item) {
    final selected = _selectedSource;
    if (selected == null) return true;
    return item.sourceChips.contains(selected);
  }

  bool _matchesUnread(EventItem item) {
    if (!_unreadOnly) return true;
    return !_readStore.isRead(item.id);
  }

  bool _matchesTitle(EventItem item) {
    final query = _searchController.text.trim();
    if (query.isEmpty) return true;
    return item.displayTitle.toLowerCase().contains(query.toLowerCase());
  }

  String _filteredEmptyMessage() {
    if (_unreadOnly) return '暂无未读';
    if (_searchController.text.trim().isNotEmpty) return '没有匹配';
    if (_selectedSource != null) return '暂无该来源';
    return '暂无事件';
  }

  void _onMarkedRead() {
    if (mounted) setState(() {});
  }

  /// Marks every loaded `_file.items` id. Filters do not change the set.
  Future<void> _markAllRead() async {
    final file = _file;
    if (file == null || _unreadCount == 0) return;
    await _readStore.markAll([for (final item in file.items) item.id]);
    if (mounted) setState(() {});
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

/// Deduped `sourceChips` from the currently loaded items, sorted as strings.
List<String> sourceFilterNames(Iterable<EventItem> items) {
  final names = <String>{};
  for (final item in items) {
    names.addAll(item.sourceChips);
  }
  return names.toList()..sort();
}

/// Relative age of `_file.updatedAt`, then `更新`. Reuses [relativeTimeLabel].
class _LastRefreshLabel extends StatelessWidget {
  const _LastRefreshLabel({
    required this.updatedAt,
    required this.now,
  });

  final DateTime updatedAt;
  final DateTime Function() now;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Text(
        '${relativeTimeLabel(updatedAt, now())}更新',
        key: const Key('last-refresh'),
        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
      ),
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      key: const Key('offline-banner'),
      color: scheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
        child: Text(
          '离线缓存',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: scheme.onSurfaceVariant,
              ),
        ),
      ),
    );
  }
}

class _TitleSearchField extends StatelessWidget {
  const _TitleSearchField({
    required this.controller,
    required this.onChanged,
  });

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: TextField(
        key: const Key('timeline-search'),
        controller: controller,
        onChanged: onChanged,
        textInputAction: TextInputAction.search,
        decoration: const InputDecoration(
          hintText: '搜索标题',
          isDense: true,
          border: OutlineInputBorder(),
        ),
      ),
    );
  }
}

class _SourceFilterBar extends StatelessWidget {
  const _SourceFilterBar({
    required this.names,
    required this.selected,
    required this.onSelected,
  });

  final List<String> names;
  final String? selected;
  final ValueChanged<String?> onSelected;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).colorScheme.surface,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Row(
          children: [
            _chip(
              key: const Key('source-filter-all'),
              label: '全部',
              selected: selected == null,
              onSelected: () => onSelected(null),
            ),
            for (final name in names)
              _chip(
                key: Key('source-filter-$name'),
                label: name,
                selected: selected == name,
                onSelected: () => onSelected(name),
              ),
          ],
        ),
      ),
    );
  }

  Widget _chip({
    required Key key,
    required String label,
    required bool selected,
    required VoidCallback onSelected,
  }) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: FilterChip(
        key: key,
        label: Text(label),
        selected: selected,
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
        onSelected: (_) => onSelected(),
      ),
    );
  }
}

class _DaySection extends StatelessWidget {
  const _DaySection({
    required this.group,
    required this.openUrl,
    required this.shareEvent,
    required this.readStore,
    required this.onMarkedRead,
    required this.fileUpdatedAt,
    required this.now,
  });

  final DayGroup group;
  final OpenUrl openUrl;
  final ShareEvent shareEvent;
  final ReadStore readStore;
  final VoidCallback onMarkedRead;
  final String? fileUpdatedAt;
  final DateTime Function() now;

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
                        ? Theme.of(context).colorScheme.onSurfaceVariant
                        : Theme.of(context).colorScheme.primary,
                    fontWeight: FontWeight.w700,
                  ),
            ),
          ),
          for (final item in group.items)
            EventCard(
              item: item,
              openUrl: openUrl,
              shareEvent: shareEvent,
              readStore: readStore,
              onMarkedRead: onMarkedRead,
              fileUpdatedAt: fileUpdatedAt,
              now: now,
            ),
        ],
      ),
    );
  }
}
