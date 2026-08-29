import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _loadingKey = Key('timeline-loading');
const _scrollKey = Key('timeline-scroll');

void main() {
  testWidgets(
      'loading page: home-indicator padding sits under timeline-loading',
      (tester) async {
    _phoneWindow(tester, bottom: 48);

    await _pumpDelayedLoad(tester);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(_loadingInset(tester).bottom, 48);
    expect(find.text('加载中…'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.byKey(_loadingKey), findsNothing);
    expect(find.byKey(_scrollKey), findsOneWidget);
  });

  testWidgets(
      'default window padding: loading inset is 0 and copy stays 加载中…',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpDelayedLoad(tester);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(_loadingInset(tester).bottom, 0);
    expect(find.text('加载中…'), findsOneWidget);

    await tester.pumpAndSettle();
    expect(find.byKey(_loadingKey), findsNothing);
    expect(find.byKey(_scrollKey), findsOneWidget);
  });
}

void _phoneWindow(WidgetTester tester, {required double bottom}) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  tester.view.padding = FakeViewPadding(bottom: bottom);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPadding);
}

EdgeInsets _loadingInset(WidgetTester tester) {
  final inset = tester.widget<Padding>(
    find.descendant(
      of: find.byKey(_loadingKey),
      matching: find.byWidgetPredicate(
        (w) => w is Padding && (w as Padding).child is Column,
      ),
    ),
  );
  return inset.padding.resolve(TextDirection.ltr);
}

Future<void> _pumpDelayedLoad(WidgetTester tester) async {
  final repo = EventsRepository(
    loadLive: () => Future.delayed(
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
