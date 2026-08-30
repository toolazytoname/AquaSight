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
const _beijingClock = '2026-08-26 09:50';
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';

void main() {
  testWidgets(
      'last-refresh-hit is full-row 48px; tap right side retries live',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return _fixtureWithUpdatedAt(_tenMinutesAgo);
          },
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

    expect(loads, 1);
    expect(find.byKey(_hitKey), findsOneWidget);

    final hitSize = tester.getSize(find.byKey(_hitKey));
    expect(hitSize.height, greaterThanOrEqualTo(48));
    expect(
      hitSize.width,
      greaterThan(tester.getSize(find.byKey(_refreshKey)).width),
    );

    await tester.tapAt(
      tester.getTopRight(find.byKey(_hitKey)) + const Offset(-8, 24),
    );
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(tester.widget<Text>(find.byKey(_refreshKey)).data, '10分钟前 · 更新');
    expect(
      find.descendant(
        of: find.byTooltip('$_beijingClock · 点按刷新'),
        matching: find.byKey(_refreshKey),
      ),
      findsOneWidget,
    );
  });
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
