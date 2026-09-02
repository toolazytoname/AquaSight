import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingBadgeKey = Key('event-card-same-day-breaking-breaking');

void main() {
  testWidgets(
      'breaking badge DecoratedBox uses radius 8 and errorContainer',
      (tester) async {
    await _pumpBreaking(tester);

    final badgeFinder = find.byKey(_breakingBadgeKey);
    expect(tester.widget(badgeFinder), isA<Text>());

    final decoratedBox = tester.widget<DecoratedBox>(
      find
          .ancestor(
            of: badgeFinder,
            matching: find.byType(DecoratedBox),
          )
          .first,
    );
    expect(decoratedBox.decoration, isA<BoxDecoration>());
    final decoration = decoratedBox.decoration as BoxDecoration;
    final scheme = Theme.of(tester.element(badgeFinder)).colorScheme;
    expect(decoration.borderRadius, BorderRadius.circular(8));
    expect(decoration.color, scheme.errorContainer);
    expect(find.byTooltip('突发'), findsOneWidget);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpBreaking(WidgetTester tester) async {
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
