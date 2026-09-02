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
      'timeline-search disabledBorder is OutlineInputBorder radius 8 scheme.outlineVariant',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpDefault(tester);

    final finder = find.byKey(const Key('timeline-search'));
    expect(finder, findsOneWidget);

    final field = tester.widget<TextField>(finder);
    final decoration = field.decoration!;
    final scheme = Theme.of(tester.element(finder)).colorScheme;

    final disabledBorder = decoration.disabledBorder;
    expect(disabledBorder, isA<OutlineInputBorder>());
    final disabledOutline = disabledBorder! as OutlineInputBorder;
    expect(disabledOutline.borderRadius, BorderRadius.circular(8));
    expect(disabledOutline.borderSide.color, scheme.outlineVariant);

    final enabledBorder = decoration.enabledBorder;
    expect(enabledBorder, isA<OutlineInputBorder>());
    final enabledOutline = enabledBorder! as OutlineInputBorder;
    expect(enabledOutline.borderRadius, BorderRadius.circular(8));
    expect(enabledOutline.borderSide.color, scheme.outline);

    final focusedErrorBorder = decoration.focusedErrorBorder;
    expect(focusedErrorBorder, isA<OutlineInputBorder>());
    final focusedErrorOutline = focusedErrorBorder! as OutlineInputBorder;
    expect(focusedErrorOutline.borderRadius, BorderRadius.circular(8));
    expect(focusedErrorOutline.borderSide.color, scheme.error);
    expect(focusedErrorOutline.borderSide.width, 2);

    expect(field.enabled, isTrue);
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
