import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _feedErrorSnackKey = Key('feed-error-snackbar');
const _markAllSnackKey = Key('mark-all-read-snackbar');
const _openErrorSnackKey = Key('open-error-snackbar');
const _shareErrorSnackKey = Key('share-error-snackbar');
const _overflowKey = Key('appbar-overflow');
const _markAllKey = Key('mark-all-read');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _refreshFail = '刷新失败：源不可用';

void main() {
  testWidgets(
      'feed-error-snackbar after list refresh fail can be dismissed via close',
      (tester) async {
    _phoneViewport(tester);
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return loadFixtureBytes();
            throw EventsLoadException(_refreshFail);
          },
          loadCache: () async => null,
          loadFallback: () async => null,
          loadAsset: () async => null,
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(find.byKey(_feedErrorSnackKey), findsNothing);

    await _pullReload(tester);
    expect(loads, 2);

    final snack = find.byKey(_feedErrorSnackKey);
    expect(snack, findsOneWidget);
    expect(_closeInside(snack), findsOneWidget);

    await tester.tap(_closeInside(snack));
    await tester.pumpAndSettle();

    expect(find.byKey(_feedErrorSnackKey), findsNothing);
  });

  testWidgets(
      'mark-all-read-snackbar can be dismissed via close',
      (tester) async {
    _phoneViewport(tester);
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_overflowKey));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(_markAllKey));
    await tester.pumpAndSettle();

    final snack = find.byKey(_markAllSnackKey);
    expect(snack, findsOneWidget);
    expect(_closeInside(snack), findsOneWidget);

    await tester.tap(_closeInside(snack));
    await tester.pumpAndSettle();

    expect(find.byKey(_markAllSnackKey), findsNothing);
  });

  testWidgets(
      'open-error-snackbar can be dismissed via close',
      (tester) async {
    _phoneViewport(tester);
    await _pumpBreaking(
      tester,
      openUrl: (_) async => throw StateError('opener failed'),
      shareEvent: _forbidShare,
    );

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    final snack = find.byKey(_openErrorSnackKey);
    expect(snack, findsOneWidget);
    expect(_closeInside(snack), findsOneWidget);

    await tester.tap(_closeInside(snack));
    await tester.pumpAndSettle();

    expect(find.byKey(_openErrorSnackKey), findsNothing);
  });

  testWidgets(
      'share-error-snackbar can be dismissed via close',
      (tester) async {
    _phoneViewport(tester);
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      shareEvent: ({
        required title,
        required url,
        required sharePositionOrigin,
      }) async {
        throw StateError('share failed');
      },
    );

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    final snack = find.byKey(_shareErrorSnackKey);
    expect(snack, findsOneWidget);
    expect(_closeInside(snack), findsOneWidget);

    await tester.tap(_closeInside(snack));
    await tester.pumpAndSettle();

    expect(find.byKey(_shareErrorSnackKey), findsNothing);
  });
}

Finder _closeInside(Finder snack) => find.descendant(
      of: snack,
      matching: find.byIcon(Icons.close),
    );

void _phoneViewport(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpBreaking(
  WidgetTester tester, {
  required OpenUrl openUrl,
  required ShareEvent shareEvent,
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
      shareEvent: shareEvent,
      copyText: (_) async {},
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pullReload(WidgetTester tester) async {
  final refresh = tester
      .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
      .show();
  await tester.pumpAndSettle();
  await refresh;
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
