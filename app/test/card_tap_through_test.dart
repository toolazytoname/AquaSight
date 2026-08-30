import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _titleKey = Key('event-card-same-day-breaking-title');
const _hostKey = Key('event-card-same-day-breaking-host');
const _reasonKey = Key('event-card-same-day-breaking-reason');
const _reason = 'hard impact keyword';
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'title and host GestureDetectors keep long-press only; reason has no detector',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpDefault(tester, openUrl: _forbidLaunch);

    final titleDetector = _nearestGestureDetector(tester, _titleKey);
    expect(titleDetector.onTap, isNull);
    expect(titleDetector.onLongPress, isNotNull);

    final hostDetector = _nearestGestureDetector(tester, _hostKey);
    expect(hostDetector.onTap, isNull);
    expect(hostDetector.onLongPress, isNotNull);

    // InkWell's internal GestureDetector is still an ancestor; the reason
    // subtree itself must stay Tooltip > Text with no detector in between.
    expect(
      find.descendant(
        of: find.byTooltip(_reason),
        matching: find.byType(GestureDetector),
      ),
      findsNothing,
    );
    expect(find.byTooltip(_reason), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip(_reason),
        matching: find.byKey(_reasonKey),
      ),
      findsOneWidget,
    );
    final reasonTooltip = tester.widget<Tooltip>(
      find
          .ancestor(
            of: find.byKey(_reasonKey),
            matching: find.byType(Tooltip),
          )
          .first,
    );
    expect(reasonTooltip.message, _reason);
  });

  testWidgets('tap title hits card InkWell and opens url once', (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final opened = <Uri>[];
    await _pumpDefault(tester, openUrl: (uri) async => opened.add(uri));

    await tester.tap(find.byKey(_titleKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(opened, hasLength(1));
  });
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
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl,
      shareEvent: _forbidShare,
      copyText: _forbidCopy,
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
