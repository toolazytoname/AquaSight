import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _endKey = Key('timeline-end');

void main() {
  testWidgets(
      'home-indicator padding sits below the 32-tall 没有更多了 row',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(bottom: 48);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetPadding);

    await _pumpFixture(tester);

    expect(find.byKey(_endKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_endKey)).data, '没有更多了');

    final inset = tester.widget<Padding>(
      find.ancestor(
        of: find.byKey(_endKey),
        matching: find.byWidgetPredicate(
          (w) =>
              w is Padding &&
              (w as Padding).padding.resolve(TextDirection.ltr).bottom == 48,
        ),
      ),
    );
    expect(inset.padding.resolve(TextDirection.ltr).bottom, 48);

    final row = tester.widget<SizedBox>(
      find.ancestor(
        of: find.byKey(_endKey),
        matching: find.byWidgetPredicate(
          (w) => w is SizedBox && (w as SizedBox).height == 32,
        ),
      ),
    );
    expect(row.height, 32);
  });

  testWidgets(
      'default window padding: inset is 0 and copy stays 没有更多了',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpFixture(tester);

    expect(find.byKey(_endKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_endKey)).data, '没有更多了');

    final row = tester.widget<SizedBox>(
      find.ancestor(
        of: find.byKey(_endKey),
        matching: find.byWidgetPredicate(
          (w) => w is SizedBox && (w as SizedBox).height == 32,
        ),
      ),
    );
    expect(row.height, 32);

    final inset = tester.firstWidget<Padding>(
      find.ancestor(
        of: find.byWidget(row),
        matching: find.byType(Padding),
      ),
    );
    expect(inset.padding.resolve(TextDirection.ltr).bottom, 0);
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
