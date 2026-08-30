import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _emptyKey = Key('timeline-empty');
const _refreshKey = Key('timeline-empty-refresh');
const _errorKey = Key('timeline-error');
const _errorRetryKey = Key('timeline-error-retry');
const _feedUpdatedSnackKey = Key('feed-updated-snackbar');
const _breakingKey = Key('event-card-same-day-breaking');
const _updatedA = '2026-08-26T01:00:00.000Z';
const _updatedB = '2026-08-26T03:00:00.000Z';

void main() {
  testWidgets(
      'true-empty: timeline-empty-refresh is 48×48 FilledButton; tap loads cards',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return _emptyFixture(_updatedA);
            return _fixtureWithUpdatedAt(_updatedB);
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_emptyKey), findsOneWidget);
    expect(find.byKey(_refreshKey), findsOneWidget);
    expect(tester.widget(find.byKey(_refreshKey)), isA<FilledButton>());
    expect(
      find.descendant(
        of: find.byKey(_refreshKey),
        matching: find.text('刷新'),
      ),
      findsOneWidget,
    );

    final refreshSize = tester.getSize(find.byKey(_refreshKey));
    expect(refreshSize.width, greaterThanOrEqualTo(48));
    expect(refreshSize.height, greaterThanOrEqualTo(48));

    expect(find.byTooltip('重新加载'), findsOneWidget);
    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_feedUpdatedSnackKey), findsNothing);

    await tester.tap(find.byKey(_refreshKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_feedUpdatedSnackKey), findsOneWidget);
    expect(find.text('已更新'), findsOneWidget);
    expect(find.byKey(_emptyKey), findsNothing);
    expect(find.byKey(_refreshKey), findsNothing);
  });

  testWidgets(
      'error page: timeline-error-retry is 48×48 FilledButton; tap loads cards',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      _app(
        EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('网络不可用');
            return loadFixtureBytes();
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_errorKey), findsOneWidget);
    expect(find.byKey(_errorRetryKey), findsOneWidget);
    expect(tester.widget(find.byKey(_errorRetryKey)), isA<FilledButton>());
    expect(
      find.descendant(
        of: find.byKey(_errorRetryKey),
        matching: find.text('重试'),
      ),
      findsOneWidget,
    );

    final retrySize = tester.getSize(find.byKey(_errorRetryKey));
    expect(retrySize.width, greaterThanOrEqualTo(48));
    expect(retrySize.height, greaterThanOrEqualTo(48));

    expect(find.byTooltip('重新加载'), findsOneWidget);
    expect(loads, 1);

    await tester.tap(find.byKey(_errorRetryKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_errorKey), findsNothing);
  });
}

Widget _app(EventsRepository repository) {
  return AquaApp(
    repository: repository,
    openUrl: _forbidLaunch,
    shareEvent: _forbidShare,
    readStore: ReadStore.memory(),
    unreadOnlyStore: UnreadOnlyStore.memory(),
    scrollOffsetStore: ScrollOffsetStore.memory(),
    sourceFilterStore: SourceFilterStore.memory(),
  );
}

String _emptyFixture(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  raw['items'] = [];
  return jsonEncode(raw);
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  return jsonEncode(raw);
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
