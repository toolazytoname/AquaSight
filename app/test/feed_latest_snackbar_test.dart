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

const _scrollKey = Key('timeline-scroll');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _feedLatestSnackKey = Key('feed-latest-snackbar');
const _updatedA = '2026-08-26T01:00:00.000Z';
const _updatedB = '2026-08-26T03:00:00.000Z';

void main() {
  testWidgets(
      'memory(120) + A silent; pull same A shows 已是最新; pull B shows 已更新',
      (tester) async {
    var loads = 0;
    var stamp = _updatedA;
    final store = ScrollOffsetStore.memory(120);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return _fixtureWithUpdatedAt(stamp);
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: store,
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(find.text('已更新'), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect(find.byKey(_feedLatestSnackKey), findsOneWidget);
    expect(find.text('已是最新'), findsOneWidget);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    stamp = _updatedB;
    await _pullReload(tester);
    expect(loads, 3);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新'), findsOneWidget);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
  });

  testWidgets('empty updatedAt on both loads stays silent', (tester) async {
    var loads = 0;
    final store = ScrollOffsetStore.memory(120);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return _fixtureWithUpdatedAt('');
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: store,
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(find.text('已更新'), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(find.text('已更新'), findsNothing);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
  });

  testWidgets('_loadInitial with A does not show 已是最新', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => _fixtureWithUpdatedAt(_updatedA),
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(_feedLatestSnackKey), findsNothing);
    expect(find.text('已是最新'), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);
  });
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
}

Future<void> _pullReload(WidgetTester tester) async {
  final refresh = tester
      .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
      .show();
  await tester.pumpAndSettle();
  await refresh;
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<SingleChildScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
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
