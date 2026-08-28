import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
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
    await tester.pumpWidget(AquaApp(repository: repo));
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.text('加载中…'), findsOneWidget);
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-loading')), findsNothing);
  });

  testWidgets('fixture timeline: titles, chips, score, reason, groups', (
    tester,
  ) async {
    await tester.pumpWidget(
      AquaApp(repository: EventsRepository.fromJsonString(loadFixtureBytes())),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('day-group-2026-08-26')), findsOneWidget);
    expect(find.byKey(const Key('day-group-2026-08-24')), findsOneWidget);
    expect(find.byKey(Key('day-group-$unknownDateLabel')), findsOneWidget);

    expect(find.text('北京已是次日'), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.text('English-only title stays English'), findsOneWidget);
    expect(find.text('UTC evening is next Beijing day'), findsNothing);

    expect(find.text('weibo'), findsOneWidget);
    expect(find.text('baidu'), findsOneWidget);
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
      AquaApp(repository: EventsRepository.fromJsonString(jsonEncode(raw))),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无事件'), findsOneWidget);
  });

  testWidgets('error state shows the message and does not fetch HTTP', (
    tester,
  ) async {
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('网络不可用'),
      loadFallback: () async => null,
    );
    await tester.pumpWidget(AquaApp(repository: repo));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.text('加载失败'), findsOneWidget);
    expect(find.text('网络不可用'), findsOneWidget);
  });
}
