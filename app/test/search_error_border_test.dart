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
      'timeline-search errorBorder is OutlineInputBorder radius 8 scheme.error',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpDefault(tester);

    final finder = find.byKey(const Key('timeline-search'));
    expect(finder, findsOneWidget);

    final field = tester.widget<TextField>(finder);
    final decoration = field.decoration!;
    final scheme = Theme.of(tester.element(finder)).colorScheme;

    final errorBorder = decoration.errorBorder;
    expect(errorBorder, isA<OutlineInputBorder>());
    final errorOutline = errorBorder! as OutlineInputBorder;
    expect(errorOutline.borderRadius, BorderRadius.circular(8));
    expect(errorOutline.borderSide.color, scheme.error);

    final focusedBorder = decoration.focusedBorder;
    expect(focusedBorder, isA<OutlineInputBorder>());
    final focusedOutline = focusedBorder! as OutlineInputBorder;
    expect(focusedOutline.borderRadius, BorderRadius.circular(8));
    expect(focusedOutline.borderSide.color, scheme.primary);
    expect(focusedOutline.borderSide.width, 2);

    final enabledBorder = decoration.enabledBorder;
    expect(enabledBorder, isA<OutlineInputBorder>());
    final enabledOutline = enabledBorder! as OutlineInputBorder;
    expect(enabledOutline.borderRadius, BorderRadius.circular(8));
    expect(enabledOutline.borderSide.color, scheme.outline);

    expect(decoration.errorText, isNull);
  });
}

void _setPhoneSurface(WidgetTester tester) {
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
  throw StateError('tests must not share ($url)');
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
