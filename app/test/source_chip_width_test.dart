import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  testWidgets(
      'source-filter chips hit width and height are at least 48',
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

    final allSize = tester.getSize(find.byKey(const Key('source-filter-all')));
    expect(allSize.width, greaterThanOrEqualTo(48));
    expect(allSize.height, greaterThanOrEqualTo(48));

    final weiboSize =
        tester.getSize(find.byKey(const Key('source-filter-weibo')));
    expect(weiboSize.width, greaterThanOrEqualTo(48));
    expect(weiboSize.height, greaterThanOrEqualTo(48));
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
