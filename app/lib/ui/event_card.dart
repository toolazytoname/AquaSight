import 'package:flutter/material.dart';

import '../models/event.dart';

/// Opens a URI outside the app. Tests inject a recorder instead of launchUrl.
typedef OpenUrl = Future<void> Function(Uri uri);

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

class EventCard extends StatelessWidget {
  const EventCard({super.key, required this.item, required this.openUrl});

  final EventItem item;
  final OpenUrl openUrl;

  Future<void> _openPrimary() async {
    final uri = httpUrlToOpen(item);
    if (uri == null) return;
    await openUrl(uri);
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final score = item.scoreLabel;
    return Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: _openPrimary,
        child: Card(
          key: Key('event-card-${item.id}'),
          color: item.isBreaking ? const Color(0xFFFFF1EE) : const Color(0xFFFFFDF8),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(10),
            side: BorderSide(
              color: item.isBreaking ? const Color(0xFFB42318) : const Color(0xFFD7CFC0),
            ),
          ),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  item.displayTitle,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: const Color(0xFF14201C),
                      ),
                ),
                if (item.sourceChips.isNotEmpty) ...[
                  const SizedBox(height: 8),
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
                            backgroundColor: const Color(0xFFE8F0EC),
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
                  const SizedBox(height: 8),
                  Text(
                    '分数 $score',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: const Color(0xFF5B6B64),
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
                          color: const Color(0xFF5B6B64),
                        ),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
