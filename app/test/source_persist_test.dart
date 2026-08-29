import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _hnKey = Key('source-filter-Hacker News');
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'memory(Hacker News) first settled frame selects that chip, not 全部',
      (tester) async {
    await _pumpApp(
      tester,
      repository: EventsRepository.fromJsonString(_fixtureWithHackerNews()),
      sourceFilter: SourceFilterStore.memory('Hacker News'),
    );

    expect(_chip(tester, _hnKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('missing file selects 全部', (tester) async {
    final docs = await Directory.systemTemp.createTemp('aquasight-source-miss-');
    addTearDown(() => docs.delete(recursive: true));
    await _pumpApp(
      tester,
      sourceFilter: SourceFilterStore(
        loadValue: () => loadSourceFilter(docs),
        saveValue: (next) => saveSourceFilter(next, docs),
      ),
    );

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets('illegal parse selects 全部', (tester) async {
    final docs = await Directory.systemTemp.createTemp('aquasight-source-bad-');
    addTearDown(() => docs.delete(recursive: true));
    final dest = File('${docs.path}/$sourceFilterRelativePath');
    await dest.parent.create(recursive: true);
    await dest.writeAsString('{not-json');
    await _pumpApp(
      tester,
      sourceFilter: SourceFilterStore(
        loadValue: () => loadSourceFilter(docs),
        saveValue: (next) => saveSourceFilter(next, docs),
      ),
    );

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
  });

  testWidgets(
      'tap a chip before hung load finishes: UI and store keep the tap',
      (tester) async {
    final hang = Completer<void>();
    final saved = <String?>[];
    final store = _hangableStore(
      seed: 'Hacker News',
      hang: hang,
      saved: saved,
    );

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: store,
      ),
    );
    await tester.pump();
    expect(find.byKey(_weiboKey), findsOneWidget);
    expect(_chip(tester, _allKey).selected, isTrue);

    await _tapChip(tester, _weiboKey);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(saved, ['weibo']);

    hang.complete();
    await tester.pumpAndSettle();

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(saved, ['weibo']);
    expect(store.value, 'weibo');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
  });

  testWidgets('tap 全部 saves null; a new TimelinePage with the same store is 全部',
      (tester) async {
    final saved = <String?>[];
    var stored = 'weibo';
    final store = SourceFilterStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        saved.add(next);
        stored = next;
      },
    );
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());

    await _pumpApp(tester, repository: repo, sourceFilter: store);
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);

    await _tapChip(tester, _allKey);
    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(saved, [null]);
    expect(store.value, isNull);

    await tester.pumpWidget(const SizedBox());
    await _pumpApp(tester, repository: repo, sourceFilter: store);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(store.value, isNull);
  });

  testWidgets(
      'persisted name missing from the file keeps the filter and 暂无该来源',
      (tester) async {
    await _pumpApp(
      tester,
      sourceFilter: SourceFilterStore.memory('Hacker News'),
    );

    expect(find.byKey(_hnKey), findsNothing);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(find.byKey(const Key('timeline-empty')), findsOneWidget);
    expect(find.text('暂无该来源'), findsOneWidget);
    expect(find.text('暂无未读'), findsNothing);
    expect(find.text('暂无事件'), findsNothing);
    expect(find.byKey(_breakingKey), findsNothing);
  });

  test('parseSourceFilter rejects missing, non-string, blank, and null JSON',
      () {
    expect(parseSourceFilter('{not-json'), isNull);
    expect(parseSourceFilter('null'), isNull);
    expect(parseSourceFilter('1'), isNull);
    expect(parseSourceFilter('[]'), isNull);
    expect(parseSourceFilter('true'), isNull);
    expect(parseSourceFilter('""'), isNull);
    expect(parseSourceFilter('"   "'), isNull);
    expect(parseSourceFilter('"Hacker News"'), 'Hacker News');
    expect(parseSourceFilter('"  weibo  "'), 'weibo');
  });

  test('in-flight load keeps the last save instead of a stale disk value',
      () async {
    final hang = Completer<String?>();
    final store = SourceFilterStore(
      loadValue: () => hang.future,
      saveValue: (_) async {},
    );
    final pending = store.load();
    await store.save('weibo');
    hang.complete('Hacker News');
    expect(await pending, 'weibo');
    expect(store.value, 'weibo');
  });
}

/// In-flight [loadValue] returns the original [seed], even if [save] ran.
SourceFilterStore _hangableStore({
  required String? seed,
  required Completer<void> hang,
  required List<String?> saved,
}) {
  return SourceFilterStore(
    loadValue: () async {
      await hang.future;
      return seed;
    },
    saveValue: (next) async => saved.add(next),
  );
}

String _fixtureWithHackerNews() {
  final raw = loadFixtureJson();
  for (final row in raw['items'] as List) {
    if (row is Map && row['source'] == 'hn') {
      row['source'] = 'Hacker News';
    }
  }
  return jsonEncode(raw);
}

Future<void> _pumpApp(
  WidgetTester tester, {
  EventsRepository? repository,
  required SourceFilterStore sourceFilter,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilter,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tapChip(WidgetTester tester, Key key) async {
  await tester.ensureVisible(find.byKey(key));
  await tester.tap(find.byKey(key));
  await tester.pumpAndSettle();
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
