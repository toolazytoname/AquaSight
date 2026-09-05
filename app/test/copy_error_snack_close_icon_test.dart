import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _weiboKey = Key('source-filter-weibo');
const _copyErrorSnackKey = Key('copy-error-snackbar');

void main() {
  testWidgets(
      'copy-error-snackbar closeIconColor is onInverseSurface',
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
        copyText: (_) async => throw StateError('copy failed'),
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.longPress(find.byKey(_weiboKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    final snack = tester.widget<SnackBar>(find.byKey(_copyErrorSnackKey));
    final scheme =
        Theme.of(tester.element(find.byKey(_copyErrorSnackKey))).colorScheme;
    expect(snack.closeIconColor, scheme.onInverseSurface);
    expect(snack.showCloseIcon, isTrue);
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.elevation, 3);
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
