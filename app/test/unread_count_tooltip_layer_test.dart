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
const _hitKey = Key('unread-count-hit');
const _scrollKey = Key('timeline-scroll');

void main() {
  testWidgets(
      'live fixture: unread-count tooltip only; no Semantics label; tap jumps',
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
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_countKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_countKey)).data, '未读 6');
    expect(find.byTooltip('第一条未读'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('第一条未读'),
        matching: find.byKey(_countKey),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byTooltip('第一条未读'),
        matching: find.byKey(_hitKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('第一条未读'), findsNothing);
    expect(_tooltipSemantics('第一条未读'), findsOne);

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    await tester.tap(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
    expect(tester.widget<Text>(find.byKey(_countKey)).data, '未读 6');
    expect(find.byTooltip('第一条未读'), findsOneWidget);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
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
