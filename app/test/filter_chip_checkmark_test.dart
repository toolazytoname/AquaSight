import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');

void main() {
  testWidgets(
      'source-filter chips hide the checkmark; selection is color only',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final all = tester.widget<FilterChip>(find.byKey(_allKey));
    final weibo = tester.widget<FilterChip>(find.byKey(_weiboKey));

    expect(all.showCheckmark, isFalse);
    expect(weibo.showCheckmark, isFalse);

    expect(all.selected, isTrue);
    expect(weibo.selected, isFalse);

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    final allAfter = tester.widget<FilterChip>(find.byKey(_allKey));
    final weiboAfter = tester.widget<FilterChip>(find.byKey(_weiboKey));
    expect(weiboAfter.showCheckmark, isFalse);
    expect(allAfter.showCheckmark, isFalse);
    expect(weiboAfter.selected, isTrue);
    expect(allAfter.selected, isFalse);
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
