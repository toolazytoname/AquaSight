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
const _exitSnackKey = Key('exit-confirm-snackbar');
const _breakingKey = Key('event-card-same-day-breaking');
const _normalHighScoreKey = Key('event-card-same-day-normal-high-score');

void main() {
  testWidgets('idle handlePopRoute arms exit-confirm', (tester) async {
    await _pumpApp(tester);

    await tester.binding.handlePopRoute();
    await tester.pumpAndSettle();

    expect(find.byKey(_exitSnackKey), findsOneWidget);
    expect(find.text('再按一次退出'), findsOneWidget);
    expect(_popScope(tester).canPop, isTrue);
  });

  testWidgets(
    'search focus disarms; unfocus stays disarmed; next idle back re-prompts',
    (tester) async {
      await _pumpApp(tester);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_popScope(tester).canPop, isTrue);

      await tester.tap(find.byKey(_searchKey));
      await tester.pumpAndSettle();
      expect(_searchField(tester).controller!.text, isEmpty);
      expect(_popScope(tester).canPop, isFalse);

      await tester.tap(find.text('鸭先知'));
      await tester.pumpAndSettle();
      expect(_popScope(tester).canPop, isFalse);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(find.byKey(_exitSnackKey), findsOneWidget);
      expect(find.text('再按一次退出'), findsOneWidget);
      expect(find.text('鸭先知'), findsOneWidget);
    },
  );

  testWidgets(
    'typing a filter after idle arm disarms; back clears search, page stays',
    (tester) async {
      await _pumpApp(tester);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(_popScope(tester).canPop, isTrue);

      await tester.enterText(find.byKey(_searchKey), '破圈');
      await tester.pumpAndSettle();
      expect(find.byKey(_breakingKey), findsOneWidget);
      expect(find.byKey(_normalHighScoreKey), findsNothing);
      expect(_popScope(tester).canPop, isFalse);

      // enterText focuses the field. Dismiss so this pop clears filters (T112).
      await tester.tap(find.text('鸭先知'));
      await tester.pumpAndSettle();

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();

      expect(_searchField(tester).controller!.text, isEmpty);
      expect(find.byKey(_normalHighScoreKey), findsOneWidget);
      expect(find.text('鸭先知'), findsOneWidget);
    },
  );
}

Future<void> _pumpApp(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => loadFixtureBytes(),
        loadCache: () async => throw StateError('must not read cache'),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

PopScope<Object?> _popScope(WidgetTester tester) {
  return tester.widget<PopScope<Object?>>(find.byType(PopScope));
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
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
