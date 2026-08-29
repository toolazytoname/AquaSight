import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _breakingTitleKey = Key('event-card-same-day-breaking-title');

void main() {
  testWidgets('share button is 48×48; tap shares once; title tap only opens',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
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
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingShareKey), findsOneWidget);
    final shareSize = tester.getSize(find.byKey(_breakingShareKey));
    expect(shareSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(shareSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(find.byTooltip('分享'), findsOneWidget);
    expect(find.bySemanticsLabel('分享'), findsNothing);

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(shared, hasLength(1));
    expect(shared.single.title, '同日破圈');
    expect(shared.single.url, Uri.parse('https://example.com/breaking'));
    expect(opened, isEmpty);

    await tester.tap(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(shared, hasLength(1));
  });
}
