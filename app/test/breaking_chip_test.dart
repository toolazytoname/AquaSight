import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingBadgeKey = Key('event-card-same-day-breaking-breaking');
const _normalBadgeKey = Key('event-card-same-day-normal-high-score-breaking');

void main() {
  testWidgets(
      'breaking badge sits in an errorContainer rounded chip',
      (tester) async {
    await _pumpSingle(tester, id: 'same-day-breaking');

    final badgeFinder = find.byKey(_breakingBadgeKey);
    expect(badgeFinder, findsOneWidget);

    final scheme = Theme.of(tester.element(badgeFinder)).colorScheme;
    final decoratedBox = tester.widget<DecoratedBox>(
      find.ancestor(
        of: badgeFinder,
        matching: find.byType(DecoratedBox),
      ).first,
    );
    final decoration = decoratedBox.decoration as BoxDecoration;
    expect(decoration.color, scheme.errorContainer);
    expect(decoration.borderRadius, BorderRadius.circular(8));

    final badge = tester.widget<Text>(badgeFinder);
    expect(badge.data, '突发');
    expect(badge.style?.color, scheme.error);
    expect(badge.style?.fontWeight, FontWeight.w700);
  });

  testWidgets('single normal card has no 突发 chip', (tester) async {
    await _pumpSingle(tester, id: 'same-day-normal-high-score');

    expect(find.byKey(_normalBadgeKey), findsNothing);
    expect(find.text('突发'), findsNothing);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpSingle(
  WidgetTester tester, {
  required String id,
}) async {
  _setDefaultSurface(tester);
  final raw = loadFixtureJson();
  raw['items'] = [
    (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
          (item) => item['id'] == id,
        ),
  ];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: _forbidCopy,
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
