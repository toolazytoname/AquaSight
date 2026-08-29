import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');
const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

void main() {
  testWidgets('share icon records displayTitle and open-original url once',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url, Rect sharePositionOrigin})>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((
            title: title,
            url: url,
            sharePositionOrigin: sharePositionOrigin,
          ));
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(shared, hasLength(1));
    expect(shared.single.title, '同日破圈');
    expect(shared.single.url, Uri.parse('https://example.com/breaking'));
    final origin = shared.single.sharePositionOrigin;
    expect(origin.isEmpty, isFalse);
    final buttonRect = tester.getRect(find.byKey(_breakingShareKey));
    expect(origin.inflate(1).overlaps(buttonRect), isTrue);
    expect(opened, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
  });

  testWidgets('tapping the breaking card body opens the url and does not share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(shared, isEmpty);
  });

  testWidgets('empty url hides the share button and does not share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
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
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('event-card-no-url-share')), findsNothing);
    await tester.tap(find.byKey(const Key('event-card-no-url')));
    await tester.pumpAndSettle();

    expect(shared, isEmpty);
    expect(opened, isEmpty);
  });

  testWidgets('javascript: url hides the share button and does not share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final raw = loadFixtureJson();
    raw['items'] = [
      {
        'id': 'js-url',
        'title': 'Bad scheme',
        'url': 'javascript:alert(1)',
        'source': 'hn',
        'level': 'normal',
        'reason': 'xss',
      },
    ];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('event-card-js-url-share')), findsNothing);
    await tester.tap(find.byKey(const Key('event-card-js-url')));
    await tester.pumpAndSettle();

    expect(shared, isEmpty);
    expect(opened, isEmpty);
  });

  testWidgets('share uses the source url when item.url is empty', (tester) async {
    final shared = <({String title, Uri url})>[];
    final raw = loadFixtureJson();
    raw['items'] = [
      {
        'id': 'from-source',
        'title': 'From source',
        'url': '  ',
        'source': 'weibo',
        'level': 'normal',
        'reason': '',
        'sources': [
          {'source': 'weibo', 'url': ''},
          {'source': 'baidu', 'url': 'https://example.com/from-source'},
        ],
      },
    ];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: (uri) async {},
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-from-source-share')));
    await tester.pumpAndSettle();

    expect(shared, hasLength(1));
    expect(shared.single.title, 'From source');
    expect(shared.single.url, Uri.parse('https://example.com/from-source'));
  });

  testWidgets('share throw does not open url or mark 已读', (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({required title, required url, required sharePositionOrigin}) async {
          throw StateError('share failed');
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
  });

  test('share payload url matches httpUrlToOpen, not a raw empty item.url', () {
    const item = EventItem(
      id: 'from-source',
      title: 'From source',
      url: '  ',
      source: 'weibo',
      level: 'normal',
      reason: '',
      sources: [
        SourceRef(source: 'weibo', url: ''),
        SourceRef(source: 'baidu', url: 'https://example.com/from-source'),
      ],
    );
    expect(httpUrlToOpen(item), Uri.parse('https://example.com/from-source'));
  });
}
