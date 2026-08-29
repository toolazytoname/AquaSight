import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _toggleKey = Key('unread-only-toggle');
const _searchKey = Key('timeline-search');
const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('default injected prefs: toggle off and every fixture card is visible',
      (tester) async {
    final saved = <bool>[];
    await _pumpApp(
      tester,
      unreadOnly: UnreadOnlyStore(
        loadValue: () async => false,
        saveValue: (next) async => saved.add(next),
      ),
    );

    expect(_toggle(tester).value, isFalse);
    expect(find.byTooltip('只看未读'), findsOneWidget);
    _expectAllFixtureCards();
    expect(saved, isEmpty);
    expect(find.byKey(const Key('timeline-empty')), findsNothing);
  });

  testWidgets('toggle on writes true and survives a new AquaApp with the same store',
      (tester) async {
    final saved = <bool>[];
    var stored = false;
    final unreadOnly = UnreadOnlyStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        saved.add(next);
        stored = next;
      },
    );
    final readStore = ReadStore.memory({'same-day-breaking'});
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
    );
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_breakingReadKey), findsOneWidget);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(saved, [true]);
    expect(unreadOnly.value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
    );

    expect(_toggle(tester).value, isTrue);
    expect(saved, [true]);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('同日破圈'), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
  });

  testWidgets('toggle off writes false and a new AquaApp shows every card again',
      (tester) async {
    final saved = <bool>[];
    var stored = false;
    final unreadOnly = UnreadOnlyStore(
      loadValue: () async => stored,
      saveValue: (next) async {
        saved.add(next);
        stored = next;
      },
    );
    final readStore = ReadStore.memory({'same-day-breaking'});
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
    );
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(saved, [true]);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isFalse);
    expect(saved, [true, false]);
    _expectAllFixtureCards();

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
    );

    expect(_toggle(tester).value, isFalse);
    expect(unreadOnly.value, isFalse);
    _expectAllFixtureCards();
    expect(find.byKey(_breakingReadKey), findsOneWidget);
  });

  testWidgets('re-pump keeps unread toggle, source, and search',
      (tester) async {
    final unreadOnly = UnreadOnlyStore.memory();
    final readStore = ReadStore.memory({'same-day-breaking'});
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
    );

    await tester.enterText(find.byKey(_searchKey), 'english');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();

    expect(_searchField(tester).controller!.text, 'english');
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_toggle(tester).value, isTrue);

    await _pumpApp(
      tester,
      repository: repo,
      readStore: readStore,
      unreadOnly: unreadOnly,
    );

    expect(_searchField(tester).controller!.text, 'english');
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
    expect(_toggle(tester).value, isTrue);
    expect(unreadOnly.value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.text('暂无未读'), findsOneWidget);
    expect(find.byKey(const Key('event-card-missing-title-zh')), findsNothing);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsNothing);
  });

  testWidgets('first init loads a pre-seeded true toggle before cards paint',
      (tester) async {
    await _pumpApp(
      tester,
      readStore: ReadStore.memory({'same-day-breaking'}),
      unreadOnly: UnreadOnlyStore.memory(true),
    );

    expect(_toggle(tester).value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(const Key('event-card-same-day-normal-high-score')),
        findsOneWidget);
  });

  test('default cache IO writes a JSON boolean under aquasight/unread_only.json',
      () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-unread-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadUnreadOnly(docs), isFalse);
    await saveUnreadOnly(true, docs);
    final dest = File('${docs.path}/$unreadOnlyRelativePath');
    expect(dest.path, endsWith('/aquasight/unread_only.json'));
    expect(await dest.exists(), isTrue);
    expect(await dest.readAsString(), 'true');
    expect(jsonDecode(await dest.readAsString()), isTrue);
    expect(await File('${dest.path}.tmp').exists(), isFalse);
    expect(await loadUnreadOnly(docs), isTrue);

    await saveUnreadOnly(false, docs);
    expect(await dest.readAsString(), 'false');
    expect(await loadUnreadOnly(docs), isFalse);
  });

  test('missing, corrupt, or non-bool unread_only file loads as off', () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-unread-bad-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadUnreadOnly(docs), isFalse);
    final dest = File('${docs.path}/$unreadOnlyRelativePath');
    await dest.parent.create(recursive: true);
    await dest.writeAsString('{not-json');
    expect(await loadUnreadOnly(docs), isFalse);
    await dest.writeAsString('"true"');
    expect(await loadUnreadOnly(docs), isFalse);
    await dest.writeAsString('1');
    expect(await loadUnreadOnly(docs), isFalse);
    await dest.writeAsString('[]');
    expect(await loadUnreadOnly(docs), isFalse);
  });

  test('save swallows IO errors and keeps the in-memory value', () async {
    final store = UnreadOnlyStore(
      loadValue: () async => false,
      saveValue: (_) async => throw StateError('disk full'),
    );
    await store.save(true);
    expect(store.value, isTrue);
  });

  test('load swallows IO errors and treats the toggle as off', () async {
    final store = UnreadOnlyStore(
      loadValue: () async => throw StateError('missing plugin'),
      saveValue: (_) async {},
    );
    expect(await store.load(), isFalse);
    expect(store.value, isFalse);
  });

  test('load does not overwrite a value already saved this lifetime', () async {
    final store = UnreadOnlyStore(
      loadValue: () async => false,
      saveValue: (_) async {},
    );
    await store.save(true);
    expect(await store.load(), isTrue);
    expect(store.value, isTrue);
  });

  test('in-flight load keeps the last save instead of a stale disk value',
      () async {
    final hang = Completer<bool>();
    final store = UnreadOnlyStore(
      loadValue: () => hang.future,
      saveValue: (_) async {},
    );
    final pending = store.load();
    await store.save(true);
    hang.complete(false);
    expect(await pending, isTrue);
    expect(store.value, isTrue);
  });

  test('failed in-flight load does not clear a saved value', () async {
    final hang = Completer<bool>();
    final store = UnreadOnlyStore(
      loadValue: () => hang.future,
      saveValue: (_) async {},
    );
    final pending = store.load();
    await store.save(true);
    hang.completeError(StateError('stale read'));
    expect(await pending, isTrue);
    expect(store.value, isTrue);
  });
}

Future<void> _pumpApp(
  WidgetTester tester, {
  EventsRepository? repository,
  ReadStore? readStore,
  required UnreadOnlyStore unreadOnly,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository:
          repository ?? EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: unreadOnly,
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

void _expectAllFixtureCards() {
  for (final id in _allFixtureIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
