import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('all-unread fixture overflow has 全标已读 tooltip; tap marks all',
      (tester) async {
    final store = ReadStore.memory();
    await _pumpFixture(tester, readStore: store);

    expect(find.byTooltip('全标已读'), findsOneWidget);
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byTooltip('全标已读'));
    await tester.pumpAndSettle();
    expect(find.byKey(_markAllKey), findsOneWidget);
    expect(find.text('全标已读'), findsOneWidget);

    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byTooltip('全标已读'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isTrue);
    }
  });

  testWidgets('unread 0 has no overflow and no 全标已读 tooltip', (tester) async {
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({..._allFixtureIds}),
    );

    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byTooltip('全标已读'), findsNothing);
  });

  testWidgets('loading has no overflow and no 全标已读 tooltip', (tester) async {
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
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byTooltip('全标已读'), findsNothing);

    await tester.pumpAndSettle();
    expect(find.byTooltip('全标已读'), findsOneWidget);
    expect(find.byKey(_overflowKey), findsOneWidget);
  });

  testWidgets('error has no overflow and no 全标已读 tooltip', (tester) async {
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
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byTooltip('全标已读'), findsNothing);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  ReadStore? readStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
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
