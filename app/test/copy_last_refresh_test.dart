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

const _hitKey = Key('last-refresh-hit');
const _refreshKey = Key('last-refresh');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _beijingClock = '2026-08-26 09:50';
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';

void main() {
  testWidgets(
      'long-press last-refresh-hit copies beijingClockLabel and shows 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pump(
      tester,
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(copied, [_beijingClock]);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('short-press last-refresh-hit retries live and does not copy',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    var loads = 0;
    await _pump(
      tester,
      copyText: (text) async => copied.add(text),
      onLoadLive: () => loads++,
    );

    expect(loads, 1);

    await tester.tap(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('last-refresh tooltip stays clock · 点按刷新', (tester) async {
    _setDefaultSurface(tester);
    await _pump(
      tester,
      copyText: (_) async {},
    );

    expect(
      find.descendant(
        of: find.byTooltip('$_beijingClock · 点按刷新'),
        matching: find.byKey(_refreshKey),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
      'copyText throw on last-refresh long-press shows 无法复制',
      (tester) async {
    _setDefaultSurface(tester);
    await _pump(
      tester,
      copyText: (text) async => throw StateError('copy failed'),
    );

    await tester.longPress(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pump(
  WidgetTester tester, {
  required Future<void> Function(String text) copyText,
  void Function()? onLoadLive,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async {
          onLoadLive?.call();
          return _fixtureWithUpdatedAt(_tenMinutesAgo);
        },
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
