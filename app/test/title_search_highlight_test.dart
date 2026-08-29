import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _searchKey = Key('timeline-search');
const _copySnackKey = Key('copy-snackbar');
const _fullDisplayTitle = '同日破圈';

void main() {
  testWidgets(
      'after first load, breaking title is still a plain Text with maxLines 2',
      (tester) async {
    await _pumpFixture(tester, copyText: (_) async {});

    final title = tester.widget<Text>(find.byKey(_breakingTitleKey));
    expect(title.data, _fullDisplayTitle);
    expect(title.textSpan, isNull);
    expect(title.maxLines, 2);
  });

  testWidgets(
      'search 破圈 highlights matching title fragments with tertiaryContainer',
      (tester) async {
    await _pumpFixture(tester, copyText: (_) async {});

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();

    final title = tester.widget<Text>(find.byKey(_breakingTitleKey));
    expect(title.maxLines, 2);
    expect(title.textSpan, isNotNull);

    final scheme =
        Theme.of(tester.element(find.byKey(_breakingTitleKey))).colorScheme;
    expect(
      _highlightSpans(title.textSpan, scheme.tertiaryContainer)
          .any((span) => (span.text ?? '').toLowerCase() == '破圈'),
      isTrue,
    );
  });

  testWidgets(
      'long-press highlighted title copies full displayTitle and shows 已复制',
      (tester) async {
    final copied = <String>[];
    await _pumpFixture(tester, copyText: (text) async => copied.add(text));

    await tester.enterText(find.byKey(_searchKey), '破圈');
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(copied, [_fullDisplayTitle]);
    expect(copied.single.contains('…'), isFalse);
    expect(copied.single.contains('...'), isFalse);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });
}

Iterable<TextSpan> _highlightSpans(InlineSpan? root, Color highlight) sync* {
  if (root is! TextSpan) return;
  final color = root.style?.backgroundColor;
  if (color == highlight && root.text != null) {
    yield root;
  }
  final children = root.children;
  if (children == null) return;
  for (final child in children) {
    yield* _highlightSpans(child, highlight);
  }
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required Future<void> Function(String) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
