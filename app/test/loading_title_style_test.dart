import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _loadingLabelKey = Key('timeline-loading-label');
const _spinnerKey = Key('timeline-loading-spinner');

void main() {
  testWidgets(
      'first-load 加载中… uses titleLarge + onSurface; spinner stays 48',
      (tester) async {
    await _pumpDelayedLoad(tester);

    expect(find.byKey(_loadingLabelKey), findsOneWidget);
    final loadingFinder = find.byKey(_loadingLabelKey);
    final loading = tester.widget<Text>(loadingFinder);
    expect(loading.data, '加载中…');

    final theme = Theme.of(tester.element(loadingFinder));
    expect(loading.style!.color, theme.colorScheme.onSurface);
    expect(
      loading.style!.fontSize,
      theme.textTheme.titleLarge!.fontSize,
    );
    expect(loading.style!.color, isNot(theme.colorScheme.onSurfaceVariant));

    expect(find.byKey(_spinnerKey), findsOneWidget);
    expect(tester.getSize(find.byKey(_spinnerKey)), const Size(48, 48));

    await tester.pumpAndSettle();
    expect(find.byKey(_loadingLabelKey), findsNothing);
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
