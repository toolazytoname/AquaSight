import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _loadingLabelKey = Key('timeline-loading-label');
const _emptyLabelKey = Key('timeline-empty-label');

void main() {
  testWidgets(
      'first-load 加载中… uses bodyMedium + onSurfaceVariant',
      (tester) async {
    await _pumpDelayedLoad(tester);

    expect(find.byKey(_loadingLabelKey), findsOneWidget);
    final loadingFinder = find.byKey(_loadingLabelKey);
    final loading = tester.widget<Text>(loadingFinder);
    expect(loading.data, '加载中…');

    final theme = Theme.of(tester.element(loadingFinder));
    expect(loading.style!.color, theme.colorScheme.onSurfaceVariant);
    expect(
      loading.style!.fontSize,
      theme.textTheme.bodyMedium!.fontSize,
    );

    await tester.pumpAndSettle();
    expect(find.byKey(_loadingLabelKey), findsNothing);
  });

  testWidgets(
      'true-empty 暂无事件 uses titleLarge + onSurface',
      (tester) async {
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
    final emptyFinder = find.byKey(_emptyLabelKey);
    final empty = tester.widget<Text>(emptyFinder);
    expect(empty.data, '暂无事件');

    final theme = Theme.of(tester.element(emptyFinder));
    expect(empty.style!.color, theme.colorScheme.onSurface);
    expect(
      empty.style!.fontSize,
      theme.textTheme.titleLarge!.fontSize,
    );
  });
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
