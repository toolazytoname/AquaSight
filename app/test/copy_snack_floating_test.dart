import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _hitKey = Key('last-refresh-hit');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';
const _laterStamp = '2026-08-26T02:00:00.000Z';

void main() {
  testWidgets(
      'long-press event-card-same-day-breaking-time shows floating 已复制 for 2 seconds',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(
      tester,
      copyText: (_) async {},
    );

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    final snack = tester.widget<SnackBar>(find.byKey(_copySnackKey));
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.duration, const Duration(seconds: 2));
  });

  testWidgets(
      'long-press last-refresh-hit shows floating 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpLastRefresh(
      tester,
      copyText: (_) async {},
    );

    await tester.longPress(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(
      tester.widget<SnackBar>(find.byKey(_copySnackKey)).behavior,
      SnackBarBehavior.floating,
    );
  });

  testWidgets(
      'copyText throw via the card path shows floating 无法复制',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(
      tester,
      copyText: (_) async => throw StateError('copy failed'),
    );

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(
      tester.widget<SnackBar>(find.byKey(_copyErrorSnackKey)).behavior,
      SnackBarBehavior.floating,
    );
  });

  testWidgets(
      'pull-to-refresh feed-updated-snackbar is not floating',
      (tester) async {
    _setDefaultSurface(tester);
    var stamp = _tenMinutesAgo;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => _fixtureWithUpdatedAt(stamp),
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: (_) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => _fixedNow,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    stamp = _laterStamp;
    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;

    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    final behavior =
        tester.widget<SnackBar>(find.byKey(_feedUpdatedSnackKey)).behavior;
    expect(
      behavior == null || behavior == SnackBarBehavior.fixed,
      isTrue,
    );
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpDefault(
  WidgetTester tester, {
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpLastRefresh(
  WidgetTester tester, {
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
        loadCache: () async => throw StateError('must not read cache'),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _fixedNow,
    ),
  );
  await tester.pumpAndSettle();
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
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
