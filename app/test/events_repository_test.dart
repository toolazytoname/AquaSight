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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.live);
    expect(loaded.file.items, isNotEmpty);
    expect(loaded.file.items.map((e) => e.id), contains('unknown-date'));
  });

  test('live loader failure falls back to fixture file path', () async {
    final repo = EventsRepository(
      loadLive: () async {
        throw EventsLoadException('HTTP 503');
      },
      loadFallback: () => File(fixturePath).readAsString(),
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.sibling);
    expect(loaded.file.items.length, 6);
  });

  test('live factory with forbidHttp uses fallback file, not the network', () async {
    final repo = EventsRepository.live(
      httpGet: forbidHttp,
      fallbackFiles: [File(fixturePath)],
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.sibling);
    expect(loaded.file.items.first.id, 'cross-midnight');
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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.live);
    expect(loaded.file.items, isEmpty);
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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.asset);
    expect(loaded.file.items.map((e) => e.title), ['离线快照标题', '第二标题']);
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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.live);
    expect(loaded.file.items.single.title, '直播标题');
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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.asset);
    expect(loaded.file.items.single.title, '资产兜底');
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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.sibling);
    expect(loaded.file.items.length, 6);
    expect(assetCalls, 0);
  });

  test('live factory with forbidHttp uses injected asset, not the network',
      () async {
    final repo = EventsRepository.live(
      httpGet: forbidHttp,
      fallbackFiles: [File('/definitely/missing/events.json')],
      loadAsset: () async => _titlesJson(const ['注入资产']),
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.asset);
    expect(loaded.file.items.single.title, '注入资产');
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
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.asset);
    expect(loaded.file.items, isNotEmpty);
  });

  test('live success writes cache once and does not read cache or asset', () async {
    final liveJson = _titlesJson(const ['直播标题']);
    final saved = <String>[];
    var cacheLoads = 0;
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => liveJson,
      loadCache: () async {
        cacheLoads++;
        return _titlesJson(const ['缓存标题']);
      },
      saveCache: (raw) async => saved.add(raw),
      loadFallback: () async => _titlesJson(const ['文件标题']),
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['资产标题']);
      },
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.live);
    expect(loaded.file.items.single.title, '直播标题');
    expect(saved, [liveJson]);
    expect(cacheLoads, 0);
    expect(assetCalls, 0);
  });

  test('second live fail consumes cache title and skips sibling/asset', () async {
    String? stored;
    var cacheLoads = 0;
    var siblingCalls = 0;
    var assetCalls = 0;
    var lives = 0;
    final repo = EventsRepository(
      loadLive: () async {
        lives++;
        if (lives == 1) return _titlesJson(const ['直播标题']);
        throw EventsLoadException('HTTP 503');
      },
      loadCache: () async {
        cacheLoads++;
        return stored;
      },
      saveCache: (raw) async => stored = raw,
      loadFallback: () async {
        siblingCalls++;
        return _titlesJson(const ['文件标题']);
      },
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['资产标题']);
      },
    );

    final first = await repo.load();
    expect(first.source, EventsSource.live);
    expect(first.file.items.single.title, '直播标题');
    expect(cacheLoads, 0);
    stored = _titlesJson(const ['缓存标题']);

    final second = await repo.load();
    expect(second.source, EventsSource.cache);
    expect(second.file.items.single.title, '缓存标题');
    expect(cacheLoads, 1);
    expect(siblingCalls, 0);
    expect(assetCalls, 0);
  });

  test('live fail with empty cache uses sibling over asset', () async {
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      loadCache: () async => '',
      loadFallback: () async => _titlesJson(const ['文件标题']),
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['资产标题']);
      },
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.sibling);
    expect(loaded.file.items.single.title, '文件标题');
    expect(assetCalls, 0);
  });

  test('live fail with bad cache uses sibling over asset', () async {
    var assetCalls = 0;
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      loadCache: () async => '{not-json',
      loadFallback: () async => _titlesJson(const ['文件标题']),
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['资产标题']);
      },
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.sibling);
    expect(loaded.file.items.single.title, '文件标题');
    expect(assetCalls, 0);
  });

  test('live fail with empty cache sibling and asset rethrows live error',
      () async {
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('网络不可用'),
      loadCache: () async => '',
      loadFallback: () async => '   ',
      loadAsset: () async => '',
    );
    await expectLater(
      repo.load(),
      throwsA(
        isA<EventsLoadException>().having((e) => e.message, 'message', '网络不可用'),
      ),
    );
  });

  test('live parse failure does not write cache', () async {
    var saves = 0;
    final repo = EventsRepository(
      loadLive: () async => '{not-json',
      saveCache: (_) async => saves++,
      loadFallback: () async => null,
      loadAsset: () async => null,
    );
    await expectLater(repo.load(), throwsA(isA<EventsLoadException>()));
    expect(saves, 0);
  });

  test('sibling fallback success does not write cache', () async {
    var saves = 0;
    final repo = EventsRepository(
      loadLive: () async => throw EventsLoadException('HTTP 503'),
      saveCache: (_) async => saves++,
      loadFallback: () async => _titlesJson(const ['文件标题']),
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.sibling);
    expect(loaded.file.items.single.title, '文件标题');
    expect(saves, 0);
  });

  test('cache write errors are swallowed and live data is returned', () async {
    final repo = EventsRepository(
      loadLive: () async => _titlesJson(const ['直播标题']),
      saveCache: (_) async => throw StateError('disk full'),
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.live);
    expect(loaded.file.items.single.title, '直播标题');
  });

  test('default cache IO writes raw json under aquasight/events.json', () async {
    final docs = await Directory.systemTemp.createTemp('aquasight-cache-');
    addTearDown(() => docs.delete(recursive: true));
    expect(await loadCachedEvents(docs), isNull);
    final raw = _titlesJson(const ['磁盘缓存']);
    await saveCachedEvents(raw, docs);
    final dest = File('${docs.path}/$cachedEventsRelativePath');
    expect(dest.path, endsWith('/aquasight/events.json'));
    expect(await dest.exists(), isTrue);
    expect(await dest.readAsString(), raw);
    expect(await File('${dest.path}.tmp').exists(), isFalse);
    expect(await loadCachedEvents(docs), raw);
  });

  test('live factory with forbidHttp uses injected cache not sibling or asset',
      () async {
    var assetCalls = 0;
    final repo = EventsRepository.live(
      httpGet: forbidHttp,
      fallbackFiles: [File(fixturePath)],
      loadCache: () async => _titlesJson(const ['缓存标题']),
      loadAsset: () async {
        assetCalls++;
        return _titlesJson(const ['资产标题']);
      },
    );
    final loaded = await repo.load();
    expect(loaded.source, EventsSource.cache);
    expect(loaded.file.items.single.title, '缓存标题');
    expect(assetCalls, 0);
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
