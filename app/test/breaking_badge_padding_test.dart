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
      'breaking badge Text is wrapped by inner Padding 6/2; outer stays 6/6',
      (tester) async {
    await _pumpBreaking(tester);

    final badgeFinder = find.byKey(_breakingBadgeKey);
    expect(tester.widget(badgeFinder), isA<Text>());

    final parent = tester.widget<Padding>(
      find
          .ancestor(
            of: badgeFinder,
            matching: find.byType(Padding),
          )
          .first,
    );
    expect(
      parent.padding,
      const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
    );

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

    final paddings = tester
        .widgetList<Padding>(
          find.ancestor(
            of: badgeFinder,
            matching: find.byType(Padding),
          ),
        )
        .toList();
    expect(
      paddings.any(
        (padding) => padding.padding == const EdgeInsets.only(right: 6, top: 6),
      ),
      isTrue,
    );
    expect(
      paddings.first.padding,
      isNot(const EdgeInsets.only(right: 6, top: 6)),
    );
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
