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
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';
const _tooltip = '2026-08-26 09:50 · 点按刷新';

void main() {
  testWidgets(
      'last-refresh-hit is InkWell with theme primary splash; no wrapping onTap GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpLive(tester);

    final hitFinder = find.byKey(_hitKey);
    expect(hitFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(hitFinder);
    final scheme = Theme.of(tester.element(hitFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);
    expect(inkWell.onLongPress, isNotNull);

    final tooltip = tester.widget<Tooltip>(
      find.ancestor(
        of: find.byKey(_refreshKey),
        matching: find.byType(Tooltip),
      ),
    );
    expect(tooltip.message, _tooltip);

    // Ancestors of last-refresh only (not a global find.byType). InkWell
    // inserts an inner GestureDetector with onTap; skip those descendants.
    // Tooltip's detector must have onTap == null.
    final gestureDetectors = find.ancestor(
      of: find.byKey(_refreshKey),
      matching: find.byType(GestureDetector),
    );
    for (final element in gestureDetectors.evaluate()) {
      final insideInkWell = find
          .descendant(
            of: hitFinder,
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      if (insideInkWell) continue;
      expect((element.widget as GestureDetector).onTap, isNull);
    }
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpLive(WidgetTester tester) async {
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
