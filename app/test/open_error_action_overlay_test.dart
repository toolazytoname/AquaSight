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
      'open-error-copy SnackBarAction overlay comes from local textButtonTheme',
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

    expect(find.byKey(_openErrorSnackKey), findsOneWidget);
    expect(find.byKey(_openErrorCopyKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);

    final copyFinder = find.byKey(_openErrorCopyKey);
    final theme = Theme.of(tester.element(copyFinder));
    final scheme = theme.colorScheme;
    final overlayColor = theme.textButtonTheme.style!.overlayColor;
    expect(overlayColor, isNotNull);
    expect(
      overlayColor!.resolve(const {WidgetState.pressed}),
      scheme.primary.withValues(alpha: 0.12),
    );
    expect(
      overlayColor.resolve(const {WidgetState.hovered}),
      scheme.primary.withValues(alpha: 0.08),
    );
    expect(
      overlayColor.resolve(const {WidgetState.focused}),
      scheme.primary.withValues(alpha: 0.08),
    );
    expect(overlayColor.resolve(const {}), isNull);

    expect(
      tester.widget<SnackBar>(find.byKey(_openErrorSnackKey)).behavior,
      isNot(SnackBarBehavior.floating),
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
