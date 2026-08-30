import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _errorKey = Key('timeline-error');
const _errorIconKey = Key('timeline-error-icon');
const _errorTitleKey = Key('timeline-error-title');
const _emptyKey = Key('timeline-empty');
const _emptyIconKey = Key('timeline-empty-icon');
const _emptyLabelKey = Key('timeline-empty-label');
const _showAllKey = Key('timeline-empty-show-all');
const _searchKey = Key('timeline-search');
const _loadingKey = Key('timeline-loading');

void main() {
  testWidgets(
      'first-load fail shows error_outline icon above 加载失败',
      (tester) async {
    _phoneWindow(tester);

    await _pumpError(tester);

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_errorIconKey), findsOneWidget);
    expect(find.byKey(_errorTitleKey), findsOneWidget);

    final iconFinder = find.descendant(
      of: find.byKey(_errorKey),
      matching: find.byKey(_errorIconKey),
    );
    expect(iconFinder, findsOneWidget);
    final icon = tester.widget<Icon>(iconFinder);
    expect(icon.icon, Icons.error_outline);
    expect(icon.size, 48);
    final scheme = Theme.of(tester.element(iconFinder)).colorScheme;
    expect(icon.color, scheme.error);

    final titleFinder = find.descendant(
      of: find.byKey(_errorKey),
      matching: find.byKey(_errorTitleKey),
    );
    expect(
      tester.getTopLeft(iconFinder).dy,
      lessThan(tester.getTopLeft(titleFinder).dy),
    );
  });

  testWidgets(
      'true-empty shows inbox_outlined icon above 暂无事件',
      (tester) async {
    _phoneWindow(tester);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(_emptyFixture()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_emptyIconKey), findsOneWidget);
    expect(find.byKey(_emptyLabelKey), findsOneWidget);

    final icon = tester.widget<Icon>(find.byKey(_emptyIconKey));
    expect(icon.icon, Icons.inbox_outlined);
    expect(icon.size, 48);
    final scheme = Theme.of(tester.element(find.byKey(_emptyIconKey))).colorScheme;
    expect(icon.color, scheme.onSurfaceVariant);

    expect(
      tester.getTopLeft(find.byKey(_emptyIconKey)).dy,
      lessThan(tester.getTopLeft(find.byKey(_emptyLabelKey)).dy),
    );

    final caption = tester.widget<Text>(find.byKey(_emptyLabelKey));
    expect(caption.data, '暂无事件');
    expect(caption.style!.color, scheme.onSurface);
    expect(
      caption.style!.fontSize,
      Theme.of(tester.element(find.byKey(_emptyLabelKey)))
          .textTheme
          .titleLarge!
          .fontSize,
    );
  });

  testWidgets(
      'title search filtered-empty has no timeline-empty-icon',
      (tester) async {
    _phoneWindow(tester);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
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

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(find.byKey(_emptyIconKey), findsNothing);
  });

  testWidgets(
      'first-screen loading has neither status icon',
      (tester) async {
    _phoneWindow(tester);

    await _pumpDelayedLoad(tester);

    expect(find.byKey(_loadingKey), findsOneWidget);
    expect(find.byKey(_errorIconKey), findsNothing);
    expect(find.byKey(_emptyIconKey), findsNothing);

    await tester.pumpAndSettle();
    expect(find.byKey(_loadingKey), findsNothing);
  });
}

void _phoneWindow(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpError(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => throw EventsLoadException('网络不可用'),
        loadCache: () async => throw EventsLoadException('cache'),
        loadFallback: () async => throw EventsLoadException('fallback'),
        loadAsset: () async => throw EventsLoadException('asset'),
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpDelayedLoad(WidgetTester tester) async {
  final repo = EventsRepository(
    loadLive: () => Future.delayed(
      const Duration(milliseconds: 50),
      loadFixtureBytes,
    ),
  );
  await tester.pumpWidget(
    AquaApp(
      repository: repo,
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
}

String _emptyFixture() {
  final raw = loadFixtureJson();
  raw['items'] = [];
  return jsonEncode(raw);
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
