import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

/// Beijing 2026-08-26 10:00.
final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _todayGroupKey = Key('day-group-2026-08-26');
final _unknownGroupKey = Key('day-group-$unknownDateLabel');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');

void main() {
  testWidgets(
      'long-press day-group-2026-08-26 copies group.label and shows 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pump(tester, copyText: (text) async => copied.add(text));

    await tester.longPress(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(copied, ['2026-08-26']);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('short-press day-group-2026-08-26 does not copy', (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pump(tester, copyText: (text) async => copied.add(text));

    await tester.tap(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('long-press day-group-未知日期 copies 未知日期', (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pump(tester, copyText: (text) async => copied.add(text));

    await tester.ensureVisible(find.byKey(_unknownGroupKey));
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_unknownGroupKey));
    await tester.pumpAndSettle();

    expect(copied, [unknownDateLabel]);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('copyText throw on day-header long-press shows 无法复制',
      (tester) async {
    _setDefaultSurface(tester);
    await _pump(
      tester,
      copyText: (text) async => throw StateError('copy failed'),
    );

    await tester.longPress(find.byKey(_todayGroupKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pump(
  WidgetTester tester, {
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _fixedNow,
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
