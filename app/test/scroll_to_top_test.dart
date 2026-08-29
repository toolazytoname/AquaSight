import 'dart:convert';

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
const _toggleKey = Key('unread-only-toggle');

void main() {
  testWidgets(
      'memory(120) + fixture: tap unread-count animates to top; no open/share/toggle',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
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
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(_countText(tester), '未读 6');
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester), lessThanOrEqualTo(2));
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('empty items: tap 回顶 does not throw and has no timeline-scroll',
      (tester) async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsNothing);
    expect(find.byKey(_countKey), findsOneWidget);
    expect(_countText(tester), '回顶');

    await tester.tap(find.byKey(_countKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsNothing);
    expect(_countText(tester), '回顶');
  });

  testWidgets('loading state has no unread-count', (tester) async {
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

    await tester.pumpAndSettle();
    expect(find.byKey(_countKey), findsOneWidget);
  });
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
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
