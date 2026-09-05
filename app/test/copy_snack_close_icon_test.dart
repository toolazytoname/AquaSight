import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'copy-snackbar closeIconColor is onInverseSurface',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: (_) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    final snack = tester.widget<SnackBar>(find.byKey(_copySnackKey));
    final scheme =
        Theme.of(tester.element(find.byKey(_copySnackKey))).colorScheme;
    expect(snack.closeIconColor, scheme.onInverseSurface);
    expect(snack.showCloseIcon, isTrue);
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.elevation, 3);
    expect(snack.duration, const Duration(seconds: 2));
  });
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
