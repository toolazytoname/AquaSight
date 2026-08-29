import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _bannerKey = Key('offline-banner');

void main() {
  testWidgets(
      'live fail + cache: offline-banner tooltip only; no Semantics label',
      (tester) async {
    var loads = 0;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) throw EventsLoadException('HTTP 503');
            return loadFixtureBytes();
          },
          loadCache: () async => loads == 1 ? loadFixtureBytes() : null,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_bannerKey), findsOneWidget);
    expect(find.text('离线缓存'), findsOneWidget);
    expect(find.byTooltip('点按刷新'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_bannerKey),
        matching: find.byTooltip('点按刷新'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: find.byTooltip('点按刷新'),
        matching: find.text('离线缓存'),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('点按刷新'), findsNothing);
    expect(_tooltipSemantics('点按刷新'), findsOne);
    expect(loads, 1);

    await tester.tap(find.byKey(_bannerKey));
    await tester.pumpAndSettle();

    expect(loads, 2);
    expect(find.byKey(_bannerKey), findsNothing);
    expect(find.text('离线缓存'), findsNothing);
    expect(find.byTooltip('点按刷新'), findsNothing);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
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
