import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/timeline/grouping.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _refreshKey = Key('last-refresh');
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';

final _clock = beijingClockLabel(DateTime.parse(_tenMinutesAgo));

void main() {
  testWidgets(
      'first load: last-refresh tooltip is beijing clock; no Semantics label',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
          loadCache: () async => throw StateError('must not read cache'),
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        now: () => _fixedNow,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byTooltip(_clock), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip(_clock),
        matching: find.byKey(_refreshKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(_clock), findsNothing);
    expect(_tooltipSemantics(_clock), findsOne);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  // unknown-date falls back to file updatedAt and would share this clock tooltip.
  raw['items'] = (raw['items'] as List)
      .where((item) => item is Map && item['id'] != 'unknown-date')
      .toList();
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
