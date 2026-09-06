import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _openErrorSnackKey = Key('open-error-snackbar');
const _openErrorCopyKey = Key('open-error-copy');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'open-error-snackbar surfaceTintColor is transparent; shadowColor still transparent; 复制 and 无法打开 stay',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpBreaking(
      tester,
      openUrl: (_) async => throw StateError('opener failed'),
      shareEvent: _forbidShare,
    );

    // Card center on 390×800 hits source chips. Title row still opens.
    await _tapCardToOpen(tester);
    await tester.pumpAndSettle();

    final snackFinder = find.byKey(_openErrorSnackKey);
    expect(snackFinder, findsOneWidget);
    expect(find.byKey(_openErrorCopyKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);

    final snack = tester.widget<SnackBar>(snackFinder);
    expect((snack as dynamic).surfaceTintColor, Colors.transparent);
    expect((snack as dynamic).shadowColor, Colors.transparent);

    final localTheme = tester.widget<Theme>(
      find.descendant(of: snackFinder, matching: find.byType(Theme)).first,
    );
    expect(localTheme.data.colorScheme.surfaceTint, Colors.transparent);
    expect(localTheme.data.shadowColor, Colors.transparent);
    expect(localTheme.data.colorScheme.shadow, Colors.transparent);

    final materialFinder =
        find.descendant(of: snackFinder, matching: find.byType(Material)).first;
    expect(
      Theme.of(tester.element(materialFinder)).colorScheme.surfaceTint,
      Colors.transparent,
    );
    expect(
      Theme.of(tester.element(materialFinder)).shadowColor,
      Colors.transparent,
    );
    expect(
      Theme.of(tester.element(materialFinder)).colorScheme.shadow,
      Colors.transparent,
    );
  });
}

/// Card center on 390×800 hits source chips. Title row still reaches InkWell.
Future<void> _tapCardToOpen(WidgetTester tester) async {
  expect(find.byKey(_breakingKey), findsOneWidget);
  final rect = tester.getRect(find.byKey(_breakingKey));
  await tester.tapAt(Offset(rect.center.dx, rect.top + 20));
}

Future<void> _pumpBreaking(
  WidgetTester tester, {
  required OpenUrl openUrl,
  required ShareEvent shareEvent,
}) async {
  final raw = loadFixtureJson();
  raw['items'] = [
    (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
          (item) => item['id'] == 'same-day-breaking',
        ),
  ];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: openUrl,
      shareEvent: shareEvent,
      copyText: (_) async {},
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
