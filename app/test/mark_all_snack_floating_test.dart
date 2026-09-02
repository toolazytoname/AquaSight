import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _snackKey = Key('mark-all-read-snackbar');
const _undoKey = Key('mark-all-undo');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _listAlignedMargin = EdgeInsets.fromLTRB(16, 8, 16, 16);

void main() {
  testWidgets(
      'mark-all-read-snackbar is floating with elevation 3',
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
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_snackKey), findsOneWidget);
    expect(find.byKey(_undoKey), findsOneWidget);

    final snack = tester.widget<SnackBar>(find.byKey(_snackKey));
    expect(snack.behavior, SnackBarBehavior.floating);
    expect(snack.elevation, 3);
    expect(snack.margin, _listAlignedMargin);
    final shape = snack.shape as RoundedRectangleBorder;
    expect(shape.borderRadius, BorderRadius.circular(8));

    expect(find.byKey(_undoKey), findsOneWidget);
    expect(snack.action, isA<SnackBarAction>());
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
