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
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'long-press weibo filter chip copies name and does not change filter',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpDefault(
      tester,
      copyText: (text) async => copied.add(text),
    );

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.longPress(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    expect(copied, ['weibo']);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
  });

  testWidgets('short-press weibo filter chip does not copy', (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpDefault(
      tester,
      copyText: (text) async => copied.add(text),
    );

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('long-press 全部 filter chip does not copy', (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpDefault(
      tester,
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_allKey));
    await tester.pumpAndSettle();

    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
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
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
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
