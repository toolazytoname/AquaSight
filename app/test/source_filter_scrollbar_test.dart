import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _scrollbarKey = Key('source-filter-scrollbar');
const _scrollKey = Key('source-filter-scroll');
const _allKey = Key('source-filter-all');

void main() {
  testWidgets(
      'source-filter-scroll is wrapped in Scrollbar with shared controller',
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

    expect(find.byKey(_scrollbarKey), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_scrollbarKey),
        matching: find.byKey(_scrollKey),
      ),
      findsOneWidget,
    );

    final scroll = tester.widget<SingleChildScrollView>(find.byKey(_scrollKey));
    expect(scroll.scrollDirection, Axis.horizontal);

    final scrollbar = tester.widget<Scrollbar>(find.byKey(_scrollbarKey));
    expect(scrollbar.controller, isNotNull);
    expect(scroll.controller, isNotNull);
    expect(scrollbar.controller, same(scroll.controller));

    expect(
      find.descendant(
        of: find.byKey(_scrollbarKey),
        matching: find.byKey(_allKey),
      ),
      findsNothing,
    );
    expect(find.byKey(_allKey), findsOneWidget);
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
