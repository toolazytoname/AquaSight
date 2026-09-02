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
const _normalCardKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets(
      'breaking and normal cards share radius 8 and elevation 0',
      (tester) async {
    await _pumpBoth(tester);

    final breaking = tester.widget<Card>(find.byKey(_breakingCardKey));
    expect(breaking.elevation, 0);
    expect(breaking.shape, isA<RoundedRectangleBorder>());
    expect(
      (breaking.shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );

    final normal = tester.widget<Card>(find.byKey(_normalCardKey));
    expect(normal.elevation, 0);
    expect(normal.shape, isA<RoundedRectangleBorder>());
    expect(
      (normal.shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
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
