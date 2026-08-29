import 'dart:async';
import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  testWidgets('shows loading until the injected fixture resolves', (tester) async {
    final repo = EventsRepository(
      loadLive: () => Future<String>.delayed(
        const Duration(milliseconds: 50),
        loadFixtureBytes,
      ),
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.text('加载中…'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
  });

  testWidgets('fixture timeline: titles, chips, score, reason, groups', (
    tester,
  ) async {
    await tester.pumpWidget(
      AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: EventsRepository.fromJsonString(loadFixtureBytes())),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsOneWidget);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsOneWidget);

    expect(find.text('北京已是次日'), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.text('English-only title stays English'), findsOneWidget);
    expect(find.text('UTC evening is next Beijing day'), findsNothing);

    expect(
      find.descendant(
        of: find.byKey(const Key('event-card-same-day-breaking')),
        matching: find.text('weibo'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byKey(const Key('event-card-same-day-breaking')),
        matching: find.text('baidu'),
      ),
      findsOneWidget,
    );
    expect(find.text('分数 99'), findsOneWidget);
    expect(find.text('分数 2'), findsOneWidget);
    expect(find.text('hard impact keyword'), findsOneWidget);
    expect(find.text('titleZh empty so title is shown'), findsOneWidget);

    final day = tester.getTopLeft(find.byKey(const Key('event-card-same-day-breaking')));
    final normal = tester.getTopLeft(
      find.byKey(const Key('event-card-same-day-normal-high-score')),
    );
    expect(day.dy, lessThan(normal.dy));
  });

  testWidgets('empty items from the fixture shows empty state', (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: EventsRepository.fromJsonString(jsonEncode(raw))),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
    expect(find.byType(RefreshIndicator), findsOneWidget);
    expect(_alwaysScrollable(tester), isTrue);
  });

  testWidgets('error state shows the message and does not fetch HTTP', (
    tester,
  ) async {
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('网络不可用'),
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.text('加载失败'), findsOneWidget);
    expect(find.text('网络不可用'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);
    expect(find.byKey(const Key('timeline-error-retry')), findsOneWidget);
    expect(find.byType(RefreshIndicator), findsOneWidget);
    expect(_alwaysScrollable(tester), isTrue);
  });

  testWidgets('pull-to-refresh injects a second fixture: B appears, A follows JSON', (
    tester,
  ) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        final raw = loadFixtureJson();
        final first = (raw['items'] as List).first as Map<String, dynamic>;
        first['titleZh'] = loads == 1 ? '标题A' : '标题B';
        return jsonEncode(raw);
      },
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.text('标题A'), findsOneWidget);
    expect(find.text('标题B'), findsNothing);
    expect(find.text('同日破圈'), findsOneWidget);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.text('标题A'), findsOneWidget);
    await tester.pumpAndSettle();
    await refresh;

    expect(find.text('标题B'), findsOneWidget);
    expect(find.text('标题A'), findsNothing);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(loads, 2);

    final day = tester.getTopLeft(find.byKey(const Key('event-card-same-day-breaking')));
    final normal = tester.getTopLeft(
      find.byKey(const Key('event-card-same-day-normal-high-score')),
    );
    expect(day.dy, lessThan(normal.dy));
  });

  testWidgets('retry from error loads the fixture list without a loading flash', (
    tester,
  ) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () {
        loads++;
        if (loads == 1) {
          return Future<String>.error(EventsLoadException('网络不可用'));
        }
        return Future<String>.delayed(
          const Duration(milliseconds: 50),
          loadFixtureBytes,
        );
      },
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(const Key('timeline-error-retry')), findsOneWidget);

    await tester.tap(find.byKey(const Key('timeline-error-retry')));
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.byKey(const Key('timeline-error-retry')), findsNothing);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.text('北京已是次日'), findsOneWidget);
  });

  testWidgets('pull from error state shows the fixture list', (tester) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        if (loads == 1) {
          throw EventsLoadException('网络不可用');
        }
        return loadFixtureBytes();
      },
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    await tester.pumpAndSettle();
    await refresh;

    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.text('同日破圈'), findsOneWidget);
  });

  testWidgets('failed refresh keeps the old list and shows a SnackBar', (
    tester,
  ) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        if (loads == 1) return loadFixtureBytes();
        throw EventsLoadException('刷新失败：源不可用');
      },
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.text('北京已是次日'), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.text('北京已是次日'), findsOneWidget);
    await tester.pumpAndSettle();
    await refresh;

    expect(find.byKey(const Key('timeline-error')), findsNothing);
    expect(find.text('北京已是次日'), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.text('English-only title stays English'), findsOneWidget);
    expect(find.byType(SnackBar), findsOneWidget);
    expect(find.text('刷新失败：源不可用'), findsOneWidget);
  });

  testWidgets('failed refresh on error only updates the error text', (
    tester,
  ) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        throw EventsLoadException(loads == 1 ? '错误一' : '错误二');
      },
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.text('错误一'), findsOneWidget);
    expect(find.text('重试'), findsOneWidget);
    expect(find.byKey(const Key('timeline-error-retry')), findsOneWidget);

    await tester.tap(find.byKey(const Key('timeline-error-retry')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
    expect(find.text('错误二'), findsOneWidget);
    expect(find.text('错误一'), findsNothing);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('empty state pull-to-refresh can load the fixture list', (
    tester,
  ) async {
    var loads = 0;
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        final raw = loadFixtureJson();
        if (loads == 1) {
          raw['items'] = [];
        }
        return jsonEncode(raw);
      },
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    await tester.pumpAndSettle();
    await refresh;

    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.text('同日破圈'), findsOneWidget);
  });

  testWidgets(
      'tapping retry while a refresh is running does not stack loadLive',
      (tester) async {
    var loads = 0;
    final hang = Completer<String>();
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        if (loads == 1) throw EventsLoadException('网络不可用');
        return hang.future;
      },
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(readStore: ReadStore.memory(), unreadOnlyStore: UnreadOnlyStore.memory(), scrollOffsetStore: ScrollOffsetStore.memory(), repository: repo));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(const Key('timeline-error-retry')), findsOneWidget);
    expect(loads, 1);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    expect(loads, 2);

    await tester.tap(find.byKey(const Key('timeline-error-retry')));
    await tester.pump();
    expect(loads, 2);

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();
    await refresh;

    expect(loads, 2);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });
}

bool _alwaysScrollable(WidgetTester tester) {
  final scrollable = tester.widget<Scrollable>(find.byType(Scrollable));
  return scrollable.physics is AlwaysScrollableScrollPhysics;
}
