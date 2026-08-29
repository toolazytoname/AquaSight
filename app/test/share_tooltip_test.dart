import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

void main() {
  testWidgets('破圈 share button has 分享 tooltip and shares 同日破圈',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory();
    final raw = loadFixtureJson();
    raw['items'] = [
      (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
            (item) => item['id'] == 'same-day-breaking',
          ),
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
          shared.add((title: title, url: url));
        },
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingShareKey), findsOneWidget);
    expect(find.byTooltip('分享'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_breakingShareKey),
        matching: find.byTooltip('分享'),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('分享'), findsNothing);
    expect(_tooltipSemantics('分享'), findsOne);

    await tester.tap(find.byTooltip('分享'));
    await tester.pumpAndSettle();

    expect(shared, hasLength(1));
    expect(shared.single.title, '同日破圈');
    expect(shared.single.url, Uri.parse('https://example.com/breaking'));
    expect(opened, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}
