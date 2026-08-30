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
const _emptyKey = Key('timeline-empty');
const _emptyIconKey = Key('timeline-empty-icon');
const _filteredEmptyIconKey = Key('timeline-filtered-empty-icon');
const _emptyLabelKey = Key('timeline-empty-label');
const _showAllKey = Key('timeline-empty-show-all');
const _searchKey = Key('timeline-search');

void main() {
  testWidgets(
      'title search filtered-empty shows filter_alt_off above copy',
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
    expect(find.byKey(_filteredEmptyIconKey), findsOneWidget);
    expect(find.byKey(_emptyLabelKey), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(find.byKey(_emptyIconKey), findsNothing);

    final icon = tester.widget<Icon>(find.byKey(_filteredEmptyIconKey));
    expect(icon.icon, Icons.filter_alt_off);
    expect(icon.size, 48);
    final scheme =
        Theme.of(tester.element(find.byKey(_filteredEmptyIconKey))).colorScheme;
    expect(icon.color, scheme.onSurfaceVariant);

    expect(
      tester.getTopLeft(find.byKey(_filteredEmptyIconKey)).dy,
      lessThan(tester.getTopLeft(find.byKey(_emptyLabelKey)).dy),
    );
  });

  testWidgets(
      'true-empty has inbox icon and no filtered-empty icon',
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
    expect(find.byKey(_filteredEmptyIconKey), findsNothing);
  });

  testWidgets(
      'first-load fail has no timeline-filtered-empty-icon',
      (tester) async {
    _phoneWindow(tester);

    await _pumpError(tester);

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_filteredEmptyIconKey), findsNothing);
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
