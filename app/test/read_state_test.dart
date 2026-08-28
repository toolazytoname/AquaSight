import 'dart:convert';
import 'dart:io';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');

const _otherCardIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets('successful tap records the url once and marks only that card 已读',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();

    final card = tester.widget<Card>(find.byKey(_breakingKey));
    final colorBefore = card.color;

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(opened, hasLength(1));
    expect(store.isRead('same-day-breaking'), isTrue);
    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(find.text('已读'), findsOneWidget);
    _expectUnreadKeysAbsent(tester, except: 'same-day-breaking');

    final after = tester.widget<Card>(find.byKey(_breakingKey));
    expect(after.color, colorBefore);
    expect(after.color, const Color(0xFFFFF1EE));
  });

  testWidgets('same injected store survives a new AquaApp (restart)',
      (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_breakingReadKey), findsOneWidget);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();

    expect(opened, hasLength(1));
    expect(find.byKey(_breakingReadKey), findsOneWidget);
    expect(find.text('已读'), findsOneWidget);
    expect(store.isRead('same-day-breaking'), isTrue);
    _expectUnreadKeysAbsent(tester, except: 'same-day-breaking');
  });

  testWidgets('empty url does not write the id or show 已读', (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    final raw = loadFixtureJson();
    raw['items'] = [
      {
        'id': 'no-url',
        'title': 'No link',
        'url': '',
        'source': 'hn',
        'level': 'normal',
        'reason': 'empty',
        'sources': <Map<String, Object?>>[],
      },
    ];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: (uri) async => opened.add(uri),
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-no-url')));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(store.isRead('no-url'), isFalse);
    expect(store.ids, isEmpty);
    expect(find.byKey(const Key('event-card-no-url-read')), findsNothing);
    expect(find.text('已读'), findsNothing);
  });

  testWidgets('javascript: url does not write the id or show 已读', (tester) async {
    final opened = <Uri>[];
    final store = ReadStore.memory();
    final raw = loadFixtureJson();
    raw['items'] = [
      {
        'id': 'js-url',
        'title': 'Bad scheme',
        'url': 'javascript:alert(1)',
        'source': 'hn',
        'level': 'normal',
        'reason': 'xss',
      },
    ];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(jsonEncode(raw)),
        openUrl: (uri) async => opened.add(uri),
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-js-url')));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(store.isRead('js-url'), isFalse);
    expect(store.ids, isEmpty);
    expect(find.byKey(const Key('event-card-js-url-read')), findsNothing);
    expect(find.text('已读'), findsNothing);
  });

  testWidgets('opener throw does not write the id or show 已读', (tester) async {
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => throw StateError('opener failed'),
        readStore: store,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(store.isRead('same-day-breaking'), isFalse);
    expect(store.ids, isEmpty);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
  });

  test('default cache IO writes a JSON array of ids under aquasight/read_ids.json',
      () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-read-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadReadIds(docs), isEmpty);
    await saveReadIds({'same-day-breaking', 'other'}, docs);
    final dest = File('${docs.path}/$readIdsRelativePath');
    expect(dest.path, endsWith('/aquasight/read_ids.json'));
    expect(await dest.exists(), isTrue);
    final decoded = jsonDecode(await dest.readAsString());
    expect(decoded, isA<List<dynamic>>());
    expect(Set<String>.from(decoded as List), {'same-day-breaking', 'other'});
    expect(await File('${dest.path}.tmp').exists(), isFalse);
    expect(await loadReadIds(docs), {'same-day-breaking', 'other'});
  });

  test('missing or corrupt read_ids file loads as empty', () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-read-bad-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadReadIds(docs), isEmpty);
    final dest = File('${docs.path}/$readIdsRelativePath');
    await dest.parent.create(recursive: true);
    await dest.writeAsString('{not-json');
    expect(await loadReadIds(docs), isEmpty);
    await dest.writeAsString('{"ids":["x"]}');
    expect(await loadReadIds(docs), isEmpty);
  });

  test('markRead swallows save errors and keeps the id in memory', () async {
    final store = ReadStore(
      loadIds: () async => <String>{},
      saveIds: (_) async => throw StateError('disk full'),
    );
    await store.markRead('same-day-breaking');
    expect(store.isRead('same-day-breaking'), isTrue);
  });
}

void _expectUnreadKeysAbsent(WidgetTester tester, {required String except}) {
  for (final id in _otherCardIds) {
    if (id == except) continue;
    expect(find.byKey(Key('event-card-$id-read')), findsNothing);
    expect(tester.widget<Card>(find.byKey(Key('event-card-$id'))).color,
        isNot(equals(Colors.transparent)));
  }
}
