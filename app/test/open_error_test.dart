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
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _openErrorSnackKey = Key('open-error-snackbar');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'openUrl throw shows 无法打开 once and does not mark read or change unread',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async {
          opened.add(uri);
          throw StateError('opener failed');
        },
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(opened, hasLength(1));
    expect(find.byKey(_openErrorSnackKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
  });

  testWidgets(
      'openUrl success does not show open-error snackbar and marks breaking read',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(find.byKey(_openErrorSnackKey), findsNothing);
    expect(find.text('无法打开'), findsNothing);
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(_countText(tester), '未读 5');
  });

  testWidgets('card with no http url does not show 无法打开', (tester) async {
    final opened = <Uri>[];
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
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-no-url')));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(find.byKey(_openErrorSnackKey), findsNothing);
    expect(find.text('无法打开'), findsNothing);
  });

  testWidgets('openUrl throw replaces 已复制 instead of stacking', (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async {
          opened.add(uri);
          throw StateError('opener failed');
        },
        shareEvent: _forbidShare,
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

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, hasLength(1));
    expect(find.byKey(_openErrorSnackKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);
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

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
