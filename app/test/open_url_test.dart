import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  testWidgets('tapping fixture breaking card records the primary https url once',
      (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-same-day-breaking')));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
  });

  testWidgets('tapping a source chip uses the same primary url', (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('weibo'));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
  });

  testWidgets('empty url and no source links does not call opener', (tester) async {
    final opened = <Uri>[];
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
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-no-url')));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
  });

  testWidgets('javascript: url does not call opener', (tester) async {
    final opened = <Uri>[];
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
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('event-card-js-url')));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
  });

  test('empty item.url falls back to the first non-empty source url', () {
    const item = EventItem(
      id: 'from-source',
      title: 'From source',
      url: '  ',
      source: 'weibo',
      level: 'normal',
      reason: '',
      sources: [
        SourceRef(source: 'weibo', url: ''),
        SourceRef(source: 'baidu', url: 'https://example.com/from-source'),
      ],
    );
    expect(httpUrlToOpen(item), Uri.parse('https://example.com/from-source'));
  });

  test('non-http item.url is rejected and does not fall back to sources', () {
    const item = EventItem(
      id: 'js-keeps-primary',
      title: 'Bad scheme',
      url: 'javascript:alert(1)',
      source: 'weibo',
      level: 'normal',
      reason: '',
      sources: [
        SourceRef(source: 'baidu', url: 'https://example.com/from-source'),
      ],
    );
    expect(httpUrlToOpen(item), isNull);
  });
}
