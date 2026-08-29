import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'RefreshIndicator.show while search focused unfocuses and reloads',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            return loadFixtureBytes();
          },
          loadCache: () async => null,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_searchKey), findsOneWidget);

    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(loads, 2);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });
}

Widget _app(EventsRepository repository) {
  return AquaApp(
    repository: repository,
    openUrl: _forbidLaunch,
    shareEvent: _forbidShare,
    readStore: ReadStore.memory(),
    unreadOnlyStore: UnreadOnlyStore.memory(),
    scrollOffsetStore: ScrollOffsetStore.memory(),
    sourceFilterStore: SourceFilterStore.memory(),
  );
}

FocusNode _searchFocusNode(WidgetTester tester) {
  return tester
      .widget<EditableText>(
        find.descendant(
          of: find.byKey(_searchKey),
          matching: find.byType(EditableText),
        ),
      )
      .focusNode;
}

bool _searchHasFocus(WidgetTester tester) {
  return _searchFocusNode(tester).hasFocus;
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
