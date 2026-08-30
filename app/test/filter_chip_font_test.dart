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
      'source-filter chips use 12px label font like card _sourceChip',
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

    final scheme =
        Theme.of(tester.element(find.byKey(_allKey))).colorScheme;

    final all = tester.widget<FilterChip>(find.byKey(_allKey));
    final weibo = tester.widget<FilterChip>(find.byKey(_weiboKey));

    expect(all.selected, isTrue);
    expect(all.labelStyle?.fontSize, 12);
    expect(all.labelStyle?.color, scheme.onPrimaryContainer);
    expect(weibo.selected, isFalse);
    expect(weibo.labelStyle?.fontSize, 12);
    expect(weibo.labelStyle?.color, scheme.primary);

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    final allAfter = tester.widget<FilterChip>(find.byKey(_allKey));
    final weiboAfter = tester.widget<FilterChip>(find.byKey(_weiboKey));
    expect(weiboAfter.selected, isTrue);
    expect(weiboAfter.labelStyle?.fontSize, 12);
    expect(weiboAfter.labelStyle?.color, scheme.onPrimaryContainer);
    expect(allAfter.selected, isFalse);
    expect(allAfter.labelStyle?.fontSize, 12);
    expect(allAfter.labelStyle?.color, scheme.primary);
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
