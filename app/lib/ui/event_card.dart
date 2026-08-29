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

  @override
  State<EventCard> createState() => _EventCardState();
}

class _EventCardState extends State<EventCard> {
  final GlobalKey _shareButtonKey = GlobalKey();

  Future<void> _openPrimary() async {
    final uri = httpUrlToOpen(widget.item);
    if (uri == null) return;
    try {
      await widget.openUrl(uri);
    } catch (_) {
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
    if (!widget.readStore.isRead(widget.item.id)) return;
    await widget.readStore.markUnread(widget.item.id);
    widget.onMarkedRead?.call();
    if (mounted) setState(() {});
  }

  Future<void> _share() async {
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
    } catch (_) {}
  }

  Future<void> _copyTitle() async {
    try {
      await widget.copyText(widget.item.displayTitle);
    } catch (_) {
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

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final scheme = Theme.of(context).colorScheme;
    final score = item.scoreLabel;
    final isRead = widget.readStore.isRead(item.id);
    final stamp = parseAsUtc(item.resolvedTimestamp(widget.fileUpdatedAt));
    final timeLabel = relativeTimeLabel(stamp, widget.now());
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
                    Expanded(
                      child: GestureDetector(
                        onTap: _openPrimary,
                        onLongPress: _copyTitle,
                        child: Text(
                          item.displayTitle,
                          key: Key('event-card-${item.id}-title'),
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(
                                fontWeight: FontWeight.w600,
                                color: scheme.onSurface,
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
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  timeLabel,
                  key: Key('event-card-${item.id}-time'),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                ),
                if (item.sourceChips.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  Wrap(
                    spacing: 6,
                    runSpacing: 4,
                    children: [
                      for (final name in item.sourceChips)
                        IgnorePointer(
                          child: Chip(
                            label: Text(name),
                            visualDensity: VisualDensity.compact,
                            materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                            backgroundColor: scheme.secondaryContainer,
                            side: BorderSide.none,
                            labelStyle: TextStyle(
                              fontSize: 12,
                              color: scheme.primary,
                            ),
                          ),
                        ),
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
                  Text(
                    item.reason,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: scheme.onSurfaceVariant,
                        ),
                  ),
                ],
                if (httpUrlToOpen(item) != null)
                  Align(
                    alignment: Alignment.centerRight,
                    child: KeyedSubtree(
                      key: Key('event-card-${item.id}-share'),
                      child: IconButton(
                        key: _shareButtonKey,
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
