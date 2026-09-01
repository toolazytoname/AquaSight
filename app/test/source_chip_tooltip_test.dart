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

const _weiboChipKey = Key('event-card-same-day-breaking-source-weibo');

void main() {
  testWidgets(
      'weibo source chip has 筛选此来源 tooltip; no Semantics label; key stays on GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpBreaking(tester);

    expect(find.byTooltip('筛选此来源'), findsOneWidget);
    expect(find.byKey(_weiboChipKey), findsOneWidget);
    expect(
      tester.widget<GestureDetector>(find.byKey(_weiboChipKey)),
      isA<GestureDetector>(),
    );
    expect(
      find.descendant(
        of: find.byTooltip('筛选此来源'),
        matching: find.byKey(_weiboChipKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('筛选此来源'), findsNothing);
    expect(_tooltipSemantics('筛选此来源'), findsOne);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpBreaking(WidgetTester tester) async {
  final raw = loadFixtureJson();
  final item = (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
        (row) => row['id'] == 'same-day-breaking',
      );
  item['sources'] = [
    (item['sources'] as List).cast<Map<String, dynamic>>().firstWhere(
          (source) => source['source'] == 'weibo',
        ),
  ];
  raw['items'] = [item];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: (_) async {},
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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
