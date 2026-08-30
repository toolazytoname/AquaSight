import 'dart:convert';

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

const _emptyLabelKey = Key('timeline-empty-label');
const _emptyIconKey = Key('timeline-empty-icon');
const _emptyRefreshKey = Key('timeline-empty-refresh');
const _searchKey = Key('timeline-search');

void main() {
  testWidgets(
      'true-empty title uses titleLarge + onSurface; icon and refresh stay',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

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

    expect(find.byKey(_emptyLabelKey), findsOneWidget);
    final titleFinder = find.byKey(_emptyLabelKey);
    final title = tester.widget<Text>(titleFinder);
    expect(title.data, '暂无事件');

    final theme = Theme.of(tester.element(titleFinder));
    expect(title.style!.color, theme.colorScheme.onSurface);
    expect(
      title.style!.fontSize,
      theme.textTheme.titleLarge!.fontSize,
    );
    expect(title.style!.color, isNot(theme.colorScheme.onSurfaceVariant));

    expect(find.byKey(_emptyIconKey), findsOneWidget);
    expect(find.byKey(_emptyRefreshKey), findsOneWidget);
  });

  testWidgets(
      'title-search filtered-empty stays bodyMedium + onSurfaceVariant',
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
    expect(
      empty.style!.fontSize,
      isNot(theme.textTheme.titleLarge!.fontSize),
    );
  });
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
