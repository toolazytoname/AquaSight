import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

void main() {
  testWidgets(
      'live fixture: unread-only tooltip only; no Semantics label; tap filters',
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
        readStore: ReadStore.memory({'same-day-breaking', 'unknown-date'}),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_toggleKey), findsOneWidget);
    expect(_toggle(tester).value, isFalse);
    expect(find.byTooltip('只看未读'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip('只看未读'),
        matching: find.byKey(_toggleKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('只看未读'), findsNothing);
    expect(_tooltipSemantics('只看未读'), findsOne);

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_breakingReadKey), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('同日破圈'), findsNothing);
    expect(find.byKey(const Key('event-card-unknown-date')), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
    expect(find.byKey(const Key('event-card-seen-only')), findsOneWidget);
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsOneWidget);
  });
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
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
