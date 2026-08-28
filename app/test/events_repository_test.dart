import 'dart:convert';
import 'dart:io';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/models/event.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  test('loads injected fixture bytes and never opens HTTP', () async {
    final repo = EventsRepository.fromJsonString(loadFixtureBytes());
    final file = await repo.load();
    expect(file.items, isNotEmpty);
    expect(file.items.map((e) => e.id), contains('unknown-date'));
  });

  test('live loader failure falls back to fixture file path', () async {
    final repo = EventsRepository(
      loadLive: () async {
        throw EventsLoadException('HTTP 503');
      },
      loadFallback: () => File(fixturePath).readAsString(),
    );
    final file = await repo.load();
    expect(file.items.length, 6);
  });

  test('live factory with forbidHttp uses fallback file, not the network', () async {
    final repo = EventsRepository.live(
      httpGet: forbidHttp,
      fallbackFiles: [File(fixturePath)],
    );
    final file = await repo.load();
    expect(file.items.first.id, 'cross-midnight');
  });

  test('error when live and fallback both fail', () async {
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('网络不可用'),
      loadFallback: () async => null,
    );
    expect(
      () => repo.load(),
      throwsA(
        isA<EventsLoadException>().having((e) => e.message, 'message', '网络不可用'),
      ),
    );
  });

  test('empty items from fixture mutation is a successful empty file', () async {
    final raw = loadFixtureJson();
    raw['items'] = [];
    final repo = EventsRepository.fromJsonString(jsonEncode(raw));
    final file = await repo.load();
    expect(file.items, isEmpty);
  });

  test('invalid JSON is an error', () async {
    final repo = EventsRepository.fromJsonString('{not-json');
    expect(() => repo.load(), throwsA(isA<EventsLoadException>()));
  });
}
