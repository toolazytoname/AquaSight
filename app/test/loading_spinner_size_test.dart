import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _spinnerKey = Key('timeline-loading-spinner');
const _loadingLabelKey = Key('timeline-loading-label');
const _scrollKey = Key('timeline-scroll');

void main() {
  testWidgets(
      'first-load spinner is 48×48 primary and sits above 加载中…',
      (tester) async {
    await _pumpDelayedLoad(tester);

    expect(find.byKey(_spinnerKey), findsOneWidget);
    expect(tester.getSize(find.byKey(_spinnerKey)), const Size(48, 48));

    final spinner = tester.widget<CircularProgressIndicator>(
      find.byKey(_spinnerKey),
    );
    final scheme = Theme.of(tester.element(find.byKey(_spinnerKey))).colorScheme;
    expect(spinner.color, scheme.primary);

    expect(
      tester.getTopLeft(find.byKey(_spinnerKey)).dy,
      lessThan(tester.getTopLeft(find.byKey(_loadingLabelKey)).dy),
    );

    await tester.pumpAndSettle();
    expect(find.byKey(_spinnerKey), findsNothing);
  });

  testWidgets(
      'successful list page has no timeline-loading-spinner',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect(find.byKey(_spinnerKey), findsNothing);
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
