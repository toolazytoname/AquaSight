import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _highScoreKey = Key('event-card-same-day-normal-high-score-score');
const _breakingScoreKey = Key('event-card-same-day-breaking-score');
const _unknownScoreKey = Key('event-card-unknown-date-score');
const _copySnackKey = Key('copy-snackbar');
const _highScoreUrl = 'https://example.com/normal-high';

void main() {
  testWidgets(
      'long-press high-score copies scoreLabel and shows 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpDefault(
      tester,
      openUrl: _forbidLaunch,
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_highScoreKey));
    await tester.pumpAndSettle();

    expect(copied, ['99']);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('long-press breaking score copies scoreLabel', (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpDefault(
      tester,
      openUrl: _forbidLaunch,
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_breakingScoreKey));
    await tester.pumpAndSettle();

    expect(copied, ['2']);
  });

  testWidgets('short-press score opens url and does not copy', (tester) async {
    _setDefaultSurface(tester);
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpDefault(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byKey(_highScoreKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_highScoreUrl)]);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('unknown-date has no score key', (tester) async {
    _setDefaultSurface(tester);
    await _pumpDefault(
      tester,
      openUrl: _forbidLaunch,
      copyText: _forbidCopy,
    );

    expect(find.byKey(_unknownScoreKey), findsNothing);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
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
