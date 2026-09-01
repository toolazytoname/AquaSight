import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _weiboChipKey = Key('event-card-same-day-breaking-source-weibo');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'long-press weibo source chip copies name and shows 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    final opened = <Uri>[];
    await _pumpDefault(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_weiboChipKey));
    await tester.pumpAndSettle();

    expect(copied, ['weibo']);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
    expect(opened, isEmpty);
  });

  testWidgets('short-press weibo source chip does not copy', (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    final opened = <Uri>[];
    await _pumpDefault(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byKey(_weiboChipKey));
    await tester.pumpAndSettle();

    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
    expect(opened, isEmpty);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpDefault(
  WidgetTester tester, {
  required Future<void> Function(Uri uri) openUrl,
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
