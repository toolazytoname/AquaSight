import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _scrollKey = Key('timeline-scroll');
const _overflowKey = Key('appbar-overflow');

void main() {
  testWidgets('fixture unread-count has 下一条未读 tooltip; visible text stays 未读 6',
      (tester) async {
    await _pumpFixture(tester);

    expect(find.byTooltip('下一条未读'), findsOneWidget);
    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
    expect(find.byTooltip('全标已读'), findsOneWidget);
    expect(find.byKey(_overflowKey), findsOneWidget);
  });

  testWidgets(
      'memory(120) + fixture: tap unread-count jumps to top',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(find.byTooltip('第一条未读'), findsOneWidget);
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
    expect(_countText(tester), '未读 6');
    expect(find.byTooltip('下一条未读'), findsOneWidget);
  });

  testWidgets('loading has no unread-count and no 回到顶部 tooltip',
      (tester) async {
    final repo = EventsRepository(
      loadLive: () => Future<String>.delayed(
        const Duration(milliseconds: 50),
        loadFixtureBytes,
      ),
    );
    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.byKey(_countKey), findsNothing);
    expect(find.byTooltip('回到顶部'), findsNothing);
    expect(find.byTooltip('第一条未读'), findsNothing);

    await tester.pumpAndSettle();
    expect(find.byTooltip('下一条未读'), findsOneWidget);
    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('error has no unread-count and no 回到顶部 tooltip', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadFallback: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_countKey), findsNothing);
    expect(find.byTooltip('回到顶部'), findsNothing);
    expect(find.byTooltip('第一条未读'), findsNothing);
  });
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
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
