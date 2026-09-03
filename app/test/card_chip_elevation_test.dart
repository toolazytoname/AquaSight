import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _weiboChipKey = Key('event-card-same-day-breaking-source-weibo');

void main() {
  testWidgets(
      'event-card-same-day-breaking-source-weibo Chip elevation is 0; pressElevation 0; InkWell splash/hover/border stay',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpBreaking(tester);

    final hitFinder = find.byKey(_weiboChipKey);
    expect(hitFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(hitFinder);
    final scheme = Theme.of(tester.element(hitFinder)).colorScheme;

    final chipFinder = find.descendant(of: hitFinder, matching: find.byType(Chip));
    final chip = tester.widget<Chip>(chipFinder);
    expect(Theme.of(tester.element(chipFinder)).chipTheme.elevation, 0);
    expect(Theme.of(tester.element(chipFinder)).chipTheme.pressElevation, 0);
    expect(chip.elevation, 0);
    expect(chip.shape, isA<RoundedRectangleBorder>());
    expect(
      (chip.shape as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );

    expect(inkWell.customBorder, isA<RoundedRectangleBorder>());
    expect(
      (inkWell.customBorder! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.hoverColor, scheme.primary.withValues(alpha: 0.08));
  });
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
