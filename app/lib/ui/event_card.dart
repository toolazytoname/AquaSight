import 'package:flutter/material.dart';

import '../data/read_store.dart';
import '../models/event.dart';
import '../timeline/grouping.dart';

/// Opens a URI outside the app. Tests inject a recorder instead of launchUrl.
typedef OpenUrl = Future<void> Function(Uri uri);

/// Shares title + original URL via the system sheet. Tests inject a recorder.
/// [sharePositionOrigin] is the share button's screen rect (iPad popover anchor).
typedef ShareEvent = Future<void> Function({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
});

/// Copies [displayTitle] text. Tests inject a recorder instead of the clipboard.
typedef CopyText = Future<void> Function(String text);

/// Prefer [EventItem.url]; if empty, the first non-empty [SourceRef.url].
/// Accepts only `http` / `https` after [Uri.tryParse].
Uri? httpUrlToOpen(EventItem item) {
  final raw = _preferredRawUrl(item);
  if (raw == null) return null;
  final uri = Uri.tryParse(raw);
  if (uri == null) return null;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'http' && scheme != 'https') return null;
  return uri;
}

/// Case-insensitive, non-overlapping hits. Same match as timeline `_matchesTitle`.
List<InlineSpan> _highlightTitleSpans(
  String title,
  String query,
  Color highlight,
) {
  final lowerTitle = title.toLowerCase();
  final lowerQuery = query.toLowerCase();
  final spans = <InlineSpan>[];
  var start = 0;
  while (start < title.length) {
    final index = lowerTitle.indexOf(lowerQuery, start);
    if (index < 0) {
      spans.add(TextSpan(text: title.substring(start)));
      break;
    }
    if (index > start) {
      spans.add(TextSpan(text: title.substring(start, index)));
    }
    spans.add(
      TextSpan(
        text: title.substring(index, index + query.length),
        style: TextStyle(backgroundColor: highlight),
      ),
    );
    start = index + query.length;
  }
  return spans;
}

String? _preferredRawUrl(EventItem item) {
  final main = item.url.trim();
  if (main.isNotEmpty) return main;
  for (final source in item.sources) {
    final url = source.url?.trim() ?? '';
    if (url.isNotEmpty) return url;
  }
  return null;
}

class EventCard extends StatefulWidget {
  const EventCard({
    super.key,
    required this.item,
    required this.openUrl,
    required this.shareEvent,
    required this.copyText,
    required this.readStore,
    this.fileUpdatedAt,
    this.now = DateTime.now,
    this.onMarkedRead,
    this.onSourceChipTap,
    this.selectedSource,
    this.searchQuery = '',
  });

  final EventItem item;
  final OpenUrl openUrl;
  final ShareEvent shareEvent;
  final CopyText copyText;
  final ReadStore readStore;

  /// File-level `updatedAt` for [EventItem.resolvedTimestamp].
  final String? fileUpdatedAt;

  /// Injected clock. Tests pass a fixed UTC instant.
  final DateTime Function() now;

  /// Fired after [ReadStore.markRead] or a successful [ReadStore.markUnread]
  /// so a parent can refresh filters and the unread count on the same frame.
  final VoidCallback? onMarkedRead;

  /// When set, source chips apply this filter and consume the tap.
  /// When null, chips stay [IgnorePointer] so taps hit the card [InkWell].
  final ValueChanged<String>? onSourceChipTap;

  /// Current page source filter. Matching chip uses selected colors.
  final String? selectedSource;

  /// Title search text from the timeline field. Empty keeps a plain [Text].
  final String searchQuery;

  @override
  State<EventCard> createState() => _EventCardState();
}

class _EventCardState extends State<EventCard> {
  final GlobalKey _shareButtonKey = GlobalKey();

  Future<void> _openPrimary() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final uri = httpUrlToOpen(widget.item);
    if (uri == null) return;
    try {
      await widget.openUrl(uri);
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            key: Key('open-error-snackbar'),
            content: Text('无法打开'),
          ),
        );
      return;
    }
    await widget.readStore.markRead(widget.item.id);
    widget.onMarkedRead?.call();
    if (mounted) setState(() {});
  }

  Rect? _sharePositionOrigin() {
    final renderObject = _shareButtonKey.currentContext?.findRenderObject();
    if (renderObject is! RenderBox || !renderObject.hasSize || !renderObject.attached) {
      return null;
    }
    final topLeft = renderObject.localToGlobal(Offset.zero);
    return Rect.fromLTWH(
      topLeft.dx,
      topLeft.dy,
      renderObject.size.width,
      renderObject.size.height,
    );
  }

  Future<void> _markUnread() async {
    FocusManager.instance.primaryFocus?.unfocus();
    if (!widget.readStore.isRead(widget.item.id)) return;
    await widget.readStore.markUnread(widget.item.id);
    widget.onMarkedRead?.call();
    if (mounted) setState(() {});
  }

  Future<void> _share() async {
    FocusManager.instance.primaryFocus?.unfocus();
    final uri = httpUrlToOpen(widget.item);
    if (uri == null) return;
    final origin = _sharePositionOrigin();
    if (origin == null) return;
    try {
      await widget.shareEvent(
        title: widget.item.displayTitle,
        url: uri,
        sharePositionOrigin: origin,
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          const SnackBar(
            key: Key('share-error-snackbar'),
            content: Text('无法分享'),
          ),
        );
    }
  }

  Future<void> _copyTitle() => _copyText(widget.item.displayTitle);

  Future<void> _copyUrl() async {
    final uri = httpUrlToOpen(widget.item);
    if (uri == null) return;
    await _copyText(uri.toString());
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
          const SnackBar(
            key: Key('copy-error-snackbar'),
            content: Text('无法复制'),
          ),
        );
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          key: Key('copy-snackbar'),
          content: Text('已复制'),
        ),
      );
  }

  Widget _titleText(EventItem item, ColorScheme scheme) {
    final style = Theme.of(context).textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.w600,
          color: scheme.onSurface,
        );
    final key = Key('event-card-${item.id}-title');
    final query = widget.searchQuery.trim();
    if (query.isEmpty) {
      return Text(
        item.displayTitle,
        key: key,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: style,
      );
    }
    return Text.rich(
      TextSpan(
        children: _highlightTitleSpans(
          item.displayTitle,
          query,
          scheme.tertiaryContainer,
        ),
      ),
      key: key,
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: style,
    );
  }

  Widget _sourceChip(ColorScheme scheme, EventItem item, String name) {
    final selected = name == widget.selectedSource;
    final chip = Chip(
      label: Text(name),
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      backgroundColor:
          selected ? scheme.primaryContainer : scheme.secondaryContainer,
      side: BorderSide.none,
      labelStyle: TextStyle(
        fontSize: 12,
        color: selected ? scheme.onPrimaryContainer : scheme.primary,
      ),
    );
    final onTap = widget.onSourceChipTap;
    if (onTap == null) {
      return IgnorePointer(child: chip);
    }
    return GestureDetector(
      key: Key('event-card-${item.id}-source-$name'),
      behavior: HitTestBehavior.opaque,
      onTap: () => onTap(name),
      child: chip,
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final scheme = Theme.of(context).colorScheme;
    final score = item.scoreLabel;
    final isRead = widget.readStore.isRead(item.id);
    final stamp = parseAsUtc(item.resolvedTimestamp(widget.fileUpdatedAt));
    final timeLabel = relativeTimeLabel(stamp, widget.now());
    final timeStyle = Theme.of(context).textTheme.bodySmall?.copyWith(
          color: scheme.onSurfaceVariant,
        );
    final timeText = Text(
      timeLabel,
      key: Key('event-card-${item.id}-time'),
      style: timeStyle,
    );
    final Widget timeField;
    if (stamp == null) {
      timeField = timeText;
    } else {
      timeField = Tooltip(
        message: beijingClockLabel(stamp),
        child: timeText,
      );
    }
    final uri = httpUrlToOpen(item);
    final Widget timeRow;
    if (uri == null) {
      timeRow = timeField;
    } else {
      timeRow = Row(
        children: [
          timeField,
          Text(' · ', style: timeStyle),
          Flexible(
            child: Tooltip(
              message: uri.toString(),
              child: GestureDetector(
                onTap: _openPrimary,
                onLongPress: _copyUrl,
                child: Text(
                  uri.host,
                  key: Key('event-card-${item.id}-host'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: timeStyle,
                ),
              ),
            ),
          ),
        ],
      );
    }
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: _openPrimary,
        child: Card(
          key: Key('event-card-${item.id}'),
          color: item.isBreaking ? scheme.errorContainer : scheme.surfaceContainerLow,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(
              color: item.isBreaking ? scheme.error : scheme.outlineVariant,
            ),
          ),
          margin: const EdgeInsets.symmetric(vertical: 2),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (!isRead)
                      Semantics(
                        container: true,
                        label: '未读',
                        child: Padding(
                          padding: const EdgeInsets.only(right: 8, top: 6),
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: scheme.primary,
                              shape: BoxShape.circle,
                            ),
                            child: SizedBox(
                              width: 8,
                              height: 8,
                              key: Key('event-card-${item.id}-unread-dot'),
                            ),
                          ),
                        ),
                      ),
                    if (item.isBreaking)
                      Padding(
                        padding: const EdgeInsets.only(right: 6, top: 6),
                        child: Text(
                          '突发',
                          key: Key('event-card-${item.id}-breaking'),
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                color: scheme.error,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ),
                    Expanded(
                      child: Tooltip(
                        message: '复制',
                        child: GestureDetector(
                          onTap: _openPrimary,
                          onLongPress: _copyTitle,
                          child: _titleText(item, scheme),
                        ),
                      ),
                    ),
                    if (isRead)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: SizedBox(
                          width: kMinInteractiveDimension,
                          height: kMinInteractiveDimension,
                          child: Tooltip(
                            message: '标为未读',
                            child: GestureDetector(
                              key: Key('event-card-${item.id}-mark-unread'),
                              behavior: HitTestBehavior.opaque,
                              onTap: _markUnread,
                              child: Center(
                                child: Text(
                                  '已读',
                                  key: Key('event-card-${item.id}-read'),
                                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                                        color: scheme.onSurfaceVariant,
                                      ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                timeRow,
                if (item.sourceChips.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      for (final name in item.sourceChips)
                        _sourceChip(scheme, item, name),
                    ],
                  ),
                ],
                if (score != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    '分数 $score',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                ],
                if (item.reason.trim().isNotEmpty) ...[
                  const SizedBox(height: 4),
                  GestureDetector(
                    onTap: _openPrimary,
                    child: Tooltip(
                      message: item.reason,
                      child: Text(
                        item.reason,
                        key: Key('event-card-${item.id}-reason'),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        semanticsLabel: '',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                      ),
                    ),
                  ),
                ],
                if (uri != null)
                  Align(
                    alignment: Alignment.centerRight,
                    child: KeyedSubtree(
                      key: Key('event-card-${item.id}-share'),
                      child: IconButton(
                        key: _shareButtonKey,
                        tooltip: '分享',
                        icon: const Icon(Icons.share),
                        visualDensity: VisualDensity.compact,
                        onPressed: _share,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
