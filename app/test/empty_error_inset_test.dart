import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _emptyKey = Key('timeline-empty');
const _emptyRefreshKey = Key('timeline-empty-refresh');
const _errorKey = Key('timeline-error');
const _errorRetryKey = Key('timeline-error-retry');

void main() {
  testWidgets(
      'empty page: home-indicator padding sits under timeline-empty',
      (tester) async {
    _phoneWindow(tester, bottom: 48);

    await _pumpEmpty(tester);

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(_emptyInset(tester).bottom, 48);
    expect(find.byKey(_emptyRefreshKey), findsOneWidget);
  });

  testWidgets(
      'error page: existing 24 padding plus home-indicator inset',
      (tester) async {
    _phoneWindow(tester, bottom: 48);

    await _pumpError(tester);

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_errorInset(tester).bottom, 72);
    expect(find.byKey(_errorRetryKey), findsOneWidget);
  });

  testWidgets(
      'default window padding: empty inset is 0; error padding stays 24',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpEmpty(tester);
    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(_emptyInset(tester).bottom, 0);
    expect(find.byKey(_emptyRefreshKey), findsOneWidget);

    await _pumpError(tester);
    expect(find.byKey(_errorKey), findsOneWidget);
    expect(_errorInset(tester).bottom, 24);
    expect(find.byKey(_errorRetryKey), findsOneWidget);
  });
}

void _phoneWindow(WidgetTester tester, {required double bottom}) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  tester.view.padding = FakeViewPadding(bottom: bottom);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPadding);
}

EdgeInsets _emptyInset(WidgetTester tester) {
  final inset = tester.widget<Padding>(
    find.descendant(
      of: find.byKey(_emptyKey),
      matching: find.byWidgetPredicate(
        (w) => w is Padding && (w as Padding).child is Column,
      ),
    ),
  );
  return inset.padding.resolve(TextDirection.ltr);
}

EdgeInsets _errorInset(WidgetTester tester) {
  final inset = tester.widget<Padding>(
    find.descendant(
      of: find.byKey(_errorKey),
      matching: find.byWidgetPredicate(
        (w) => w is Padding && (w as Padding).child is Column,
      ),
    ),
  );
  return inset.padding.resolve(TextDirection.ltr);
}

Future<void> _pumpEmpty(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(_emptyFixture()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpError(WidgetTester tester) async {
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
