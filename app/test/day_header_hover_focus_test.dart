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
      'day-group-2026-08-26 descendant InkWell hover/focus match highlight token',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    final materialFinder = find.byKey(_todayGroupKey);
    expect(materialFinder, findsOneWidget);

    final material = tester.widget<Material>(materialFinder);
    expect(material, isA<Material>());
    expect(material.shape, isNull);

    final inkWellFinder = find.descendant(
      of: materialFinder,
      matching: find.byType(InkWell),
    );
    expect(inkWellFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(inkWellFinder);
    final scheme = Theme.of(tester.element(inkWellFinder)).colorScheme;

    expect(inkWell.hoverColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.focusColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.customBorder, isA<RoundedRectangleBorder>());
    expect(
      (inkWell.customBorder! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(inkWell.onTap, isNotNull);
    expect(inkWell.onLongPress, isNotNull);

    final decoratedBoxFinder = find.descendant(
      of: materialFinder,
      matching: find.byType(DecoratedBox),
    );
    expect(
      tester.widgetList<DecoratedBox>(decoratedBoxFinder).any((box) {
        final decoration = box.decoration;
        if (decoration is! BoxDecoration) {
          return false;
        }
        final border = decoration.border;
        if (border is! Border) {
          return false;
        }
        return border.bottom.width == 1;
      }),
      isTrue,
    );
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
