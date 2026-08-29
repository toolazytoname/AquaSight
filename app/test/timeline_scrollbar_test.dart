import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _scrollKey = Key('timeline-scroll');

void main() {
  testWidgets(
      'live fixture wraps timeline-scroll in Scrollbar with shared controller',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    expect(find.byType(Scrollbar), findsOneWidget);
    expect(
      find.descendant(
        of: find.byType(Scrollbar),
        matching: find.byKey(_scrollKey),
      ),
      findsOneWidget,
    );
    expect(
      tester.widget(find.byKey(_scrollKey)),
      isA<CustomScrollView>(),
    );

    final scrollbar = tester.widget<Scrollbar>(find.byType(Scrollbar));
    final list = tester.widget<CustomScrollView>(find.byKey(_scrollKey));
    expect(scrollbar.controller, isNotNull);
    expect(list.controller, isNotNull);
    expect(scrollbar.controller, same(list.controller));

    final before = list.controller!.offset;
    await tester.drag(find.byKey(_scrollKey), const Offset(0, -280));
    await tester.pumpAndSettle();
    expect(_scrollPixels(tester), greaterThan(before));
  });

  testWidgets('error page has no timeline-scroll and no list Scrollbar',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadFallback: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsNothing);
    expect(find.byType(Scrollbar), findsNothing);
  });
}

Future<void> _pumpFixture(WidgetTester tester) async {
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
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
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
