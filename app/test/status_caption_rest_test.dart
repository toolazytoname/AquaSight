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

const _emptyLabelKey = Key('timeline-empty-label');
const _showAllKey = Key('timeline-empty-show-all');
const _searchKey = Key('timeline-search');
const _errorDetailKey = Key('timeline-error-detail');

void main() {
  testWidgets(
      'filtered-empty 没有匹配 uses bodyMedium + onSurfaceVariant',
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

    expect(find.byKey(_emptyLabelKey), findsOneWidget);
    final emptyFinder = find.byKey(_emptyLabelKey);
    final empty = tester.widget<Text>(emptyFinder);
    expect(empty.data, '没有匹配');

    final theme = Theme.of(tester.element(emptyFinder));
    expect(empty.style!.color, theme.colorScheme.onSurfaceVariant);
    expect(
      empty.style!.fontSize,
      theme.textTheme.bodyMedium!.fontSize,
    );
    expect(find.byKey(_showAllKey), findsOneWidget);
  });

  testWidgets(
      'error-page detail uses bodyMedium + onSurfaceVariant; title stays titleLarge',
      (tester) async {
    _phoneWindow(tester);

    await _pumpError(tester);

    expect(find.byKey(_errorDetailKey), findsOneWidget);
    final detailFinder = find.byKey(_errorDetailKey);
    final detail = tester.widget<Text>(detailFinder);
    final theme = Theme.of(tester.element(detailFinder));
    expect(detail.style!.color, theme.colorScheme.onSurfaceVariant);
    expect(
      detail.style!.fontSize,
      theme.textTheme.bodyMedium!.fontSize,
    );

    expect(find.text('加载失败'), findsOneWidget);
    final title = tester.widget<Text>(find.text('加载失败'));
    expect(title.key, isNot(_errorDetailKey));
    expect(
      title.style!.fontSize,
      theme.textTheme.titleLarge!.fontSize,
    );
    expect(title.style!.color, isNot(theme.colorScheme.onSurfaceVariant));
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
        loadCache: () async => null,
        loadFallback: () async => null,
        loadAsset: () async => null,
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
