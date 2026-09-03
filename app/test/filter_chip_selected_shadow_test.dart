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
      'source FilterChip selectedShadowColor is transparent; shadowColor transparent; surfaceTintColor transparent; elevation 0; pressElevation 0; shape radius 8',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(tester);

    await tester.ensureVisible(find.byKey(_weiboKey));

    final allChip = tester.widget<FilterChip>(find.byKey(_allKey));
    _expectSelectedShadowTransparent(tester, allChip);
    expect(allChip.shadowColor, Colors.transparent);
    expect(allChip.surfaceTintColor, Colors.transparent);
    expect(allChip.elevation, 0);
    expect(allChip.pressElevation, 0);
    expect(allChip.shape, isA<RoundedRectangleBorder>());
    expect(
      (allChip.shape as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );

    final weiboChip = tester.widget<FilterChip>(find.byKey(_weiboKey));
    _expectSelectedShadowTransparent(tester, weiboChip);
    expect(weiboChip.shadowColor, Colors.transparent);
    expect(weiboChip.surfaceTintColor, Colors.transparent);
    expect(weiboChip.elevation, 0);
    expect(weiboChip.pressElevation, 0);
    expect(weiboChip.shape, isA<RoundedRectangleBorder>());
    expect(
      (weiboChip.shape as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
  });
}

void _expectSelectedShadowTransparent(WidgetTester tester, FilterChip chip) {
  if (chip.selectedShadowColor != null) {
    expect(chip.selectedShadowColor, Colors.transparent);
  } else {
    expect(
      Theme.of(tester.element(find.byWidget(chip))).chipTheme.selectedShadowColor,
      Colors.transparent,
    );
  }
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpDefault(WidgetTester tester) async {
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
