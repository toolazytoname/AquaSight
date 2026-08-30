import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _t0Iso = '2026-08-26T02:00:00.000Z';
final _t0 = DateTime.parse(_t0Iso);

const _cardTimeKey = Key('event-card-tick-card-time');
const _refreshKey = Key('last-refresh');

void main() {
  testWidgets(
      'tickRelativeTime rebuilds card time and last-refresh after one minute',
      (tester) async {
    var now = _t0;
    var loads = 0;
    final json = _oneCardJson(_t0Iso);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            return json;
          },
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => now,
        tickRelativeTime: true,
      ),
    );
    await tester.pump();

    expect(loads, 1);
    expect(_text(tester, _cardTimeKey), '刚刚');
    expect(_text(tester, _refreshKey), '刚刚 · 更新');
    expect(
      find.descendant(
        of: find.byTooltip('2026-08-26 10:00'),
        matching: find.byKey(_cardTimeKey),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byTooltip('2026-08-26 10:00'),
        matching: find.byKey(_refreshKey),
      ),
      findsOneWidget,
    );

    now = _t0.add(const Duration(seconds: 60));
    await tester.pump(relativeTimeTick);

    expect(loads, 1);
    expect(_text(tester, _cardTimeKey), '1分钟前');
    expect(_text(tester, _refreshKey), '1分钟前 · 更新');
    expect(
      find.descendant(
        of: find.byTooltip('2026-08-26 10:00'),
        matching: find.byKey(_cardTimeKey),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byTooltip('2026-08-26 10:00'),
        matching: find.byKey(_refreshKey),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
      'tickRelativeTime false (test default) stays 刚刚 after relativeTimeTick',
      (tester) async {
    var now = _t0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(_oneCardJson(_t0Iso)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => now,
      ),
    );
    await tester.pumpAndSettle();

    expect(_text(tester, _cardTimeKey), '刚刚');
    expect(_text(tester, _refreshKey), '刚刚 · 更新');

    now = _t0.add(const Duration(seconds: 60));
    await tester.pump(relativeTimeTick);

    expect(_text(tester, _cardTimeKey), '刚刚');
    expect(_text(tester, _refreshKey), '刚刚 · 更新');
  });
}

String _oneCardJson(String t0) {
  return jsonEncode({
    'updatedAt': t0,
    'sourceErrors': [],
    'items': [
      {
        'id': 'tick-card',
        'title': 'Tick card',
        'url': 'https://example.com/tick',
        'source': 'hn',
        'level': 'normal',
        'reason': 'relative tick',
        'publishedAt': t0,
      },
    ],
  });
}

String _text(WidgetTester tester, Key key) {
  return tester.widget<Text>(find.byKey(key)).data!;
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
