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
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _breakingMarkUnreadKey = Key('event-card-same-day-breaking-mark-unread');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets(
      'pre-seeded breaking 已读; tap mark-unread drops it and unread 5→6',
      (tester) async {
    final store = ReadStore.memory({'same-day-breaking'});
    await _pumpFixture(tester, readStore: store);

    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(find.text('已读'), findsOneWidget);
    expect(find.byKey(_breakingMarkUnreadKey), findsOneWidget);
    final markUnreadSize = tester.getSize(find.byKey(_breakingMarkUnreadKey));
    expect(markUnreadSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(markUnreadSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(_countText(tester), '未读 5');
    expect(store.isRead('same-day-breaking'), isTrue);

    await tester.tap(find.byKey(_breakingMarkUnreadKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_breakingMarkUnreadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(store.ids, isEmpty);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_breakingMarkUnreadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(store.isRead('same-day-breaking'), isFalse);
  });

  testWidgets(
      'overflow mark-all then breaking mark-unread: 未读 1 and overflow stays',
      (tester) async {
    final store = ReadStore.memory();
    await _pumpFixture(tester, readStore: store);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length));

    await tester.tap(find.byKey(_breakingMarkUnreadKey));
    await tester.pumpAndSettle();

    expect(_countText(tester), '未读 1');
    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_breakingMarkUnreadKey), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    for (final id in _allFixtureIds) {
      if (id == 'same-day-breaking') continue;
      expect(store.isRead(id), isTrue);
      expect(find.byKey(Key('event-card-$id-read')), findsOneWidget);
      expect(find.byKey(Key('event-card-$id-mark-unread')), findsOneWidget);
    }
    expect(find.text('已读'), findsNWidgets(_allFixtureIds.length - 1));
  });

  testWidgets('tapping mark-unread does not open url or share', (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory({'same-day-breaking'});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_breakingMarkUnreadKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('tapping the 已读 text center also unmarks', (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory({'same-day-breaking'});
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingReadKey), findsOneWidget);
    await tester.tap(find.byKey(_breakingReadKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_breakingMarkUnreadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(opened, isEmpty);
    expect(shared, isEmpty);
  });

  testWidgets('unread cards have no mark-unread entry', (tester) async {
    await _pumpFixture(tester);

    expect(find.text('已读'), findsNothing);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id-mark-unread')), findsNothing);
      expect(find.byKey(Key('event-card-$id-read')), findsNothing);
    }
  });

  test('markUnread of already-unread or empty id is a no-op write', () async {
    final written = <List<String>>[];
    final store = ReadStore(
      loadIds: () async => <String>{},
      saveIds: (ids) async => written.add(ids.toList()),
    );
    await store.markRead('a');
    written.clear();
    final before = List<String>.from(store.ids);

    await store.markUnread('missing');
    await store.markUnread('');

    expect(store.ids.toList(), before);
    expect(store.isRead('a'), isTrue);
    expect(written, isEmpty);
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
