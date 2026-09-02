import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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

/// Time-row host text. Strips one leading `www.` when more host remains.
String displayHost(Uri uri) {
  final host = uri.host;
  if (host.startsWith('www.') && host.length > 4) {
    return host.substring(4);
  }
  return host;
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
          SnackBar(
            key: const Key('open-error-snackbar'),
            content: const Text('无法打开'),
            showCloseIcon: true,
            action: SnackBarAction(
              key: const Key('open-error-copy'),
              label: '复制',
              onPressed: _copyUrl,
            ),
          ),
        );
      return;
    }
    HapticFeedback.selectionClick();
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
    HapticFeedback.selectionClick();
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
      HapticFeedback.selectionClick();
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            key: const Key('share-error-snackbar'),
            content: const Text('无法分享'),
            showCloseIcon: true,
            action: SnackBarAction(
              key: const Key('share-error-copy'),
              label: '复制',
              onPressed: _copyUrl,
            ),
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

  Widget _titleText(EventItem item, ColorScheme scheme) {
    final style = Theme.of(context).textTheme.titleMedium?.copyWith(
          fontWeight: FontWeight.w600,
          color: widget.readStore.isRead(item.id)
              ? scheme.onSurfaceVariant
              : scheme.onSurface,
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
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      labelStyle: TextStyle(
        fontSize: 12,
        color: selected ? scheme.onPrimaryContainer : scheme.primary,
      ),
    );
    final onTap = widget.onSourceChipTap;
    if (onTap == null) {
      return IgnorePointer(child: chip);
    }
    return Material(
      color: Colors.transparent,
      child: Tooltip(
        message: '筛选此来源',
        child: InkWell(
          key: Key('event-card-${item.id}-source-$name'),
          onTap: () => onTap(name),
          onLongPress: () => _copyText(name),
          splashColor: scheme.primary.withValues(alpha: 0.12),
          highlightColor: scheme.primary.withValues(alpha: 0.08),
          customBorder: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          child: ConstrainedBox(
            constraints: const BoxConstraints(
              minWidth: kMinInteractiveDimension,
              minHeight: kMinInteractiveDimension,
            ),
            child: Align(
              alignment: Alignment.center,
              widthFactor: 1,
              heightFactor: 1,
              child: chip,
            ),
          ),
        ),
      ),
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
        child: GestureDetector(
          onLongPress: () => _copyText(beijingClockLabel(stamp)),
          child: timeText,
        ),
      );
    }
    final uri = httpUrlToOpen(item);
    final Widget timeRow;
    if (uri == null && score == null) {
      timeRow = timeField;
    } else {
      timeRow = Row(
        children: [
          timeField,
          if (uri != null) ...[
            Text(' · ', style: timeStyle),
            Flexible(
              child: Material(
                color: Colors.transparent,
                child: Tooltip(
                  message: uri.toString(),
                  child: InkWell(
                    onLongPress: _copyUrl,
                    // InkWell with onLongPress also claims tap; forward short-press
                    // so the card still opens. Do not set onTap — radius test asserts null.
                    onTapUp: (_) => _openPrimary(),
                    splashColor: scheme.primary.withValues(alpha: 0.12),
                    highlightColor: scheme.primary.withValues(alpha: 0.08),
                    customBorder: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      displayHost(uri),
                      key: Key('event-card-${item.id}-host'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: timeStyle,
                    ),
                  ),
                ),
              ),
            ),
          ],
          if (score != null) ...[
            Text(' · ', style: timeStyle),
            Tooltip(
              message: '分数',
              child: GestureDetector(
                onLongPress: () => _copyText(score),
                child: Text(
                  score,
                  key: Key('event-card-${item.id}-score'),
                  style: timeStyle,
                ),
              ),
            ),
          ],
        ],
      );
    }
    return Card(
      key: Key('event-card-${item.id}'),
      elevation: 0,
      surfaceTintColor: Colors.transparent,
      shadowColor: Colors.transparent,
      color: item.isBreaking ? scheme.errorContainer : scheme.surfaceContainerLow,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(
          color: item.isBreaking ? scheme.error : scheme.outlineVariant,
        ),
      ),
      margin: const EdgeInsets.symmetric(vertical: 4),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: _openPrimary,
        splashColor: scheme.primary.withValues(alpha: 0.12),
        highlightColor: scheme.primary.withValues(alpha: 0.08),
        customBorder: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
        ),
        child: Padding(
          padding: const EdgeInsets.fromLTRB(12, 10, 12, 10),
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
                          child: Tooltip(
                            message: '未读',
                            excludeFromSemantics: true,
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
                      ),
                    if (item.isBreaking)
                      Padding(
                        padding: const EdgeInsets.only(right: 6, top: 6),
                        child: Tooltip(
                          message: '突发',
                          child: DecoratedBox(
                            decoration: BoxDecoration(
                              color: scheme.errorContainer,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 6,
                                vertical: 2,
                              ),
                              child: Text(
                                '突发',
                                key: Key('event-card-${item.id}-breaking'),
                                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                      color: scheme.error,
                                      fontWeight: FontWeight.w700,
                                    ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    Expanded(
                      child: Material(
                        color: Colors.transparent,
                        child: Tooltip(
                          message: '复制',
                          child: InkWell(
                            onLongPress: _copyTitle,
                            // InkWell with onLongPress also claims tap; forward short-press
                            // so the card still opens. Do not set onTap — radius test asserts null.
                            onTapUp: (_) => _openPrimary(),
                            splashColor: scheme.primary.withValues(alpha: 0.12),
                            highlightColor: scheme.primary.withValues(alpha: 0.08),
                            customBorder: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: _titleText(item, scheme),
                          ),
                        ),
                      ),
                    ),
                    if (isRead)
                      Padding(
                        padding: const EdgeInsets.only(left: 8),
                        child: SizedBox(
                          width: kMinInteractiveDimension,
                          height: kMinInteractiveDimension,
                          child: Material(
                            color: Colors.transparent,
                            child: Tooltip(
                              message: '标为未读',
                              child: InkWell(
                                key: Key('event-card-${item.id}-mark-unread'),
                                onTap: _markUnread,
                                splashColor: scheme.primary.withValues(alpha: 0.12),
                                highlightColor: scheme.primary.withValues(alpha: 0.08),
                                customBorder: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(8),
                                ),
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
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                timeRow,
                if (item.sourceChips.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      for (final name in item.sourceChips)
                        _sourceChip(scheme, item, name),
                    ],
                  ),
                ],
                if (item.reason.trim().isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Material(
                    color: Colors.transparent,
                    child: Tooltip(
                      message: item.reason,
                      child: InkWell(
                        onLongPress: () => _copyText(item.reason),
                        // InkWell with onLongPress also claims tap; forward
                        // the short-press so the card still opens. Do not set
                        // onTap — radius test asserts it stays null.
                        onTapUp: (_) => _openPrimary(),
                        splashColor: scheme.primary.withValues(alpha: 0.12),
                        highlightColor: scheme.primary.withValues(alpha: 0.08),
                        customBorder: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          item.reason,
                          key: Key('event-card-${item.id}-reason'),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          semanticsLabel: '',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: scheme.onSurfaceVariant,
                              ),
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
                      child: SizedBox(
                        width: kMinInteractiveDimension,
                        height: kMinInteractiveDimension,
                        child: IconButton(
                          key: _shareButtonKey,
                          tooltip: '分享',
                          icon: const Icon(Icons.share),
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                          padding: EdgeInsets.zero,
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
                          ),
                          onPressed: _share,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
    );
  }
}
