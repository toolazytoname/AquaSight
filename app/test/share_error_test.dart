import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _shareErrorSnackKey = Key('share-error-snackbar');
const _openErrorSnackKey = Key('open-error-snackbar');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'shareEvent throw shows 无法分享 once and does not open, mark read, or change unread',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          throw StateError('share failed');
        },
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(find.byKey(_shareErrorSnackKey), findsOneWidget);
    expect(find.text('无法分享'), findsOneWidget);
    expect(find.byKey(_openErrorSnackKey), findsNothing);
    expect(find.text('无法打开'), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
  });

  testWidgets(
      'shareEvent success does not show share-error snackbar and does not mark read',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          shared.add((title: title, url: url));
        },
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(shared, hasLength(1));
    expect(opened, isEmpty);
    expect(find.byKey(_shareErrorSnackKey), findsNothing);
    expect(find.text('无法分享'), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('card with no http url does not show 无法分享', (tester) async {
    final opened = <Uri>[];
    var shareCalls = 0;
    final raw = loadFixtureJson();
    raw['items'] = [
      {
        'id': 'no-url',
        'title': 'No link',
        'url': '',
        'source': 'hn',
        'level': 'normal',
        'reason': 'empty',
        'sources': <Map<String, Object?>>[],
      },
    ];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          shareCalls += 1;
          throw StateError('share failed');
        },
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('event-card-no-url-share')), findsNothing);
    await tester.tap(find.byKey(const Key('event-card-no-url')));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(shareCalls, 0);
    expect(find.byKey(_shareErrorSnackKey), findsNothing);
    expect(find.text('无法分享'), findsNothing);
  });

  testWidgets('shareEvent throw replaces 已复制 instead of stacking', (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async {},
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          throw StateError('share failed');
        },
        copyText: (text) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_shareErrorSnackKey), findsOneWidget);
    expect(find.text('无法分享'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy');
}
