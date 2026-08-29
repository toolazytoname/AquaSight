import 'dart:async';
import 'dart:io';

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
const _clearKey = Key('timeline-search-clear');
const _showAllKey = Key('timeline-empty-show-all');
const _breakingKey = Key('event-card-same-day-breaking');
const _englishKey = Key('event-card-missing-title-zh');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets(
      'memory(破圈) first settled frame filters to 同日破圈',
      (tester) async {
    await _pumpApp(
      tester,
      titleSearch: TitleSearchStore.memory('破圈'),
    );

    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);
    expect(find.byKey(_englishKey), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
    expect(find.byKey(const Key('timeline-error')), findsNothing);
  });

  testWidgets('missing file / illegal parse leaves search empty', (tester) async {
    await _pumpApp(tester, titleSearch: TitleSearchStore.memory());
    expect(_searchField(tester).controller!.text, isEmpty);
    _expectAllFixtureCards();

    await tester.pumpWidget(const SizedBox());
    await _pumpApp(
      tester,
      titleSearch: TitleSearchStore(
        loadValue: () async => parseTitleSearch('{not-json'),
        saveValue: (_) async {},
      ),
    );
    expect(_searchField(tester).controller!.text, isEmpty);
    _expectAllFixtureCards();

    await tester.pumpWidget(const SizedBox());
    await _pumpApp(
      tester,
      titleSearch: TitleSearchStore(
        loadValue: () async => parseTitleSearch('null'),
        saveValue: (_) async {},
      ),
    );
    expect(_searchField(tester).controller!.text, isEmpty);
    _expectAllFixtureCards();

    await tester.pumpWidget(const SizedBox());
    await _pumpApp(
      tester,
      titleSearch: TitleSearchStore(
        loadValue: () async => parseTitleSearch('1'),
        saveValue: (_) async {},
      ),
    );
    expect(_searchField(tester).controller!.text, isEmpty);
    _expectAllFixtureCards();
  });

  testWidgets(
      'type foo before hung load finishes: UI and store stay foo',
      (tester) async {
    final hang = Completer<void>();
    final saved = <String>[];
    final store = _hangableStore(
      seed: '破圈',
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
        sourceFilterStore: SourceFilterStore.memory(),
        titleSearchStore: store,
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(find.byKey(_searchKey), findsNothing);

    await store.save('foo');
    expect(store.value, 'foo');
    expect(saved, ['foo']);

    hang.complete();
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'foo');
    expect(saved, ['foo']);
    expect(store.value, 'foo');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_englishKey), findsNothing);
  });

  testWidgets(
      'tap timeline-search-clear saves empty; a new TimelinePage is unfiltered',
      (tester) async {
    final saved = <String>[];
    var stored = '破圈';
    final store = TitleSearchStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        saved.add(next);
        stored = next;
      },
    );
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());

    await _pumpApp(tester, repository: repo, titleSearch: store);
    expect(_searchField(tester).controller!.text, '破圈');
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_englishKey), findsNothing);

    await tester.tap(find.byKey(_clearKey));
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(saved, ['']);
    expect(store.value, isEmpty);
    _expectAllFixtureCards();

    await tester.pumpWidget(const SizedBox());
    await _pumpApp(tester, repository: repo, titleSearch: store);

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(store.value, isEmpty);
    _expectAllFixtureCards();
  });

  testWidgets('filtered-empty 查看全部 saves empty', (tester) async {
    final saved = <String>[];
    var stored = '';
    final store = TitleSearchStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        saved.add(next);
        stored = next;
      },
    );

    await _pumpApp(tester, titleSearch: store);

    await tester.enterText(find.byKey(_searchKey), 'zzzz-nomatch');
    await tester.pumpAndSettle();
    expect(_searchField(tester).controller!.text, 'zzzz-nomatch');
    expect(find.text('没有匹配'), findsOneWidget);
    expect(find.byKey(_showAllKey), findsOneWidget);
    expect(saved, ['zzzz-nomatch']);

    await tester.tap(find.byKey(_showAllKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, isEmpty);
    expect(saved, ['zzzz-nomatch', '']);
    expect(store.value, isEmpty);
    _expectAllFixtureCards();
    expect(find.text('没有匹配'), findsNothing);
    expect(find.byKey(_showAllKey), findsNothing);
  });

  test('missing or illegal title_search file loads as empty', () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-search-io-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadTitleSearch(docs), isEmpty);
    final dest = File('${docs.path}/$titleSearchRelativePath');
    await dest.parent.create(recursive: true);
    await dest.writeAsString('{not-json');
    expect(await loadTitleSearch(docs), isEmpty);
    await dest.writeAsString('null');
    expect(await loadTitleSearch(docs), isEmpty);
    await dest.writeAsString('"   "');
    expect(await loadTitleSearch(docs), isEmpty);
    await dest.writeAsString('1');
    expect(await loadTitleSearch(docs), isEmpty);
    await saveTitleSearch('破圈', docs);
    expect(await dest.readAsString(), '"破圈"');
    expect(await loadTitleSearch(docs), '破圈');
    await saveTitleSearch('  foo  ', docs);
    expect(await dest.readAsString(), '"foo"');
    expect(await loadTitleSearch(docs), 'foo');
    await saveTitleSearch('   ', docs);
    expect(await dest.readAsString(), '""');
    expect(await loadTitleSearch(docs), isEmpty);
  });

  test('parseTitleSearch rejects missing, non-string, blank, and null JSON',
      () {
    expect(parseTitleSearch('{not-json'), isEmpty);
    expect(parseTitleSearch('null'), isEmpty);
    expect(parseTitleSearch('1'), isEmpty);
    expect(parseTitleSearch('[]'), isEmpty);
    expect(parseTitleSearch('true'), isEmpty);
    expect(parseTitleSearch('""'), isEmpty);
    expect(parseTitleSearch('"   "'), isEmpty);
    expect(parseTitleSearch('"破圈"'), '破圈');
    expect(parseTitleSearch('"  foo  "'), 'foo');
  });

  test('in-flight load keeps the last save instead of a stale disk value',
      () async {
    final hang = Completer<String>();
    final store = TitleSearchStore(
      loadValue: () => hang.future,
      saveValue: (_) async {},
    );
    final pending = store.load();
    await store.save('foo');
    hang.complete('破圈');
    expect(await pending, 'foo');
    expect(store.value, 'foo');
  });
}

/// In-flight [loadValue] returns the original [seed], even if [save] ran.
TitleSearchStore _hangableStore({
  required String seed,
  required Completer<void> hang,
  required List<String> saved,
}) {
  return TitleSearchStore(
    loadValue: () async {
      await hang.future;
      return seed;
    },
    saveValue: (next) async => saved.add(next),
  );
}

Future<void> _pumpApp(
  WidgetTester tester, {
  EventsRepository? repository,
  required TitleSearchStore titleSearch,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: titleSearch,
    ),
  );
  await tester.pumpAndSettle();
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
}

void _expectAllFixtureCards() {
  for (final id in _allFixtureIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
