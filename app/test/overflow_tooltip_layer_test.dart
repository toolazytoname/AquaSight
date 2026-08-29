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
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');

void main() {
  testWidgets(
      'live fixture: overflow tooltip only; no Semantics label; tap marks all',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => loadFixtureBytes(),
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_countKey)).data, '未读 6');
    expect(find.byTooltip('全标已读'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_overflowKey),
        matching: find.byTooltip('全标已读'),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('全标已读'), findsNothing);
    expect(_tooltipSemantics('全标已读'), findsOne);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_markAllKey), findsOneWidget);

    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(tester.widget<Text>(find.byKey(_countKey)).data, '回顶');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byTooltip('全标已读'), findsNothing);
    expect(find.bySemanticsLabel('全标已读'), findsNothing);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
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
