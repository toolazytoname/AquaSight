import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _snackKey = Key('mark-all-read-snackbar');
const _undoKey = Key('mark-all-undo');
const _toggleKey = Key('unread-only-toggle');
const _showAllKey = Key('timeline-empty-show-all');
const _emptyKey = Key('timeline-empty');

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
      'unread items: mark-all shows snackbar and undo; unread 0; overflow gone',
      (tester) async {
    final store = ReadStore.memory();
    await _pumpFixture(tester, readStore: store);

    expect(find.byKey(_overflowKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
    expect(find.byKey(_snackKey), findsNothing);
    expect(find.text('已全部标为已读'), findsNothing);
    expect(find.byKey(_undoKey), findsNothing);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_snackKey), findsOneWidget);
    expect(find.text('已全部标为已读'), findsOneWidget);
    expect(find.byKey(_undoKey), findsOneWidget);
    expect(find.text('撤销'), findsOneWidget);
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isTrue);
    }
  });

  testWidgets(
      'undo restores those ids to unread; count and overflow return; snackbar gone',
      (tester) async {
    final store = ReadStore.memory();
    await _pumpFixture(tester, readStore: store);

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_snackKey), findsOneWidget);
    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);

    await tester.tap(find.byKey(_undoKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_snackKey), findsNothing);
    expect(find.text('已全部标为已读'), findsNothing);
    expect(find.byKey(_undoKey), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(find.byKey(_overflowKey), findsOneWidget);
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isFalse);
    }
  });

  testWidgets(
      'unread-only mark-all shows 暂无未读; undo restores cards without 查看全部',
      (tester) async {
    final store = ReadStore.memory();
    final unreadOnly = UnreadOnlyStore.memory();
    await _pumpFixture(
      tester,
      readStore: store,
      unreadOnlyStore: unreadOnly,
    );

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    for (final id in _allFixtureIds) {
      expect(find.byKey(Key('event-card-$id')), findsOneWidget);
    }

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(find.text('查看全部'), findsOneWidget);
    expect(find.byKey(_snackKey), findsOneWidget);
    expect(find.text('已全部标为已读'), findsOneWidget);
    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isTrue);
      expect(find.byKey(Key('event-card-$id')), findsNothing);
    }

    await tester.tap(find.byKey(_undoKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
    expect(find.byKey(_snackKey), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(find.byKey(_overflowKey), findsOneWidget);
    for (final id in _allFixtureIds) {
      expect(store.isRead(id), isFalse);
      expect(find.byKey(Key('event-card-$id')), findsOneWidget);
    }
  });

  testWidgets('already 0 unread: no overflow and no mark-all snackbar',
      (tester) async {
    await _pumpFixture(
      tester,
      readStore: ReadStore.memory({..._allFixtureIds}),
    );

    expect(_countText(tester), '未读 0');
    expect(find.byKey(_overflowKey), findsNothing);
    expect(find.byKey(_markAllKey), findsNothing);
    expect(find.byKey(_snackKey), findsNothing);
    expect(find.text('已全部标为已读'), findsNothing);
    expect(find.byKey(_undoKey), findsNothing);
    expect(find.text('撤销'), findsNothing);
  });

  test('markUnreadAll of new unread ids saves once; already-unread is no-op',
      () async {
    final written = <List<String>>[];
    final store = ReadStore(
      loadIds: () async => <String>{},
      saveIds: (ids) async => written.add(ids.toList()),
    );
    await store.markAll(['a', 'b', 'c']);
    written.clear();

    await store.markUnreadAll(['a', 'c', '']);

    expect(store.isRead('a'), isFalse);
    expect(store.isRead('b'), isTrue);
    expect(store.isRead('c'), isFalse);
    expect(written, [
      ['b'],
    ]);

    written.clear();
    final before = List<String>.from(store.ids);
    await store.markUnreadAll(['a', 'c', '']);
    await store.markUnreadAll([]);

    expect(store.ids.toList(), before);
    expect(written, isEmpty);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required ReadStore readStore,
  UnreadOnlyStore? unreadOnlyStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: readStore,
      unreadOnlyStore: unreadOnlyStore ?? UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
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
