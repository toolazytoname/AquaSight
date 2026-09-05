import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _barKey = Key('source-filter-bar');
const _allKey = Key('source-filter-all');
const _scrollbarKey = Key('source-filter-scrollbar');

void main() {
  testWidgets(
      'source-filter-bar Material shape is radius 8; tint/shadow stay transparent',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    final materialFinder = find.byKey(_barKey);
    expect(materialFinder, findsOneWidget);

    final material = tester.widget<Material>(materialFinder);
    expect(material.shape, isA<RoundedRectangleBorder>());
    expect(
      (material.shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(material.surfaceTintColor, Colors.transparent);
    expect(material.shadowColor, Colors.transparent);

    expect(find.byKey(_allKey), findsOneWidget);
    expect(find.byKey(_scrollbarKey), findsOneWidget);
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share ($url)');
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
