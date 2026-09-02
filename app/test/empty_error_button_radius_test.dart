import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _refreshKey = Key('timeline-empty-refresh');
const _errorRetryKey = Key('timeline-error-retry');
const _updatedA = '2026-08-26T01:00:00.000Z';

void main() {
  testWidgets(
      'timeline-empty-refresh FilledButton uses radius 8 and 48×48 min',
      (tester) async {
    _setDefaultSurface(tester);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(_emptyFixture(_updatedA)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    _expectFilledRadius8(tester, _refreshKey);
  });

  testWidgets(
      'timeline-error-retry FilledButton uses radius 8 and 48×48 min',
      (tester) async {
    _setDefaultSurface(tester);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    _expectFilledRadius8(tester, _errorRetryKey);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void _expectFilledRadius8(WidgetTester tester, Key key) {
  expect(find.byKey(key), findsOneWidget);
  expect(tester.widget(find.byKey(key)), isA<FilledButton>());

  final button = tester.widget<FilledButton>(find.byKey(key));
  final shape = button.style!.shape!.resolve({});
  expect(shape, isA<RoundedRectangleBorder>());
  expect(
    (shape! as RoundedRectangleBorder).borderRadius,
    BorderRadius.circular(8),
  );

  final minimumSize = button.style!.minimumSize!.resolve({});
  expect(minimumSize!.width, greaterThanOrEqualTo(48));
  expect(minimumSize.height, greaterThanOrEqualTo(48));
}

String _emptyFixture(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
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
