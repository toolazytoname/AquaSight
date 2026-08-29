import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _scrollKey = Key('timeline-scroll');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _updatedA = '2026-08-26T01:00:00.000Z';
const _updatedB = '2026-08-26T03:00:00.000Z';

void main() {
  testWidgets(
      'memory(120) + A restores; reload same A stays; reload B jumps to top',
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
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);

    stamp = _updatedB;
    await _pullReload(tester);
    expect(loads, 3);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新'), findsOneWidget);
    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
  });

  testWidgets('empty updatedAt on both loads keeps restored offset',
      (tester) async {
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
      ),
    );
    await tester.pumpAndSettle();
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);
    expect(find.text('已更新'), findsNothing);
  });

  testWidgets(
      'resume after 2 min with new updatedAt jumps to top; store not written in reload',
      (tester) async {
    var loads = 0;
    var stamp = _updatedA;
    var now = DateTime.utc(2026, 8, 26, 2);
    final store = ScrollOffsetStore.memory(120);
    await tester.pumpWidget(
      AquaApp(
        now: () => now,
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
      ),
    );
    await tester.pumpAndSettle();
    expect(loads, 1);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    stamp = _updatedB;
    _simulateReturnToForeground(tester);
    await tester.pumpAndSettle();
    expect(loads, 1);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    now = now.add(const Duration(minutes: 2));
    _simulateReturnToForeground(tester);
    await tester.pumpAndSettle();
    expect(loads, 2);
    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
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
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
}

/// Binding starts resumed; change away first so the second call delivers.
void _simulateReturnToForeground(WidgetTester tester) {
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.hidden);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
  tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
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
