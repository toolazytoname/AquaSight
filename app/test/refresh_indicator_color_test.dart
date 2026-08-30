import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _emptyKey = Key('timeline-empty');

void main() {
  testWidgets(
      'default fixture list RefreshIndicator uses ColorScheme colors',
      (tester) async {
    await tester.pumpWidget(
      _app(EventsRepository.fromJsonString(loadFixtureBytes())),
    );
    await tester.pumpAndSettle();

    expect(find.byType(RefreshIndicator), findsOneWidget);
    _expectRefreshIndicatorColors(tester);
  });

  testWidgets(
      'true-empty fill path RefreshIndicator uses ColorScheme colors',
      (tester) async {
    await tester.pumpWidget(
      _app(EventsRepository.fromJsonString(_emptyFixture())),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byType(RefreshIndicator), findsOneWidget);
    _expectRefreshIndicatorColors(tester);
  });
}

void _expectRefreshIndicatorColors(WidgetTester tester) {
  final indicatorFinder = find.byType(RefreshIndicator);
  final indicator = tester.widget<RefreshIndicator>(indicatorFinder);
  final scheme = Theme.of(tester.element(indicatorFinder)).colorScheme;
  expect(indicator.color, scheme.primary);
  expect(indicator.backgroundColor, scheme.surfaceContainerHighest);
}

Widget _app(EventsRepository repository) {
  return AquaApp(
    repository: repository,
    openUrl: _forbidLaunch,
    shareEvent: _forbidShare,
    readStore: ReadStore.memory(),
    unreadOnlyStore: UnreadOnlyStore.memory(),
    scrollOffsetStore: ScrollOffsetStore.memory(),
    sourceFilterStore: SourceFilterStore.memory(),
  );
}

String _emptyFixture() {
  final raw = loadFixtureJson();
  raw['items'] = [];
  return jsonEncode(raw);
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
