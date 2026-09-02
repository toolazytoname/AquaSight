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
      'timeline-empty-refresh FilledButton overlay uses theme primary splash 0.12 / 0.08',
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

    _expectFilledOverlaySplash(tester, _refreshKey);
  });

  testWidgets(
      'timeline-error-retry FilledButton overlay uses theme primary splash 0.12 / 0.08',
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

    _expectFilledOverlaySplash(tester, _errorRetryKey);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void _expectFilledOverlaySplash(WidgetTester tester, Key key) {
  final finder = find.byKey(key);
  expect(finder, findsOneWidget);
  expect(tester.widget(finder), isA<FilledButton>());

  final button = tester.widget<FilledButton>(finder);
  final scheme = Theme.of(tester.element(finder)).colorScheme;
  final overlayColor = button.style?.overlayColor;
  expect(overlayColor, isNotNull);
  expect(
    overlayColor!.resolve(const {WidgetState.pressed}),
    scheme.primary.withValues(alpha: 0.12),
  );
  expect(
    overlayColor.resolve(const {WidgetState.hovered}),
    scheme.primary.withValues(alpha: 0.08),
  );
  expect(
    overlayColor.resolve(const {WidgetState.focused}),
    scheme.primary.withValues(alpha: 0.08),
  );
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
