import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _bannerKey = Key('offline-banner');
const _searchKey = Key('timeline-search');
const _errorKey = Key('timeline-error');
const _retryKey = Key('timeline-error-retry');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'tap offline-banner while search focused unfocuses and retries loadLive',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('HTTP 503');
            return loadFixtureBytes();
          },
          loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsOneWidget);
    expect(find.text('离线缓存 · 点按刷新'), findsOneWidget);
    expect(find.byTooltip('点按刷新'), findsOneWidget);
    expect(loads, 1);

    await tester.tap(find.byKey(_searchKey));
    await tester.pumpAndSettle();
    expect(_searchHasFocus(tester), isTrue);

    await tester.tap(find.byKey(_bannerKey));
    await tester.pumpAndSettle();

    expect(_searchHasFocus(tester), isFalse);
    final primary = FocusManager.instance.primaryFocus;
    expect(primary == null || primary is FocusScopeNode, isTrue);
    expect(identical(primary, _searchFocusNode(tester)), isFalse);
    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets(
      'timeline-error-retry with no search field reloads without exploding',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('网络不可用');
            return loadFixtureBytes();
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_retryKey), findsOneWidget);
    expect(find.byKey(_searchKey), findsNothing);
    expect(loads, 1);

    await tester.tap(find.byKey(_retryKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_errorKey), findsNothing);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_searchKey), findsOneWidget);
  });

  testWidgets(
      'T68: live fail + cache still shows 离线缓存 with 点按刷新 tooltip',
      (tester) async {
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async => throw EventsLoadException('HTTP 503'),
          loadCache: () async => loadFixtureBytes(),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsOneWidget);
    expect(find.text('离线缓存 · 点按刷新'), findsOneWidget);
    expect(find.byTooltip('点按刷新'), findsOneWidget);
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
