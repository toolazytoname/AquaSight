import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';

import '../data/events_repository.dart';
import '../data/read_store.dart';
import '../data/scroll_offset_store.dart';
import '../data/source_filter_store.dart';
import '../data/title_search_store.dart';
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
    required this.copyText,
    this.readStore,
    this.unreadOnlyStore,
    this.scrollOffsetStore,
    this.sourceFilterStore,
    this.titleSearchStore,
    this.now = DateTime.now,
    this.tickRelativeTime = false,
  });

  final EventsRepository repository;
  final OpenUrl openUrl;
  final ShareEvent shareEvent;
  final CopyText copyText;
  final ReadStore? readStore;
  final UnreadOnlyStore? unreadOnlyStore;
  final ScrollOffsetStore? scrollOffsetStore;
  final SourceFilterStore? sourceFilterStore;
  final TitleSearchStore? titleSearchStore;

  /// Injected clock. Tests pass a fixed UTC instant.
  final DateTime Function() now;

  /// Default off so [Timer.periodic] cannot hang pumpAndSettle. Production passes true.
  final bool tickRelativeTime;

  @override
  State<TimelinePage> createState() => _TimelinePageState();
}

const resumeRefreshCooldown = Duration(minutes: 2);
const relativeTimeTick = Duration(minutes: 1);
const Duration exitConfirmWindow = Duration(seconds: 2);
const double _kDayHeaderExtent = kMinInteractiveDimension;

class _TimelinePageState extends State<TimelinePage> with WidgetsBindingObserver {
  final GlobalKey<RefreshIndicatorState> _refreshKey =
      GlobalKey<RefreshIndicatorState>();
  final TextEditingController _searchController = TextEditingController();
  final FocusNode _searchFocusNode = FocusNode();

  late final ReadStore _readStore;
  late final UnreadOnlyStore _unreadOnlyStore;
  late final ScrollOffsetStore _scrollOffsetStore;
  late final SourceFilterStore _sourceFilterStore;
  late final TitleSearchStore _titleSearchStore;
  final ScrollController _scrollController = ScrollController();
  /// 0-height sliver before each pinned day header, keyed by [DayGroup.label].
  /// The pinned header's RenderBox is already at the viewport top, so
  /// [Scrollable.ensureVisible] on the header cannot scroll back to the start.
  final Map<String, GlobalKey> _dayGroupSentinels = <String, GlobalKey>{};
  /// 0-height box immediately above each visible unread card that is not the
  /// first item of its [DayGroup], keyed by [EventItem.id]. Reveal +
  /// [_kDayHeaderExtent] places the card top under the pinned day bar.
  /// First-in-group unread still uses [_dayGroupSentinels].
  final Map<String, GlobalKey> _unreadCardSentinels = <String, GlobalKey>{};
  bool _didRestoreOffset = false;
  bool _unreadOnly = false;
  /// True once [_onUnreadOnlyChanged] has run in this State lifetime.
  bool _unreadOnlyToggled = false;
  String? _selectedSource;
  /// True once a source chip has been tapped in this State lifetime.
  bool _sourceFilterToggled = false;
  /// True once the user has changed search (type / clear / 「查看全部」).
  bool _searchToggled = false;
  bool _initialLoad = true;
  bool _refreshing = false;
  DateTime? _lastSuccessAt;
  EventsLoad? _load;
  String? _errorMessage;
  Timer? _relativeTimeTimer;
  bool _exitArmed = false;
  Timer? _exitConfirmTimer;
  ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? _exitSnack;

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
    WidgetsBinding.instance.addObserver(this);
    _readStore = widget.readStore ?? ReadStore.documents();
    _unreadOnlyStore = widget.unreadOnlyStore ?? UnreadOnlyStore.documents();
    _scrollOffsetStore = widget.scrollOffsetStore ?? ScrollOffsetStore.documents();
    _sourceFilterStore = widget.sourceFilterStore ?? _defaultSourceFilterStore();
    _titleSearchStore = widget.titleSearchStore ?? _defaultTitleSearchStore();
    _searchFocusNode.addListener(_onSearchFocusChange);
    _loadInitial();
    _startRelativeTimeTick();
  }

  /// Rebuilds [PopScope] from [_searchFocusNode.hasFocus]. Tap-to-focus
  /// does not [setState] on its own.
  void _onSearchFocusChange() {
    if (!mounted) return;
    if (_searchFocusNode.hasFocus) {
      _disarmExit();
    }
    setState(() {});
  }

  /// Drop the T113 arm and close only the exit SnackBar.
  /// Repeat calls are no-ops when not armed.
  void _disarmExit() {
    _exitConfirmTimer?.cancel();
    _exitConfirmTimer = null;
    if (_exitArmed) {
      setState(() => _exitArmed = false);
    }
    _exitSnack?.close();
    _exitSnack = null;
  }

  void _startRelativeTimeTick() {
    if (!widget.tickRelativeTime) return;
    if (_relativeTimeTimer != null) return;
    _relativeTimeTimer = Timer.periodic(relativeTimeTick, (_) {
      if (mounted) setState(() {});
    });
  }

  void _stopRelativeTimeTick() {
    _relativeTimeTimer?.cancel();
    _relativeTimeTimer = null;
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (widget.tickRelativeTime) {
      if (state != AppLifecycleState.resumed) {
        _stopRelativeTimeTick();
      } else {
        _startRelativeTimeTick();
        setState(() {});
      }
    }
    if (state != AppLifecycleState.resumed || _initialLoad) return;
    final last = _lastSuccessAt;
    if (last != null &&
        widget.now().difference(last) < resumeRefreshCooldown) {
      return;
    }
    _retryFromError();
  }

  @override
  void dispose() {
    _stopRelativeTimeTick();
    _exitConfirmTimer?.cancel();
    _exitConfirmTimer = null;
    _exitSnack = null;
    _searchFocusNode.removeListener(_onSearchFocusChange);
    _searchFocusNode.dispose();
    WidgetsBinding.instance.removeObserver(this);
    _searchController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  String _messageOf(Object error) {
    return error is EventsLoadException ? error.message : error.toString();
  }

  Future<void> _loadInitial() async {
    try {
      await _readStore.load();
      final unreadOnly = await _unreadOnlyStore.load();
      if (!_unreadOnlyToggled && mounted) {
        setState(() {
          _unreadOnly = unreadOnly;
        });
      }
      await _scrollOffsetStore.load();
      final titleSearch = await _titleSearchStore.load();
      final selectedSource = await _sourceFilterStore.load();
      final loaded = await widget.repository.load();
      if (!mounted) return;
      setState(() {
        if (!_unreadOnlyToggled) {
          _unreadOnly = unreadOnly;
        }
        if (!_searchToggled) {
          _searchController.text = titleSearch;
        }
        if (!_sourceFilterToggled) {
          _selectedSource = selectedSource;
        }
        _load = loaded;
        _errorMessage = null;
        _initialLoad = false;
        _lastSuccessAt = widget.now();
      });
      _maybeRestoreOffset();
    } catch (e) {
      if (!mounted) return;
      var unreadOnly = _unreadOnly;
      if (!_unreadOnlyToggled) {
        unreadOnly = await _unreadOnlyStore.load();
      }
      if (!mounted) return;
      setState(() {
        if (!_unreadOnlyToggled) {
          _unreadOnly = unreadOnly;
        }
        _errorMessage = _messageOf(e);
        _initialLoad = false;
      });
    }
  }

  Future<void> _reload() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_refreshing) return;
    _refreshing = true;
    HapticFeedback.selectionClick();
    try {
      final previous = _file?.updatedAt?.trim() ?? '';
      final previousIds = _file?.items.map((e) => e.id).toSet() ?? {};
      final loaded = await widget.repository.load();
      if (!mounted) return;
      String? titleSearch;
      if (!_searchToggled) {
        titleSearch = await _titleSearchStore.load();
      }
      var unreadOnly = _unreadOnly;
      if (!_unreadOnlyToggled) {
        unreadOnly = await _unreadOnlyStore.load();
      }
      var selectedSource = _selectedSource;
      if (!_sourceFilterToggled) {
        selectedSource = await _sourceFilterStore.load();
      }
      if (!mounted) return;
      setState(() {
        if (!_searchToggled && titleSearch != null) {
          _searchController.text = titleSearch;
        }
        if (!_unreadOnlyToggled) {
          _unreadOnly = unreadOnly;
        }
        if (!_sourceFilterToggled) {
          _selectedSource = selectedSource;
        }
        _load = loaded;
        _errorMessage = null;
        _lastSuccessAt = widget.now();
      });
      _maybeRestoreOffset();
      final next = _file?.updatedAt?.trim() ?? '';
      if (previous != next) {
        final n =
            _file!.items.where((e) => !previousIds.contains(e.id)).length;
        final label = previous.isNotEmpty && previousIds.isNotEmpty && n > 0
            ? '已更新 · $n 条新'
            : '已更新';
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              key: const Key('feed-updated-snackbar'),
              content: Text(label),
              showCloseIcon: true,
              behavior: SnackBarBehavior.floating,
              elevation: 3,
              margin: EdgeInsets.fromLTRB(16, 8, 16, 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          );
        _scrollToNewest();
      } else if (previous.isNotEmpty) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              key: const Key('feed-latest-snackbar'),
              content: const Text('已是最新'),
              showCloseIcon: true,
              behavior: SnackBarBehavior.floating,
              elevation: 3,
              margin: EdgeInsets.fromLTRB(16, 8, 16, 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
            ),
          );
      }
    } catch (e) {
      _lastSuccessAt = null;
      if (!mounted) return;
      final message = _messageOf(e);
      if (_showingList) {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              key: const Key('feed-error-snackbar'),
              content: Text(message),
              showCloseIcon: true,
              behavior: SnackBarBehavior.floating,
              elevation: 3,
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
              action: SnackBarAction(
                key: const Key('feed-error-retry'),
                label: '重试',
                onPressed: _retryFromError,
              ),
            ),
          );
      } else if (_showingError) {
        setState(() {
          _errorMessage = message;
        });
      } else {
        ScaffoldMessenger.of(context)
          ..hideCurrentSnackBar()
          ..showSnackBar(
            SnackBar(
              key: const Key('feed-error-snackbar'),
              content: Text(message),
              showCloseIcon: true,
              behavior: SnackBarBehavior.floating,
              elevation: 3,
              margin: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(8),
              ),
              action: SnackBarAction(
                key: const Key('feed-error-retry'),
                label: '重试',
                onPressed: _retryFromError,
              ),
            ),
          );
      }
    } finally {
      _refreshing = false;
    }
  }

  Future<void> _retryFromError() {
    FocusManager.instance.primaryFocus?.unfocus();
    return _refreshKey.currentState?.show() ?? _reload();
  }

  Future<void> _copyText(String text) async {
    FocusManager.instance.primaryFocus?.unfocus();
    try {
      await widget.copyText(text);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            key: const Key('copy-error-snackbar'),
            content: const Text('无法复制'),
            showCloseIcon: true,
            behavior: SnackBarBehavior.floating,
            elevation: 3,
            margin: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
          ),
        );
      return;
    }
    if (!mounted) return;
    HapticFeedback.selectionClick();
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          key: const Key('copy-snackbar'),
          content: const Text('已复制'),
          showCloseIcon: true,
          duration: const Duration(seconds: 2),
          behavior: SnackBarBehavior.floating,
          elevation: 3,
          margin: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return PopScope<dynamic>(
      canPop: !_searchFocusNode.hasFocus &&
          !_unreadOnly &&
          _searchController.text.trim().isEmpty &&
          _selectedSource == null &&
          _exitArmed,
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) return;
        if (_searchFocusNode.hasFocus) {
          FocusManager.instance.primaryFocus?.unfocus();
          return;
        }
        if (_unreadOnly ||
            _searchController.text.trim().isNotEmpty ||
            _selectedSource != null) {
          _showAllFromFilteredEmpty();
          return;
        }
        setState(() => _exitArmed = true);
        _exitSnack?.close();
        _exitSnack = ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            key: Key('exit-confirm-snackbar'),
            content: Text('再按一次退出'),
            duration: exitConfirmWindow,
          ),
          snackBarAnimationStyle: const AnimationStyle(
            reverseDuration: Duration.zero,
          ),
        );
        final shown = _exitSnack!;
        shown.closed.whenComplete(() {
          if (identical(_exitSnack, shown)) {
            _exitSnack = null;
          }
        });
        _exitConfirmTimer?.cancel();
        _exitConfirmTimer = Timer(exitConfirmWindow, () {
          if (!mounted) return;
          setState(() => _exitArmed = false);
          _exitSnack?.close();
          _exitSnack = null;
        });
      },
      child: Theme(
        data: Theme.of(context).copyWith(
          textButtonTheme: TextButtonThemeData(
            style: ButtonStyle(
              overlayColor: WidgetStateProperty.resolveWith((states) {
                if (states.contains(WidgetState.pressed)) {
                  return scheme.primary.withValues(alpha: 0.12);
                }
                if (states.contains(WidgetState.hovered) ||
                    states.contains(WidgetState.focused)) {
                  return scheme.primary.withValues(alpha: 0.08);
                }
                return null;
              }),
            ),
          ),
        ),
        child: Scaffold(
      backgroundColor: scheme.surface,
      appBar: AppBar(
        title: const Text('鸭先知'),
        backgroundColor: scheme.surface,
        foregroundColor: scheme.onSurface,
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        shadowColor: Colors.transparent,
        systemOverlayStyle: SystemUiOverlayStyle(
          statusBarColor: Colors.transparent,
          statusBarIconBrightness: scheme.brightness == Brightness.light
              ? Brightness.dark
              : Brightness.light,
          statusBarBrightness: scheme.brightness == Brightness.light
              ? Brightness.light
              : Brightness.dark,
        ),
        actions: [
          if (_showUnreadCount)
            Tooltip(
              message: _unreadCountTooltip,
              child: InkWell(
                key: const Key('unread-count-hit'),
                onTap: _onUnreadCountTap,
                customBorder: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                splashColor: scheme.primary.withValues(alpha: 0.12),
                highlightColor: scheme.primary.withValues(alpha: 0.08),
                hoverColor: scheme.primary.withValues(alpha: 0.08),
                focusColor: scheme.primary.withValues(alpha: 0.08),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(
                    minWidth: 48,
                    minHeight: 48,
                  ),
                  child: Align(
                    alignment: Alignment.center,
                    child: Text(
                      unreadCountLabel(_unreadCount),
                      key: const Key('unread-count'),
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                    ),
                  ),
                ),
              ),
            ),
          Tooltip(
            message: '只看未读',
            child: ConstrainedBox(
              constraints: const BoxConstraints(minHeight: 48),
              child: Align(
                alignment: Alignment.center,
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    InkWell(
                      onTap: () => _onUnreadOnlyChanged(!_unreadOnly),
                      customBorder: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                      splashColor: scheme.primary.withValues(alpha: 0.12),
                      highlightColor: scheme.primary.withValues(alpha: 0.08),
                      hoverColor: scheme.primary.withValues(alpha: 0.08),
                      focusColor: scheme.primary.withValues(alpha: 0.08),
                      child: Text(
                        '未读',
                        key: const Key('unread-only-label'),
                        semanticsLabel: '',
                        style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                      ),
                    ),
                    Switch(
                      key: const Key('unread-only-toggle'),
                      value: _unreadOnly,
                      onChanged: _onUnreadOnlyChanged,
                      overlayColor: WidgetStateProperty.resolveWith((states) {
                        if (states.contains(WidgetState.pressed)) {
                          return scheme.primary.withValues(alpha: 0.12);
                        } else if (states.contains(WidgetState.hovered) ||
                            states.contains(WidgetState.focused)) {
                          return scheme.primary.withValues(alpha: 0.08);
                        } else {
                          return null;
                        }
                      }),
                    ),
                  ],
                ),
              ),
            ),
          ),
          // PopupMenuItem has no overlayColor; InkWell reads Theme splash colors.
          // Theme around the button is captured into the menu route.
          if (_showMarkAllRead)
            Theme(
              data: Theme.of(context).copyWith(
                splashColor: scheme.primary.withValues(alpha: 0.12),
                highlightColor: scheme.primary.withValues(alpha: 0.08),
                hoverColor: scheme.primary.withValues(alpha: 0.08),
                focusColor: scheme.primary.withValues(alpha: 0.08),
              ),
              child: PopupMenuButton<String>(
                key: const Key('appbar-overflow'),
                tooltip: '全标已读',
                elevation: 3,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                style: ButtonStyle(
                  overlayColor: WidgetStateProperty.resolveWith((states) {
                    if (states.contains(WidgetState.pressed)) {
                      return scheme.primary.withValues(alpha: 0.12);
                    } else if (states.contains(WidgetState.hovered) ||
                        states.contains(WidgetState.focused)) {
                      return scheme.primary.withValues(alpha: 0.08);
                    } else {
                      return null;
                    }
                  }),
                  shape: const WidgetStatePropertyAll(
                    RoundedRectangleBorder(
                      borderRadius: BorderRadius.all(Radius.circular(8)),
                    ),
                  ),
                ),
                icon: Icon(Icons.more_vert, color: scheme.onSurfaceVariant),
                onOpened: () {
                  FocusManager.instance.primaryFocus?.unfocus();
                },
                onSelected: (_) => _markAllRead(),
                itemBuilder: (context) {
                  final theme = Theme.of(context);
                  final textTheme = theme.textTheme;
                  final scheme = theme.colorScheme;
                  return [
                    PopupMenuItem<String>(
                      key: const Key('mark-all-read'),
                      value: 'mark-all-read',
                      height: kMinInteractiveDimension,
                      child: Row(
                        children: [
                          Icon(
                            Icons.done_all,
                            key: const Key('mark-all-read-icon'),
                            size: 20,
                            color: scheme.onSurfaceVariant,
                          ),
                          const SizedBox(width: 12),
                          Text(
                            '全标已读',
                            style: textTheme.labelLarge?.copyWith(
                              color: scheme.onSurface,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ];
                },
              ),
            ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_showSessionFilters) ...[
            _TitleSearchField(
              controller: _searchController,
              focusNode: _searchFocusNode,
              onChanged: (text) {
                _disarmExit();
                setState(() {
                  _searchToggled = true;
                });
                _titleSearchStore.save(text);
                _jumpListToTop();
              },
            ),
            _SourceFilterBar(
              names: sourceFilterNames(_file!.items),
              selected: _selectedSource,
              onSelected: _onSourceSelected,
              onCopySource: _copyText,
            ),
            if (_showClearFiltersBar)
              Tooltip(
                message: '清除筛选',
                child: TextButton(
                  key: const Key('timeline-clear-filters'),
                  style: TextButton.styleFrom(
                    minimumSize: const Size(
                      double.infinity,
                      kMinInteractiveDimension,
                    ),
                    alignment: Alignment.centerLeft,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ).copyWith(
                    overlayColor: WidgetStateProperty.resolveWith((states) {
                      if (states.contains(WidgetState.pressed)) {
                        return scheme.primary.withValues(alpha: 0.12);
                      } else if (states.contains(WidgetState.hovered) ||
                          states.contains(WidgetState.focused)) {
                        return scheme.primary.withValues(alpha: 0.08);
                      } else {
                        return null;
                      }
                    }),
                  ),
                  onPressed: _showAllFromFilteredEmpty,
                  child: const ExcludeSemantics(
                    child: Text('清除筛选'),
                  ),
                ),
              ),
          ],
          if (_showLastRefresh)
            _LastRefreshLabel(
              updatedAt: _parsedFileUpdatedAt!,
              now: widget.now,
              onTap: _retryFromError,
              onLongPress: () => _copyText(beijingClockLabel(_parsedFileUpdatedAt!)),
            ),
          if (_showOfflineBanner) _OfflineBanner(onTap: _retryFromError),
          Expanded(child: _buildBody()),
        ],
      ),
      ),
      ),
    );
  }

  bool get _showUnreadCount =>
      !_initialLoad && _errorMessage == null && _file != null;

  /// Same sequence as the unread-only Switch: unfocus, disarm, setState,
  /// persist, jump to top.
  void _onUnreadOnlyChanged(bool value) {
    FocusManager.instance.primaryFocus?.unfocus();
    HapticFeedback.selectionClick();
    _disarmExit();
    setState(() {
      _unreadOnlyToggled = true;
      _unreadOnly = value;
    });
    _unreadOnlyStore.save(value);
    _jumpListToTop();
  }

  /// Instant pin to offset 0 after a user filter change. No-op when detached
  /// or already at top. Does not unfocus, write the store, or animate.
  void _jumpListToTop() {
    if (_scrollController.hasClients && _scrollController.offset > 0) {
      _scrollController.jumpTo(0);
    }
  }

  /// Jump to the newest items. No-op when the list controller is detached or
  /// already at offset 0. Does not write the store; T48 ScrollEnd still does.
  void _scrollToNewest() {
    FocusManager.instance.primaryFocus?.unfocus();
    if (_scrollController.hasClients && _scrollController.offset > 0) {
      _scrollController.animateTo(
        0,
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOut,
      );
    }
  }

  /// Scroll so [label]'s group starts at the list top (title, then first card).
  /// Reveals the 0-height sentinel before the pinned header. No-op when the
  /// delta is under 1px. Does not write the store; T48 ScrollEnd still does.
  void _scrollToDayGroup(String label) {
    FocusManager.instance.primaryFocus?.unfocus();
    final target = _offsetToRevealSentinel(_dayGroupSentinels[label]);
    if (target == null) return;
    if ((target - _scrollController.offset).abs() < 1) return;
    HapticFeedback.selectionClick();
    _scrollController.animateTo(
      target,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  /// Day-header tap: walk that group's visible unread (same parked rule as
  /// [_onUnreadCountTap], via [_targetOffsetForUnread]). Not parked → first.
  /// Parked with more after → next. Parked on the last → stay put. No unread
  /// / group missing → [_scrollToDayGroup]. Does not write the store; T48
  /// ScrollEnd still does.
  void _onDayHeaderTap(String label) {
    FocusManager.instance.primaryFocus?.unfocus();
    final file = _file;
    if (file != null) {
      for (final group in _visibleGroups(file)) {
        if (group.label != label) continue;
        final unread = [
          for (final item in group.items)
            if (!_readStore.isRead(item.id)) item,
        ];
        if (unread.isEmpty) break;
        if (!_scrollController.hasClients) return;
        final current = _scrollController.offset;
        var parkedIndex = -1;
        for (var i = 0; i < unread.length; i++) {
          final parked = _targetOffsetForUnread(group, unread[i]);
          if (parked != null && (parked - current).abs() < 1) {
            parkedIndex = i;
            break;
          }
        }
        if (parkedIndex >= 0 && parkedIndex == unread.length - 1) {
          return;
        }
        final next = parkedIndex < 0 ? unread.first : unread[parkedIndex + 1];
        final target = _targetOffsetForUnread(group, next);
        if (target == null) return;
        if ((target - current).abs() < 1) return;
        HapticFeedback.selectionClick();
        _scrollController.animateTo(
          target,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
        return;
      }
    }
    _scrollToDayGroup(label);
  }

  /// Reveal [key]'s 0-height sentinel, plus [extra], clamped to the scroll
  /// range. First-in-group unread uses a day sentinel (`extra` 0); later
  /// unread cards use their card-front sentinel + [_kDayHeaderExtent].
  double? _offsetToRevealSentinel(GlobalKey? key, {double extra = 0}) {
    if (!_scrollController.hasClients) return null;
    final targetObject = key?.currentContext?.findRenderObject();
    if (targetObject == null || !targetObject.attached) return null;
    final viewport = RenderAbstractViewport.of(targetObject);
    return (viewport.getOffsetToReveal(targetObject, 0.0).offset + extra).clamp(
      0.0,
      _scrollController.position.maxScrollExtent,
    );
  }

  /// Target offset that parks the list on [item] under the pinned day bar.
  /// First card of [group] uses the day sentinel; else the per-card sentinel
  /// plus [_kDayHeaderExtent]. Shared by unread-count stepping.
  double? _targetOffsetForUnread(DayGroup group, EventItem item) {
    if (group.items.isNotEmpty && group.items.first.id == item.id) {
      return _offsetToRevealSentinel(_dayGroupSentinels[group.label]);
    }
    return _offsetToRevealSentinel(
      _unreadCardSentinels[item.id],
      extra: _kDayHeaderExtent,
    );
  }

  /// Walk visible unread cards downward. Not parked on any → first card.
  /// Parked on one (current offset vs that card's target differs by < 1px)
  /// → next. Parked on the last → [_scrollToNewest]. No visible unread also
  /// falls back to [_scrollToNewest]. Does not write the store; T48 ScrollEnd
  /// still does.
  void _onUnreadCountTap() {
    FocusManager.instance.primaryFocus?.unfocus();
    final unread = _visibleUnreadCards();
    if (unread.isEmpty) {
      if (_scrollController.hasClients && _scrollController.offset > 0) {
        HapticFeedback.selectionClick();
      }
      _scrollToNewest();
      return;
    }
    if (!_scrollController.hasClients) return;
    final current = _scrollController.offset;
    var parkedIndex = -1;
    for (var i = 0; i < unread.length; i++) {
      final parked = _targetOffsetForUnread(unread[i].group, unread[i].item);
      if (parked != null && (parked - current).abs() < 1) {
        parkedIndex = i;
        break;
      }
    }
    if (parkedIndex >= 0 && parkedIndex == unread.length - 1) {
      if (_scrollController.hasClients && _scrollController.offset > 0) {
        HapticFeedback.selectionClick();
      }
      _scrollToNewest();
      return;
    }
    final next = parkedIndex < 0 ? unread.first : unread[parkedIndex + 1];
    final target = _targetOffsetForUnread(next.group, next.item);
    if (target == null) return;
    if ((target - current).abs() < 1) return;
    HapticFeedback.selectionClick();
    _scrollController.animateTo(
      target,
      duration: const Duration(milliseconds: 200),
      curve: Curves.easeOut,
    );
  }

  /// Visible unread cards in [_visibleGroups] top to bottom.
  List<({DayGroup group, EventItem item})> _visibleUnreadCards() {
    final file = _file;
    if (file == null) return const [];
    return [
      for (final group in _visibleGroups(file))
        for (final item in group.items)
          if (!_readStore.isRead(item.id)) (group: group, item: item),
    ];
  }

  /// Same parked rule as [_onUnreadCountTap]: current offset vs that card's
  /// target differs by < 1px. Not parked → 「第一条未读」. Parked with more
  /// after → 「下一条未读」. Parked on the last / no visible unread → 「回到顶部」.
  String get _unreadCountTooltip {
    final unread = _visibleUnreadCards();
    if (unread.isEmpty) return '回到顶部';
    final current = _scrollController.hasClients
        ? _scrollController.offset
        : _scrollOffsetStore.value;
    var parkedIndex = -1;
    for (var i = 0; i < unread.length; i++) {
      final parked = _targetOffsetForUnread(unread[i].group, unread[i].item);
      if (parked != null && (parked - current).abs() < 1) {
        parkedIndex = i;
        break;
      }
    }
    // First frame: day-sentinel reveal is not laid out yet. Top group's
    // first card parks at 0 — same target `_targetOffsetForUnread` returns
    // after layout.
    if (parkedIndex < 0 && current.abs() < 1) {
      final file = _file;
      final groups = file == null ? const <DayGroup>[] : _visibleGroups(file);
      final first = unread.first;
      if (groups.isNotEmpty &&
          groups.first.label == first.group.label &&
          first.group.items.isNotEmpty &&
          first.group.items.first.id == first.item.id) {
        parkedIndex = 0;
      }
    }
    if (parkedIndex < 0) return '第一条未读';
    if (parkedIndex == unread.length - 1) return '回到顶部';
    return '下一条未读';
  }

  /// Sentinel above every visible unread that is not the first item of its
  /// [DayGroup]. First-in-group uses [_dayGroupSentinels].
  bool _shouldPlaceUnreadCardSentinel(DayGroup group, EventItem item) {
    if (_readStore.isRead(item.id)) return false;
    return group.items.first.id != item.id;
  }

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

  /// One-tap clear in the filter bar. Hidden on filtered-empty (T78 owns that).
  bool get _showClearFiltersBar =>
      _showSessionFilters &&
      _hasVisibleCards &&
      (_unreadOnly ||
          _searchController.text.trim().isNotEmpty ||
          _selectedSource != null);

  Widget _buildBody() {
    if (_initialLoad) {
      return Center(
        key: const Key('timeline-loading'),
        child: Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.paddingOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              SizedBox(
                width: 48,
                height: 48,
                child: CircularProgressIndicator(
                  key: const Key('timeline-loading-spinner'),
                  color: Theme.of(context).colorScheme.primary,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                '加载中…',
                key: const Key('timeline-loading-label'),
                style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
              ),
            ],
          ),
        ),
      );
    }
    if (_errorMessage != null) {
      final scheme = Theme.of(context).colorScheme;
      return _refreshable(
        fill: true,
        child: Center(
          key: const Key('timeline-error'),
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              24,
              24,
              24,
              24 + MediaQuery.paddingOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.error_outline,
                  key: const Key('timeline-error-icon'),
                  size: 48,
                  color: Theme.of(context).colorScheme.error,
                ),
                const SizedBox(height: 8),
                Text(
                  '加载失败',
                  key: const Key('timeline-error-title'),
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  _errorMessage!,
                  key: const Key('timeline-error-detail'),
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
                const SizedBox(height: 16),
                Tooltip(
                  message: '重新加载',
                  child: FilledButton(
                    key: const Key('timeline-error-retry'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(
                        kMinInteractiveDimension,
                        kMinInteractiveDimension,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ).copyWith(
                      overlayColor: WidgetStateProperty.resolveWith((states) {
                        if (states.contains(WidgetState.pressed)) {
                          return scheme.primary.withValues(alpha: 0.12);
                        } else if (states.contains(WidgetState.hovered) ||
                            states.contains(WidgetState.focused)) {
                          return scheme.primary.withValues(alpha: 0.08);
                        } else {
                          return null;
                        }
                      }),
                    ),
                    onPressed: _retryFromError,
                    child: const Text('重试'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final file = _file!;
    if (file.items.isEmpty) {
      final scheme = Theme.of(context).colorScheme;
      return _refreshable(
        fill: true,
        child: Center(
          key: const Key('timeline-empty'),
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.paddingOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.inbox_outlined,
                  key: const Key('timeline-empty-icon'),
                  size: 48,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: 8),
                Text(
                  '暂无事件',
                  key: const Key('timeline-empty-label'),
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                ),
                const SizedBox(height: 16),
                Tooltip(
                  message: '重新加载',
                  child: FilledButton(
                    key: const Key('timeline-empty-refresh'),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(
                        kMinInteractiveDimension,
                        kMinInteractiveDimension,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ).copyWith(
                      overlayColor: WidgetStateProperty.resolveWith((states) {
                        if (states.contains(WidgetState.pressed)) {
                          return scheme.primary.withValues(alpha: 0.12);
                        } else if (states.contains(WidgetState.hovered) ||
                            states.contains(WidgetState.focused)) {
                          return scheme.primary.withValues(alpha: 0.08);
                        } else {
                          return null;
                        }
                      }),
                    ),
                    onPressed: _retryFromError,
                    child: const Text('刷新'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final groups = _visibleGroups(file);
    if (groups.isEmpty) {
      final scheme = Theme.of(context).colorScheme;
      return _refreshable(
        fill: true,
        child: Center(
          key: const Key('timeline-empty'),
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.paddingOf(context).bottom,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.filter_alt_off,
                  key: const Key('timeline-filtered-empty-icon'),
                  size: 48,
                  color: Theme.of(context).colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: 8),
                Text(
                  _filteredEmptyMessage(),
                  key: const Key('timeline-empty-label'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                ),
                Tooltip(
                  message: '清除筛选',
                  child: TextButton(
                    key: const Key('timeline-empty-show-all'),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(
                        kMinInteractiveDimension,
                        kMinInteractiveDimension,
                      ),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ).copyWith(
                      overlayColor: WidgetStateProperty.resolveWith((states) {
                        if (states.contains(WidgetState.pressed)) {
                          return scheme.primary.withValues(alpha: 0.12);
                        } else if (states.contains(WidgetState.hovered) ||
                            states.contains(WidgetState.focused)) {
                          return scheme.primary.withValues(alpha: 0.08);
                        } else {
                          return null;
                        }
                      }),
                    ),
                    onPressed: _showAllFromFilteredEmpty,
                    child: const Text('查看全部'),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }
    _maybeRestoreOffset();
    final scheme = Theme.of(context).colorScheme;
    return _refreshable(
      slivers: [
        for (final group in groups) ..._dayGroupSlivers(group, file),
        SliverToBoxAdapter(
          child: Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.paddingOf(context).bottom,
            ),
            child: Material(
              color: Colors.transparent,
              child: Tooltip(
                message: '回到顶部',
                child: InkWell(
                  onTap: () {
                    if (_scrollController.hasClients &&
                        _scrollController.offset > 0) {
                      HapticFeedback.selectionClick();
                    }
                    _scrollToNewest();
                  },
                  customBorder: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  splashColor: scheme.primary.withValues(alpha: 0.12),
                  highlightColor: scheme.primary.withValues(alpha: 0.08),
                  hoverColor: scheme.primary.withValues(alpha: 0.08),
                  focusColor: scheme.primary.withValues(alpha: 0.08),
                  child: SizedBox(
                    height: 48,
                    width: double.infinity,
                    child: Center(
                      child: Text(
                        _unreadCount == 0 ? '已全部看完' : '没有更多了',
                        key: const Key('timeline-end'),
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  /// Pinned day header plus that day's cards. Header extent is
  /// [_kDayHeaderExtent]; cards keep the old 16px horizontal inset.
  List<Widget> _dayGroupSlivers(DayGroup group, EventsFile file) {
    final unreadCount =
        group.items.where((i) => !_readStore.isRead(i.id)).length;
    final sentinelKey = _dayGroupSentinels.putIfAbsent(
      group.label,
      GlobalKey.new,
    );
    return [
      SliverToBoxAdapter(
        child: SizedBox.shrink(key: sentinelKey),
      ),
      SliverPersistentHeader(
        pinned: true,
        delegate: _DayHeaderDelegate(
          group: group,
          now: widget.now,
          unreadCount: unreadCount,
          onTap: () => _onDayHeaderTap(group.label),
          onLongPress: () => _copyText(group.label),
        ),
      ),
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: 16),
        sliver: SliverToBoxAdapter(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final item in group.items) ...[
                if (_shouldPlaceUnreadCardSentinel(group, item))
                  SizedBox.shrink(
                    key: _unreadCardSentinels.putIfAbsent(item.id, GlobalKey.new),
                  ),
                EventCard(
                  item: item,
                  openUrl: widget.openUrl,
                  shareEvent: widget.shareEvent,
                  copyText: widget.copyText,
                  readStore: _readStore,
                  onMarkedRead: _onMarkedRead,
                  onSourceChipTap: _onSourceSelected,
                  selectedSource: _selectedSource,
                  searchQuery: _searchController.text,
                  fileUpdatedAt: file.updatedAt,
                  now: widget.now,
                ),
              ],
            ],
          ),
        ),
      ),
    ];
  }

  /// After the first load that paints cards, jump once. Ignore later `updatedAt`.
  void _maybeRestoreOffset() {
    if (_didRestoreOffset) return;
    if (!_hasVisibleCards) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || _didRestoreOffset) return;
      if (!_hasVisibleCards) return;
      if (!_scrollController.hasClients) {
        _maybeRestoreOffset();
        return;
      }
      final max = _scrollController.position.maxScrollExtent;
      _scrollController.jumpTo(_scrollOffsetStore.value.clamp(0.0, max));
      _didRestoreOffset = true;
    });
  }

  bool get _hasVisibleCards {
    if (_errorMessage != null || _initialLoad) return false;
    final file = _file;
    if (file == null || file.items.isEmpty) return false;
    return _visibleGroups(file).isNotEmpty;
  }

  bool _onListScrollUpdate(ScrollUpdateNotification notification) {
    if (notification.depth == 0 && notification.scrollDelta != 0) {
      FocusManager.instance.primaryFocus?.unfocus();
    }
    return false;
  }

  bool _onListScrollEnd(ScrollEndNotification notification) {
    if (notification.depth != 0) return false;
    if (!_hasVisibleCards) return false;
    _scrollOffsetStore.save(_scrollController.offset);
    if (mounted) setState(() {});
    return false;
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

  /// Top-bar chips and card source chips share this: unfocus, disarm exit,
  /// toggle (tap already-selected → null), persist, jump to top.
  void _onSourceSelected(String? name) {
    FocusManager.instance.primaryFocus?.unfocus();
    HapticFeedback.selectionClick();
    _disarmExit();
    setState(() {
      _selectedSource = _selectedSource == name ? null : name;
      _sourceFilterToggled = true;
    });
    _sourceFilterStore.save(_selectedSource);
    _jumpListToTop();
  }

  /// Clears unread, title search, and source in one tap. Does not reload.
  void _showAllFromFilteredEmpty() {
    FocusManager.instance.primaryFocus?.unfocus();
    HapticFeedback.selectionClick();
    _unreadOnly = false;
    _unreadOnlyToggled = true;
    _unreadOnlyStore.save(false);
    _searchController.clear();
    _searchToggled = true;
    _titleSearchStore.save('');
    _selectedSource = null;
    _sourceFilterToggled = true;
    _sourceFilterStore.save(null);
    setState(() {});
    _jumpListToTop();
  }

  void _onMarkedRead() {
    if (mounted) setState(() {});
  }

  /// Marks every loaded `_file.items` id. Filters do not change the set.
  Future<void> _markAllRead() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final file = _file;
    if (file == null || _unreadCount == 0) return;
    final unreadIds = [
      for (final item in file.items)
        if (!_readStore.isRead(item.id)) item.id,
    ];
    await _readStore.markAll([for (final item in file.items) item.id]);
    if (!mounted) return;
    HapticFeedback.selectionClick();
    setState(() {});
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          key: const Key('mark-all-read-snackbar'),
          content: const Text('已全部标为已读'),
          showCloseIcon: true,
          behavior: SnackBarBehavior.floating,
          elevation: 3,
          margin: const EdgeInsets.fromLTRB(16, 8, 16, 16),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          action: SnackBarAction(
            key: const Key('mark-all-undo'),
            label: '撤销',
            onPressed: () async {
              await _readStore.markUnreadAll(unreadIds);
              if (mounted) setState(() {});
            },
          ),
        ),
      );
  }

  Widget _refreshable({
    Widget? child,
    List<Widget>? slivers,
    bool fill = false,
  }) {
    final scheme = Theme.of(context).colorScheme;
    return RefreshIndicator(
      key: _refreshKey,
      color: scheme.primary,
      backgroundColor: scheme.surfaceContainerHighest,
      onRefresh: _reload,
      child: fill
          ? CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              slivers: [
                SliverFillRemaining(hasScrollBody: false, child: child),
              ],
            )
          : NotificationListener<ScrollUpdateNotification>(
              onNotification: _onListScrollUpdate,
              child: NotificationListener<ScrollEndNotification>(
                onNotification: _onListScrollEnd,
                child: ScrollbarTheme(
                  data: ScrollbarTheme.of(context).copyWith(
                    thumbColor: WidgetStatePropertyAll(scheme.outline),
                    radius: const Radius.circular(8),
                    thickness: const WidgetStatePropertyAll(8.0),
                    minThumbLength: 48,
                    crossAxisMargin: 2,
                    interactive: true,
                    trackVisibility: WidgetStateProperty.resolveWith((states) {
                      if (states.contains(WidgetState.hovered) ||
                          states.contains(WidgetState.dragged) ||
                          states.contains(WidgetState.focused)) {
                        return true;
                      }
                      return false;
                    }),
                  ),
                  child: Scrollbar(
                    controller: _scrollController,
                    child: _TimelineScrollView(
                      key: const Key('timeline-scroll'),
                      controller: _scrollController,
                      physics: const AlwaysScrollableScrollPhysics(),
                      slivers: slivers!,
                    ),
                  ),
                ),
              ),
            ),
    );
  }
}

/// Production uses the documents file. Widget tests have no path_provider
/// plugin; awaiting it never completes and would leave the loading spinner
/// running, so those bindings get an empty in-memory store.
TitleSearchStore _defaultTitleSearchStore() {
  if (WidgetsBinding.instance.runtimeType.toString().contains('Test')) {
    return TitleSearchStore.memory();
  }
  return TitleSearchStore.documents();
}

/// Same test-binding fallback as [_defaultTitleSearchStore]. `_reload` now
/// awaits this store; a hanging documents load would leave RefreshIndicator up.
SourceFilterStore _defaultSourceFilterStore() {
  if (WidgetsBinding.instance.runtimeType.toString().contains('Test')) {
    return SourceFilterStore.memory();
  }
  return SourceFilterStore.documents();
}

/// Display-only AppBar copy for the full-file unread count.
/// [n] <= 0 becomes `回顶`. Values above 99 become `未读 99+`.
String unreadCountLabel(int n) {
  if (n <= 0) return '回顶';
  if (n > 99) return '未读 99+';
  return '未读 $n';
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
    required this.onTap,
    required this.onLongPress,
  });

  final DateTime updatedAt;
  final DateTime Function() now;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final clock = beijingClockLabel(updatedAt);
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      child: Material(
        color: Colors.transparent,
        child: Tooltip(
          message: '$clock · 点按刷新',
          child: InkWell(
            key: const Key('last-refresh-hit'),
            onTap: onTap,
            onLongPress: onLongPress,
            customBorder: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            splashColor: scheme.primary.withValues(alpha: 0.12),
            highlightColor: scheme.primary.withValues(alpha: 0.08),
            hoverColor: scheme.primary.withValues(alpha: 0.08),
            focusColor: scheme.primary.withValues(alpha: 0.08),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: 48,
                minWidth: double.infinity,
              ),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  '${relativeTimeLabel(updatedAt, now())} · 更新',
                  key: const Key('last-refresh'),
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _OfflineBanner extends StatelessWidget {
  const _OfflineBanner({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Material(
      key: const Key('offline-banner'),
      color: scheme.surfaceContainerHighest,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
      ),
      clipBehavior: Clip.antiAlias,
      child: Tooltip(
        message: '点按刷新',
        child: InkWell(
          onTap: onTap,
          customBorder: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          splashColor: scheme.primary.withValues(alpha: 0.12),
          highlightColor: scheme.primary.withValues(alpha: 0.08),
          hoverColor: scheme.primary.withValues(alpha: 0.08),
          focusColor: scheme.primary.withValues(alpha: 0.08),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minHeight: 48,
              minWidth: double.infinity,
            ),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                child: Text(
                  '离线缓存 · 点按刷新',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _TitleSearchField extends StatelessWidget {
  const _TitleSearchField({
    required this.controller,
    required this.focusNode,
    required this.onChanged,
  });

  final TextEditingController controller;
  final FocusNode focusNode;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
      child: Semantics(
        label: '搜索标题',
        textField: true,
        child: Theme(
          data: Theme.of(context).copyWith(
            textSelectionTheme: TextSelectionThemeData(
              cursorColor: scheme.primary,
              selectionColor: scheme.primary.withValues(alpha: 0.4),
              selectionHandleColor: scheme.primary,
            ),
          ),
          child: TextField(
            key: const Key('timeline-search'),
            controller: controller,
            focusNode: focusNode,
            onChanged: onChanged,
            onSubmitted: (_) {
              FocusManager.instance.primaryFocus?.unfocus();
            },
            onTapOutside: (_) {
              FocusManager.instance.primaryFocus?.unfocus();
            },
            textInputAction: TextInputAction.search,
            autocorrect: false,
            enableSuggestions: false,
            textCapitalization: TextCapitalization.none,
            smartDashesType: SmartDashesType.disabled,
            smartQuotesType: SmartQuotesType.disabled,
            cursorColor: scheme.primary,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
              color: Theme.of(context).colorScheme.onSurface,
            ),
            decoration: InputDecoration(
              hintText: '搜索标题',
              hintStyle: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
              prefixIcon: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: focusNode.requestFocus,
                  hoverColor: scheme.primary.withValues(alpha: 0.08),
                  focusColor: scheme.primary.withValues(alpha: 0.08),
                  splashColor: scheme.primary.withValues(alpha: 0.12),
                  highlightColor: scheme.primary.withValues(alpha: 0.08),
                  customBorder: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: SizedBox(
                    width: kMinInteractiveDimension,
                    height: kMinInteractiveDimension,
                    child: Align(
                      child: Icon(
                        Icons.search,
                        key: const Key('timeline-search-icon'),
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),
                ),
              ),
              prefixIconConstraints: const BoxConstraints(
                minWidth: kMinInteractiveDimension,
                minHeight: kMinInteractiveDimension,
              ),
              suffixIconConstraints: const BoxConstraints(
                minWidth: kMinInteractiveDimension,
                minHeight: kMinInteractiveDimension,
              ),
              isDense: true,
              contentPadding: const EdgeInsets.fromLTRB(8, 12, 8, 12),
              filled: true,
              fillColor: Theme.of(context).colorScheme.surfaceContainerHighest,
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(
                  color: Theme.of(context).colorScheme.outline,
                ),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: scheme.primary, width: 2),
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(
                  color: Theme.of(context).colorScheme.outline,
                ),
              ),
              errorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: scheme.error),
              ),
              focusedErrorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: scheme.error, width: 2),
              ),
              disabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(8),
                borderSide: BorderSide(color: scheme.outlineVariant),
              ),
              suffixIcon: controller.text.isNotEmpty
                  ? SizedBox(
                      width: kMinInteractiveDimension,
                      height: kMinInteractiveDimension,
                      child: IconButton(
                        key: const Key('timeline-search-clear'),
                        tooltip: '清除',
                        padding: EdgeInsets.zero,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        icon: const Icon(Icons.clear),
                        style: ButtonStyle(
                          overlayColor:
                              WidgetStateProperty.resolveWith((states) {
                            if (states.contains(WidgetState.pressed)) {
                              return scheme.primary.withValues(alpha: 0.12);
                            } else if (states.contains(WidgetState.hovered) ||
                                states.contains(WidgetState.focused)) {
                              return scheme.primary.withValues(alpha: 0.08);
                            } else {
                              return null;
                            }
                          }),
                          shape: const WidgetStatePropertyAll(
                            RoundedRectangleBorder(
                              borderRadius: BorderRadius.all(Radius.circular(8)),
                            ),
                          ),
                        ),
                        onPressed: () {
                          FocusManager.instance.primaryFocus?.unfocus();
                          HapticFeedback.selectionClick();
                          controller.clear();
                          onChanged('');
                        },
                      ),
                    )
                  : null,
            ),
          ),
        ),
      ),
    );
  }
}

class _SourceFilterBar extends StatefulWidget {
  const _SourceFilterBar({
    required this.names,
    required this.selected,
    required this.onSelected,
    required this.onCopySource,
  });

  final List<String> names;
  final String? selected;
  final ValueChanged<String?> onSelected;
  final ValueChanged<String> onCopySource;

  @override
  State<_SourceFilterBar> createState() => _SourceFilterBarState();
}

class _SourceFilterBarState extends State<_SourceFilterBar> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scheduleRevealSelected();
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(_SourceFilterBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.selected != widget.selected) {
      _scheduleRevealSelected();
    }
  }

  /// Cold-start (and later selection) reveal. 「全部」 and unknown names stay put.
  void _scheduleRevealSelected() {
    final selected = widget.selected;
    if (selected == null || !widget.names.contains(selected)) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final target = _mountedChipContext(Key('source-filter-$selected'));
      if (target == null) return;
      Scrollable.ensureVisible(
        target,
        alignment: 0.5,
        duration: Duration.zero,
      );
    });
  }

  BuildContext? _mountedChipContext(Key key) {
    BuildContext? match;
    void visitor(Element element) {
      if (match != null) return;
      if (element.widget.key == key) {
        match = element;
        return;
      }
      element.visitChildren(visitor);
    }
    context.visitChildElements(visitor);
    return match;
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      key: const Key('source-filter-bar'),
      color: Theme.of(context).colorScheme.surface,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Row(
          children: [
            _chip(
              key: const Key('source-filter-all'),
              label: '全部',
              tooltip: '全部来源',
              selected: widget.selected == null,
              onSelected: () => widget.onSelected(null),
            ),
            Expanded(
              child: ScrollbarTheme(
                data: ScrollbarTheme.of(context).copyWith(
                  thumbColor: WidgetStatePropertyAll(
                    Theme.of(context).colorScheme.outline,
                  ),
                  radius: const Radius.circular(8),
                  thickness: const WidgetStatePropertyAll(8.0),
                  minThumbLength: 48,
                  crossAxisMargin: 2,
                  interactive: true,
                  trackVisibility: WidgetStateProperty.resolveWith((states) {
                    if (states.contains(WidgetState.hovered) ||
                        states.contains(WidgetState.dragged) ||
                        states.contains(WidgetState.focused)) {
                      return true;
                    }
                    return false;
                  }),
                ),
                child: Scrollbar(
                  key: const Key('source-filter-scrollbar'),
                  controller: _scrollController,
                  child: SingleChildScrollView(
                    key: const Key('source-filter-scroll'),
                    controller: _scrollController,
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (final name in widget.names)
                          _chip(
                            key: Key('source-filter-$name'),
                            label: name,
                            tooltip: '筛选此来源',
                            selected: widget.selected == name,
                            onSelected: () => widget.onSelected(name),
                            onCopySource: widget.onCopySource,
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _chip({
    required Key key,
    required String label,
    required String tooltip,
    required bool selected,
    required VoidCallback onSelected,
    ValueChanged<String>? onCopySource,
  }) {
    final scheme = Theme.of(context).colorScheme;
    // FilterChip has no overlayColor; RawChip InkWell reads Theme splash colors.
    final overlayColor = WidgetStateProperty.resolveWith((states) {
      if (states.contains(WidgetState.pressed)) {
        return scheme.primary.withValues(alpha: 0.12);
      } else if (states.contains(WidgetState.hovered) ||
          states.contains(WidgetState.focused)) {
        return scheme.primary.withValues(alpha: 0.08);
      } else {
        return null;
      }
    });
    final chip = Theme(
      data: Theme.of(context).copyWith(
        splashColor: overlayColor.resolve(const {WidgetState.pressed}),
        highlightColor: overlayColor.resolve(const {WidgetState.hovered}),
        hoverColor: overlayColor.resolve(const {WidgetState.hovered}),
        focusColor: overlayColor.resolve(const {WidgetState.focused}),
      ),
      child: FilterChip(
        key: key,
        label: Text(label),
        selected: selected,
        showCheckmark: false,
        visualDensity: VisualDensity.compact,
        materialTapTargetSize: MaterialTapTargetSize.padded,
        backgroundColor: scheme.secondaryContainer,
        selectedColor: scheme.primaryContainer,
        checkmarkColor: scheme.onPrimaryContainer,
        side: BorderSide.none,
        elevation: 0,
        pressElevation: 0,
        shadowColor: Colors.transparent,
        selectedShadowColor: Colors.transparent,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        labelStyle: TextStyle(
          fontSize: 12,
          color: selected ? scheme.onPrimaryContainer : scheme.primary,
        ),
        onSelected: (_) => onSelected(),
      ),
    );
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ConstrainedBox(
        constraints: const BoxConstraints(
          minWidth: kMinInteractiveDimension,
          minHeight: kMinInteractiveDimension,
        ),
        child: Align(
          alignment: Alignment.center,
          // Align loosens height; compact+padded alone is 40. Keep the keyed
          // FilterChip at least 48 so padding around the label still hits.
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minWidth: kMinInteractiveDimension,
              minHeight: kMinInteractiveDimension,
            ),
            child: Tooltip(
              message: tooltip,
              child: onCopySource == null
                  ? chip
                  : Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: onSelected,
                        onLongPress: () => onCopySource(label),
                        splashColor: scheme.primary.withValues(alpha: 0.12),
                        highlightColor: scheme.primary.withValues(alpha: 0.08),
                        hoverColor: scheme.primary.withValues(alpha: 0.08),
                        focusColor: scheme.primary.withValues(alpha: 0.08),
                        customBorder: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: IgnorePointer(child: chip),
                      ),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Fixed-extent pinned day title. [minExtent] == [maxExtent] == [_kDayHeaderExtent].
class _DayHeaderDelegate extends SliverPersistentHeaderDelegate {
  _DayHeaderDelegate({
    required this.group,
    required this.now,
    required this.unreadCount,
    required this.onTap,
    required this.onLongPress,
  }) : _friendlyTitle = friendlyDayLabel(group.label, now());

  final DayGroup group;
  final DateTime Function() now;
  final int unreadCount;
  final VoidCallback onTap;
  final VoidCallback onLongPress;

  /// [friendlyDayLabel] result at construction. [shouldRebuild] compares this
  /// string, not [now] identity — `DateTime.now` / `() => clock` stay the same
  /// function while Beijing 今天→昨天 still changes the picture.
  final String _friendlyTitle;

  @override
  double get minExtent => _kDayHeaderExtent;

  @override
  double get maxExtent => _kDayHeaderExtent;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final title = _friendlyTitle;
    Widget date = Text(
      title,
      style: Theme.of(context).textTheme.titleSmall?.copyWith(
            color: group.label == unknownDateLabel
                ? scheme.onSurfaceVariant
                : scheme.primary,
            fontWeight: FontWeight.w700,
          ),
    );
    if (title == '今天' || title == '昨天') {
      date = Tooltip(
        message: group.label,
        child: date,
      );
    }
    final unreadStyle = Theme.of(context).textTheme.titleSmall?.copyWith(
          color: scheme.onSurfaceVariant,
        );
    final header = Semantics(
      header: true,
      container: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          date,
          if (unreadCount > 0) ...[
            Text(' · ', style: unreadStyle),
            Tooltip(
              message: '未读',
              child: Text(
                '$unreadCount',
                key: Key('day-group-${group.label}-unread'),
                style: unreadStyle,
              ),
            ),
          ],
        ],
      ),
    );
    return Material(
      key: Key('day-group-${group.label}'),
      color: scheme.surface,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        onLongPress: onLongPress,
        splashColor: scheme.primary.withValues(alpha: 0.12),
        highlightColor: scheme.primary.withValues(alpha: 0.08),
        hoverColor: scheme.primary.withValues(alpha: 0.08),
        focusColor: scheme.primary.withValues(alpha: 0.08),
        customBorder: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        child: DecoratedBox(
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: scheme.outlineVariant, width: 1),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Align(
              alignment: Alignment.centerLeft,
              child: header,
            ),
          ),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _DayHeaderDelegate oldDelegate) {
    // Picture only. onTap / onLongPress are new closures every
    // [_dayGroupSlivers] and still fire. now identity is not compared
    // (`() => DateTime.now()` is new every frame). Compare the
    // friendlyDayLabel *result* captured with now().
    return oldDelegate.group.label != group.label ||
        oldDelegate.unreadCount != unreadCount ||
        oldDelegate._friendlyTitle != friendlyDayLabel(group.label, now());
  }
}

/// Card-list scroll view. Same [CustomScrollView] API; the viewport treats
/// laid-out slivers as onstage so `find.byKey` still sees later day groups
/// (the old [Column] kept every header and card in the finder tree).
class _TimelineScrollView extends CustomScrollView {
  const _TimelineScrollView({
    super.key,
    super.controller,
    super.physics,
    required super.slivers,
  }) : super(
          scrollCacheExtent: const ScrollCacheExtent.pixels(8000),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
        );

  @override
  Widget buildViewport(
    BuildContext context,
    ViewportOffset offset,
    AxisDirection axisDirection,
    List<Widget> slivers,
  ) {
    return _FinderFriendlyViewport(
      axisDirection: axisDirection,
      offset: offset,
      slivers: slivers,
    );
  }
}

class _FinderFriendlyViewport extends Viewport {
  _FinderFriendlyViewport({
    required super.axisDirection,
    required super.offset,
    required List<Widget> slivers,
  }) : super(
          slivers: slivers,
          scrollCacheExtent: const ScrollCacheExtent.pixels(8000),
        );

  @override
  MultiChildRenderObjectElement createElement() =>
      _FinderFriendlyViewportElement(this);
}

class _FinderFriendlyViewportElement extends MultiChildRenderObjectElement
    with NotifiableElementMixin, ViewportElementMixin {
  _FinderFriendlyViewportElement(_FinderFriendlyViewport super.widget);

  bool _doingMountOrUpdate = false;
  int? _centerSlotIndex;

  @override
  RenderViewport get renderObject => super.renderObject as RenderViewport;

  @override
  void mount(Element? parent, Object? newSlot) {
    _doingMountOrUpdate = true;
    super.mount(parent, newSlot);
    _updateCenter();
    _doingMountOrUpdate = false;
  }

  @override
  void update(MultiChildRenderObjectWidget newWidget) {
    _doingMountOrUpdate = true;
    super.update(newWidget);
    _updateCenter();
    _doingMountOrUpdate = false;
  }

  void _updateCenter() {
    if (children.isNotEmpty) {
      renderObject.center = children.first.renderObject as RenderSliver?;
      _centerSlotIndex = 0;
    } else {
      renderObject.center = null;
      _centerSlotIndex = null;
    }
  }

  @override
  void insertRenderObjectChild(RenderObject child, IndexedSlot<Element?> slot) {
    super.insertRenderObjectChild(child, slot);
    if (!_doingMountOrUpdate && slot.index == _centerSlotIndex) {
      renderObject.center = child as RenderSliver?;
    }
  }

  @override
  void removeRenderObjectChild(RenderObject child, Object? slot) {
    super.removeRenderObjectChild(child, slot);
    if (!_doingMountOrUpdate && renderObject.center == child) {
      renderObject.center = null;
    }
  }

  /// Laid-out slivers stay in `find.byKey` even when clipped, matching the
  /// pre-T140 [SingleChildScrollView] + [Column]. Pinning is unchanged.
  @override
  void debugVisitOnstageChildren(ElementVisitor visitor) {
    for (final element in children) {
      final sliver = element.renderObject;
      if (sliver is RenderSliver && sliver.geometry != null) {
        visitor(element);
      }
    }
  }
}
