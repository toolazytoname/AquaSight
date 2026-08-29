import 'dart:async';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets('resumed after first settle retries live via _retryFromError',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return loadFixtureBytes();
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsOneWidget);

    _simulateReturnToForeground(tester);
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('resumed during first load does not stack loadLive',
      (tester) async {
    var loads = 0;
    final hang = Completer<String>();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return hang.future;
            return loadFixtureBytes();
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(loads, 1);

    _simulateReturnToForeground(tester);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(loads, 1);
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('resumed while _refreshing does not stack a third loadLive',
      (tester) async {
    var loads = 0;
    final hang = Completer<String>();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return loadFixtureBytes();
            return hang.future;
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsOneWidget);

    _simulateReturnToForeground(tester);
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(loads, 2);

    _simulateReturnToForeground(tester);
    await tester.pump();
    expect(loads, 2);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });
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
