import 'dart:convert';
import 'dart:io';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/models/event.dart';
import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

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

  test('live fail with asset present consumes asset titles', () async {
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      loadFallback: () async => null,
      loadAsset: () async => _titlesJson(const ['离线快照标题', '第二标题']),
    );
    final file = await repo.load();
    expect(file.items.map((e) => e.title), ['离线快照标题', '第二标题']);
  });

  test('live success returns live data and does not read the asset', () async {
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => _titlesJson(const ['直播标题']),
      loadFallback: () async => _titlesJson(const ['不应使用的文件']),
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['不应使用的资产']);
      },
    );
    final file = await repo.load();
    expect(file.items.single.title, '直播标题');
    expect(assetCalls, 0);
  });

  test('live fail with empty sibling and empty asset rethrows live error', () async {
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('网络不可用'),
      loadFallback: () async => '   ',
      loadAsset: () async {
        assetCalls++;
        return '';
      },
    );
    await expectLater(
      repo.load(),
      throwsA(
        isA<EventsLoadException>().having((e) => e.message, 'message', '网络不可用'),
      ),
    );
    expect(assetCalls, 1);
  });

  test('live fail with sibling and asset parse failures rethrows live error',
      () async {
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      loadFallback: () async => '{not-json',
      loadAsset: () async => '{"items":',
    );
    await expectLater(
      repo.load(),
      throwsA(
        isA<EventsLoadException>().having((e) => e.message, 'message', 'HTTP 503'),
      ),
    );
  });

  test('live fail uses asset after sibling parse failure', () async {
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      loadFallback: () async => '{not-json',
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['资产兜底']);
      },
    );
    final file = await repo.load();
    expect(file.items.single.title, '资产兜底');
    expect(assetCalls, 1);
  });

  test('sibling fallback wins and does not read the asset', () async {
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      loadFallback: () async => File(fixturePath).readAsString(),
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['不应使用的资产']);
      },
    );
    final file = await repo.load();
    expect(file.items.length, 6);
    expect(assetCalls, 0);
  });

  test('live factory with forbidHttp uses injected asset, not the network',
      () async {
    final repo = EventsRepository.live(
      httpGet: forbidHttp,
      fallbackFiles: [File('/definitely/missing/events.json')],
      loadAsset: () async => _titlesJson(const ['注入资产']),
    );
    final file = await repo.load();
    expect(file.items.single.title, '注入资产');
  });

  test('bundled snapshot parses via rootBundle and has items', () async {
    final body = await rootBundle.loadString(bundledEventsAsset);
    final file = EventsFile.parse(body);
    expect(file.items, isNotEmpty);
    expect(file.items.first.title, isNotEmpty);
  });

  test('live fail with no sibling consumes registered bundled asset', () async {
    final repo = EventsRepository.live(
      httpGet: forbidHttp,
      fallbackFiles: [File('/definitely/missing/events.json')],
    );
    final file = await repo.load();
    expect(file.items, isNotEmpty);
  });
}

String _titlesJson(List<String> titles) {
  return jsonEncode({
    'updatedAt': '',
    'items': [
      for (var i = 0; i < titles.length; i++)
        {
          'id': 'asset-$i',
          'title': titles[i],
          'url': 'https://example.com/$i',
          'source': 'fixture',
          'level': 'normal',
          'reason': 'offline asset',
        },
    ],
  });
}
