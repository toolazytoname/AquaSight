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
const _copySnackKey = Key('copy-snackbar');
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';

void main() {
  testWidgets(
      'copy-snackbar shadowColor is transparent; elevation 3; floating; duration 2s; shape r8',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpLastRefresh(
      tester,
      copyText: (_) async {},
    );

    await tester.longPress(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);

    final snackFinder = find.byKey(_copySnackKey);
    final snack = tester.widget<SnackBar>(snackFinder);
    expect((snack as dynamic).shadowColor, Colors.transparent);
    expect(snack.elevation, 3);
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.duration, const Duration(seconds: 2));
    final shape = snack.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));

    final localTheme = tester.widget<Theme>(
      find.descendant(of: snackFinder, matching: find.byType(Theme)).first,
    );
    expect(localTheme.data.shadowColor, Colors.transparent);
    expect(localTheme.data.colorScheme.shadow, Colors.transparent);

    final materialFinder =
        find.descendant(of: snackFinder, matching: find.byType(Material)).first;
    expect(
      Theme.of(tester.element(materialFinder)).shadowColor,
      Colors.transparent,
    );
    expect(
      Theme.of(tester.element(materialFinder)).colorScheme.shadow,
      Colors.transparent,
    );
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
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
