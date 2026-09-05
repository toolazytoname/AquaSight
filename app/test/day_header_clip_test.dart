import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _now = DateTime.parse('2026-08-26T02:00:00.000Z');

const _todayGroupKey = Key('day-group-2026-08-26');

void main() {
  testWidgets(
      'day-group-2026-08-26 Material clipBehavior is antiAlias; shape r8; tint/shadow stay transparent',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    final materialFinder = find.byKey(_todayGroupKey);
    expect(materialFinder, findsOneWidget);

    final material = tester.widget<Material>(materialFinder);
    expect(material.clipBehavior, Clip.antiAlias);
    expect(material.shape, isA<RoundedRectangleBorder>());
    expect(
      (material.shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(material.surfaceTintColor, Colors.transparent);
    expect(material.shadowColor, Colors.transparent);
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: _forbidCopy,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _now,
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
  throw StateError('tests must not share ($url)');
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
