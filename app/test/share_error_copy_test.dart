import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _shareErrorSnackKey = Key('share-error-snackbar');
const _shareErrorCopyKey = Key('share-error-copy');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'shareEvent throw shows 无法分享 with 复制 action and does not change unread',
      (tester) async {
    final opened = <Uri>[];
    final copied = <String>[];
    final store = ReadStore.memory();
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
      readStore: store,
    );
    expect(_countText(tester), '未读 1');

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(find.byKey(_shareErrorSnackKey), findsOneWidget);
    expect(find.text('无法分享'), findsOneWidget);
    expect(find.byKey(_shareErrorCopyKey), findsOneWidget);
    expect(find.text('复制'), findsOneWidget);
    expect(copied, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(_countText(tester), '未读 1');
  });

  testWidgets(
      'share-error 复制 copies httpUrlToOpen and replaces 无法分享 with 已复制',
      (tester) async {
    final copied = <String>[];
    final store = ReadStore.memory();
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => throw StateError('tests must not open'),
      copyText: (text) async => copied.add(text),
      readStore: store,
    );

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_shareErrorSnackKey), findsOneWidget);
    expect(find.text('无法分享'), findsOneWidget);

    await tester.tap(find.byKey(_shareErrorCopyKey));
    await tester.pumpAndSettle();

    expect(copied, [_breakingUrl]);
    expect(copied, hasLength(1));
    expect(find.text('无法分享'), findsNothing);
    expect(find.byKey(_shareErrorSnackKey), findsNothing);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(_countText(tester), '未读 1');
  });

  testWidgets(
      'share-error 复制 copyText throw shows 无法复制 and does not mark read',
      (tester) async {
    final store = ReadStore.memory();
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => throw StateError('tests must not open'),
      copyText: (text) async => throw StateError('copy failed'),
      readStore: store,
    );

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_shareErrorCopyKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 1');
  });
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Future<void> _pumpBreaking(
  WidgetTester tester, {
  required OpenUrl openUrl,
  required CopyText copyText,
  required ReadStore readStore,
}) async {
  final raw = loadFixtureJson();
  raw['items'] = [
    (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
          (item) => item['id'] == 'same-day-breaking',
        ),
  ];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: openUrl,
      shareEvent: ({
        required title,
        required url,
        required sharePositionOrigin,
      }) async {
        throw StateError('share failed');
      },
      copyText: copyText,
      readStore: readStore,
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}
