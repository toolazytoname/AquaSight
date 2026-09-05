import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _showAllKey = Key('timeline-empty-show-all');

void main() {
  testWidgets(
      'timeline-empty-show-all TextButton elevation is 0; min 48×48; radius 8',
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
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), 'zzz-no-match');
    await tester.pumpAndSettle();

    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(tester.widget(find.byKey(_showAllKey)), isA<TextButton>());

    final button = tester.widget<TextButton>(find.byKey(_showAllKey));
    expect(button.style!.elevation!.resolve({}), 0);

    final minimumSize = button.style!.minimumSize!.resolve({});
    expect(
      minimumSize,
      const Size(kMinInteractiveDimension, kMinInteractiveDimension),
    );
    expect(minimumSize, const Size(48, 48));

    final shape = button.style!.shape!.resolve({});
    expect(shape, isA<RoundedRectangleBorder>());
    expect(
      (shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
