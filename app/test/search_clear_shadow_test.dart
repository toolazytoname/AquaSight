import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _clearKey = Key('timeline-search-clear');

void main() {
  testWidgets(
      'timeline-search-clear IconButton shadowColor is transparent; elevation 0; shape r8; hit ≥ 48×48',
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
        sourceFilterStore: SourceFilterStore.memory(),
        titleSearchStore: TitleSearchStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();

    final clearFinder = find.byKey(_clearKey);
    expect(clearFinder, findsOneWidget);

    final button = tester.widget<IconButton>(clearFinder);
    expect(button.style!.shadowColor!.resolve({}), Colors.transparent);
    expect(button.style!.elevation!.resolve({}), 0);

    final shape = button.style!.shape!.resolve({});
    expect(shape, isA<RoundedRectangleBorder>());
    expect(
      (shape! as RoundedRectangleBorder).borderRadius,
      const BorderRadius.all(Radius.circular(8)),
    );

    final clearSize = tester.getSize(clearFinder);
    expect(clearSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(clearSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(clearSize.width, greaterThanOrEqualTo(48));
    expect(clearSize.height, greaterThanOrEqualTo(48));
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
