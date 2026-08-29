import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingWeiboChipKey = Key('event-card-same-day-breaking-source-weibo');
const _weiboBarKey = Key('source-filter-weibo');

void main() {
  testWidgets(
      'card source chip hit is 48×48; tap filters and does not open url',
      (tester) async {
    final opened = <Uri>[];
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
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_breakingWeiboChipKey), findsOneWidget);
    final chipSize = tester.getSize(find.byKey(_breakingWeiboChipKey));
    expect(chipSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(chipSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));

    await tester.tap(find.byKey(_breakingWeiboChipKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(tester.widget<FilterChip>(find.byKey(_weiboBarKey)).selected, isTrue);
  });
}
