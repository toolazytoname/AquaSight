import 'package:aquasight/data/read_store.dart';
import 'package:flutter_test/flutter_test.dart';

List<String> _orderedIds(int count) => [
      for (var i = 0; i < count; i++) 'id-$i',
    ];

Set<String> _orderedSet(Iterable<String> ids) {
  final out = <String>{};
  for (final id in ids) {
    out.add(id);
  }
  return out;
}

void main() {
  test('markRead of 500 ids keeps all and length 500', () async {
    final store = ReadStore.memory();
    final ids = _orderedIds(readIdsMaxCount);
    for (final id in ids) {
      await store.markRead(id);
    }

    expect(store.ids.length, readIdsMaxCount);
    expect(store.ids.toList(), ids);
    for (final id in ids) {
      expect(store.isRead(id), isTrue);
    }
  });

  test('501st markRead drops the oldest and keeps the newest', () async {
    final written = <List<String>>[];
    final store = ReadStore(
      loadIds: () async => <String>{},
      saveIds: (ids) async => written.add(ids.toList()),
    );
    final ids = _orderedIds(readIdsMaxCount + 1);
    for (final id in ids) {
      await store.markRead(id);
    }

    final expected = ids.sublist(1);
    expect(store.ids.length, readIdsMaxCount);
    expect(store.isRead('id-0'), isFalse);
    expect(store.isRead('id-500'), isTrue);
    expect(store.ids.toList(), expected);
    expect(written.last, expected);
  });

  test('re-mark of an already-read id does not reorder or rewrite', () async {
    final written = <List<String>>[];
    final store = ReadStore(
      loadIds: () async => <String>{},
      saveIds: (ids) async => written.add(ids.toList()),
    );
    for (final id in ['a', 'b', 'c']) {
      await store.markRead(id);
    }
    written.clear();
    final before = List<String>.from(store.ids);

    await store.markRead('a');
    await store.markRead('b');

    expect(store.ids.toList(), before);
    expect(store.ids.toList(), ['a', 'b', 'c']);
    expect(written, isEmpty);
  });

  test('load with 502 ordered ids keeps the last 500 and writes back', () async {
    List<String>? written;
    final injected = _orderedIds(502);
    final store = ReadStore(
      loadIds: () async => _orderedSet(injected),
      saveIds: (ids) async => written = ids.toList(),
    );

    await store.load();

    final expected = injected.sublist(2);
    expect(store.ids.length, readIdsMaxCount);
    expect(store.ids.toList(), expected);
    expect(written, expected);
    expect(store.isRead('id-0'), isFalse);
    expect(store.isRead('id-1'), isFalse);
    expect(store.isRead('id-2'), isTrue);
    expect(store.isRead('id-501'), isTrue);
  });

  test('load at cap does not write back', () async {
    var writes = 0;
    final store = ReadStore(
      loadIds: () async => _orderedSet(_orderedIds(readIdsMaxCount)),
      saveIds: (_) async => writes++,
    );

    await store.load();

    expect(store.ids.length, readIdsMaxCount);
    expect(writes, 0);
  });
}
