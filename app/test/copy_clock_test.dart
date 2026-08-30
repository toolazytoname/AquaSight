import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _unknownTimeKey = Key('event-card-unknown-date-time');
const _copySnackKey = Key('copy-snackbar');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'long-press breaking time copies Tooltip.message and shows 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpDefault(
      tester,
      openUrl: _forbidLaunch,
      copyText: (text) async => copied.add(text),
    );

    final tooltip = tester.widget<Tooltip>(
      find
          .ancestor(
            of: find.byKey(_breakingTimeKey),
            matching: find.byType(Tooltip),
          )
          .first,
    );
    final expectedClock = tooltip.message!;

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(copied, [expectedClock]);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('short-press breaking time opens url and does not copy',
      (tester) async {
    _setDefaultSurface(tester);
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpDefault(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets(
      'unknown-date time has no wrapping GestureDetector with onLongPress',
      (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(
      tester,
      openUrl: _forbidLaunch,
      copyText: _forbidCopy,
    );

    expect(find.byKey(_unknownTimeKey), findsOneWidget);
    final detector = _nearestGestureDetector(tester, _unknownTimeKey);
    expect(detector.onLongPress, isNull);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

GestureDetector _nearestGestureDetector(WidgetTester tester, Key key) {
  final finder = find
      .ancestor(
        of: find.byKey(key),
        matching: find.byType(GestureDetector),
      )
      .first;
  return tester.widget<GestureDetector>(finder);
}

Future<void> _pumpDefault(
  WidgetTester tester, {
  required Future<void> Function(Uri uri) openUrl,
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl,
      shareEvent: _forbidShare,
      copyText: copyText,
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
