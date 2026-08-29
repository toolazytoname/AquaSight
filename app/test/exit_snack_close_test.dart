import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _exitSnackKey = Key('exit-confirm-snackbar');
const _errorSnackKey = Key('feed-error-snackbar');
const _breakingKey = Key('event-card-same-day-breaking');
const _refreshFail = '刷新失败：源不可用';

void main() {
  testWidgets(
    'search tap after idle arm closes exit SnackBar immediately',
    (tester) async {
      await _pumpApp(tester);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byKey(_exitSnackKey), findsOneWidget);
      expect(find.text('再按一次退出'), findsOneWidget);
      expect(_popScope(tester).canPop, isTrue);

      await tester.tap(find.byKey(_searchKey));
      await tester.pump();

      expect(find.byKey(_exitSnackKey), findsNothing);
      expect(find.text('再按一次退出'), findsNothing);
      expect(_popScope(tester).canPop, isFalse);
      expect(find.text('鸭先知'), findsOneWidget);
    },
  );

  testWidgets(
    'timer expiry closes only the exit SnackBar',
    (tester) async {
      await _pumpApp(tester);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byKey(_exitSnackKey), findsOneWidget);

      await tester.pump(exitConfirmWindow + const Duration(milliseconds: 50));

      expect(find.byKey(_exitSnackKey), findsNothing);
      expect(find.text('再按一次退出'), findsNothing);
      expect(_popScope(tester).canPop, isFalse);
      expect(find.text('鸭先知'), findsOneWidget);
    },
  );

  testWidgets(
    'failed refresh still shows feed-error; closing exit does not hide it',
    (tester) async {
      var loads = 0;
      await tester.pumpWidget(
        AquaApp(
          repository: EventsRepository(
            loadLive: () async {
              loads++;
              if (loads == 1) return loadFixtureBytes();
              throw EventsLoadException(_refreshFail);
            },
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
      expect(loads, 1);
      expect(find.byKey(_breakingKey), findsOneWidget);
      expect(find.byKey(_errorSnackKey), findsNothing);

      await tester.binding.handlePopRoute();
      await tester.pumpAndSettle();
      expect(find.byKey(_exitSnackKey), findsOneWidget);

      final refresh = tester
          .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
          .show();
      await tester.pumpAndSettle();
      await refresh;
      expect(loads, 2);
      expect(find.byKey(_errorSnackKey), findsOneWidget);
      expect(find.text(_refreshFail), findsOneWidget);
      expect(find.byKey(_breakingKey), findsOneWidget);

      await tester.pump(exitConfirmWindow + const Duration(milliseconds: 50));

      expect(find.byKey(_exitSnackKey), findsNothing);
      expect(find.byKey(_errorSnackKey), findsOneWidget);
      expect(find.text(_refreshFail), findsOneWidget);
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
