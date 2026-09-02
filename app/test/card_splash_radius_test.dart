import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingCardKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'event-card-same-day-breaking Card.child InkWell customBorder is radius 8; splash tokens stay',
      (tester) async {
    await _pumpBoth(tester);

    final card = tester.widget<Card>(find.byKey(_breakingCardKey));
    expect(card.child, isA<InkWell>());
    final inkWell = card.child! as InkWell;
    final scheme =
        Theme.of(tester.element(find.byKey(_breakingCardKey))).colorScheme;

    expect(inkWell.customBorder, isA<RoundedRectangleBorder>());
    expect(
      (inkWell.customBorder! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpBoth(WidgetTester tester) async {
  _setDefaultSurface(tester);
  final raw = loadFixtureJson();
  raw['items'] = [
    for (final id in [
      'same-day-breaking',
      'same-day-normal-high-score',
    ])
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
