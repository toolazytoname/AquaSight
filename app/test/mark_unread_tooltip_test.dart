import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _breakingMarkUnreadKey = Key('event-card-same-day-breaking-mark-unread');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets(
      'pre-seeded 破圈 已读 has 标为未读 tooltip; tap unmarks; no open/share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory({'same-day-breaking'});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingMarkUnreadKey), findsOneWidget);
    expect(find.text('已读'), findsOneWidget);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(find.byTooltip('标为未读'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('标为未读'),
        matching: find.byKey(_breakingMarkUnreadKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('标为未读'), findsNothing);
    expect(_tooltipSemantics('标为未读'), findsOne);
    final markUnreadSize = tester.getSize(find.byKey(_breakingMarkUnreadKey));
    expect(markUnreadSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(markUnreadSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(_countText(tester), '未读 5');
    expect(find.byTooltip('回到顶部'), findsOneWidget);

    for (final id in _allFixtureIds) {
      if (id == 'same-day-breaking') continue;
      expect(find.byKey(Key('event-card-$id-mark-unread')), findsNothing);
      expect(find.byKey(Key('event-card-$id-read')), findsNothing);
    }

    await tester.tap(find.byTooltip('标为未读'));
    await tester.pumpAndSettle();

    expect(find.byTooltip('标为未读'), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_breakingMarkUnreadKey), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-breaking-unread-dot')), findsOneWidget);
    expect(_countText(tester), '未读 6');
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
  });

  testWidgets('unread cards have no 标为未读 tooltip and no mark-unread',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip('标为未读'), findsNothing);
    expect(find.text('已读'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id-mark-unread')), findsNothing);
      expect(find.byKey(Key('event-card-$id-read')), findsNothing);
    }
    expect(find.byTooltip('回到顶部'), findsOneWidget);
    expect(_countText(tester), '未读 6');
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
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
