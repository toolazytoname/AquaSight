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

const _shareErrorSnackKey = Key('share-error-snackbar');
const _shareErrorCopyKey = Key('share-error-copy');
const _breakingShareKey = Key('event-card-same-day-breaking-share');

void main() {
  testWidgets(
      'share-error-copy SnackBarAction overlay comes from local textButtonTheme',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      shareEvent: ({
        required title,
        required url,
        required sharePositionOrigin,
      }) async {
        throw StateError('share failed');
      },
    );

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_shareErrorSnackKey), findsOneWidget);
    expect(find.byKey(_shareErrorCopyKey), findsOneWidget);
    expect(find.text('无法分享'), findsOneWidget);

    final copyFinder = find.byKey(_shareErrorCopyKey);
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
      tester.widget<SnackBar>(find.byKey(_shareErrorSnackKey)).behavior,
      isNot(SnackBarBehavior.floating),
    );
  });
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

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
