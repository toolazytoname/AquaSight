import 'dart:convert';
import 'dart:io';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _scrollKey = Key('timeline-scroll');

void main() {
  testWidgets('memory(120) + fixture restores timeline-scroll near 120',
      (tester) async {
    await _pumpFixture(
      tester,
      scrollOffset: ScrollOffsetStore.memory(120),
    );

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
  });

  testWidgets('drag then ScrollEnd writes offset; new AquaApp stays near it',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    final store = ScrollOffsetStore.memory(0);
    await _pumpFixture(tester, scrollOffset: store);

    expect(store.value, 0);
    await tester.drag(find.byKey(_scrollKey), const Offset(0, -280));
    await tester.pumpAndSettle();

    expect(store.value, greaterThan(0));
    final saved = store.value;

    await _pumpFixture(tester, scrollOffset: store);
    expect((_scrollPixels(tester) - saved).abs(), lessThanOrEqualTo(2));
  });

  testWidgets('memory(99999) clamps to maxScrollExtent and does not crash',
      (tester) async {
    await _pumpFixture(
      tester,
      scrollOffset: ScrollOffsetStore.memory(99999),
    );

    expect(find.byKey(_scrollKey), findsOneWidget);
    final pixels = _scrollPixels(tester);
    final max = _scrollMax(tester);
    expect(pixels, lessThanOrEqualTo(max));
    expect(pixels, closeTo(max, 1));
  });

  testWidgets('error list has no timeline-scroll and does not write 0',
      (tester) async {
    final store = ScrollOffsetStore.memory(120);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => throw EventsLoadException('网络不可用'),
          loadFallback: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: store,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-error')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsNothing);
    expect(store.value, 120);
  });

  testWidgets('empty list has no timeline-scroll and does not write 0',
      (tester) async {
    final store = ScrollOffsetStore.memory(120);
    final raw = loadFixtureJson();
    raw['items'] = [];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: store,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.byKey(_scrollKey), findsNothing);
    expect(store.value, 120);
  });

  testWidgets('new feed updatedAt does not reset a restored offset',
      (tester) async {
    var loads = 0;
    final store = ScrollOffsetStore.memory(120);
    final repo = EventsRepository(
      loadLive: () async {
        loads++;
        final raw = loadFixtureJson();
        raw['updatedAt'] =
            loads == 1 ? '2026-08-26T01:00:00.000Z' : '2026-08-26T03:00:00.000Z';
        return jsonEncode(raw);
      },
    );

    await tester.pumpWidget(
      AquaApp(
        repository: repo,
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: store,
      ),
    );
    await tester.pumpAndSettle();
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;

    expect(loads, 2);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(store.value, 120);
  });

  test('default cache IO writes a JSON number under aquasight/scroll_offset.json',
      () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-scroll-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadScrollOffset(docs), 0);
    await saveScrollOffset(120, docs);
    final dest = File('${docs.path}/$scrollOffsetRelativePath');
    expect(dest.path, endsWith('/aquasight/scroll_offset.json'));
    expect(scrollOffsetRelativePath, 'aquasight/scroll_offset.json');
    expect(await dest.exists(), isTrue);
    expect(jsonDecode(await dest.readAsString()), 120);
    expect(await File('${dest.path}.tmp').exists(), isFalse);
    expect(await loadScrollOffset(docs), 120);
  });

  test('missing, corrupt, or negative scroll_offset file loads as 0', () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-scroll-bad-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadScrollOffset(docs), 0);
    final dest = File('${docs.path}/$scrollOffsetRelativePath');
    await dest.parent.create(recursive: true);
    await dest.writeAsString('{not-json');
    expect(await loadScrollOffset(docs), 0);
    await dest.writeAsString('"120"');
    expect(await loadScrollOffset(docs), 0);
    await dest.writeAsString('[]');
    expect(await loadScrollOffset(docs), 0);
    await dest.writeAsString('-8');
    expect(await loadScrollOffset(docs), 0);
  });

  test('save swallows IO errors and keeps the in-memory value', () async {
    final store = ScrollOffsetStore(
      loadValue: () async => 0,
      saveValue: (_) async => throw StateError('disk full'),
    );
    await store.save(88);
    expect(store.value, 88);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required ScrollOffsetStore scrollOffset,
  EventsRepository? repository,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: scrollOffset,
    ),
  );
  await tester.pumpAndSettle();
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<SingleChildScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
}

double _scrollMax(WidgetTester tester) {
  return tester
      .widget<SingleChildScrollView>(find.byKey(_scrollKey))
      .controller!
      .position
      .maxScrollExtent;
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
