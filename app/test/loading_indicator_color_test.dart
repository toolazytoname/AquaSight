import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _loadingKey = Key('timeline-loading');

void main() {
  testWidgets(
      'first-load CircularProgressIndicator uses ColorScheme.primary',
      (tester) async {
    await _pumpDelayedLoad(tester);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(find.text('加载中…'), findsOneWidget);

    final indicatorFinder = find.descendant(
      of: find.byKey(_loadingKey),
      matching: find.byType(CircularProgressIndicator),
    );
    expect(indicatorFinder, findsOneWidget);
    final indicator = tester.widget<CircularProgressIndicator>(indicatorFinder);
    final scheme = Theme.of(tester.element(indicatorFinder)).colorScheme;
    expect(indicator.color, scheme.primary);

    await tester.pumpAndSettle();
    expect(find.byKey(_loadingKey), findsNothing);
  });
}

Future<void> _pumpDelayedLoad(WidgetTester tester) async {
  final repo = EventsRepository(
    loadLive: () => Future.delayed(
      const Duration(milliseconds: 50),
      loadFixtureBytes,
    ),
  );
  await tester.pumpWidget(
    AquaApp(
      repository: repo,
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
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
