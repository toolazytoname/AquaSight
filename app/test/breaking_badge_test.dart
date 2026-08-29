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

const _breakingBadgeKey = Key('event-card-same-day-breaking-breaking');
const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _breakingUnreadDotKey = Key('event-card-same-day-breaking-unread-dot');
const _normalBadgeKey = Key('event-card-same-day-normal-high-score-breaking');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'single breaking card shows 突发 with error color and w700; title stays',
      (tester) async {
    await _pumpSingle(tester, id: 'same-day-breaking');

    expect(find.byKey(_breakingBadgeKey), findsOneWidget);
    expect(find.text('突发'), findsOneWidget);
    expect(find.text('同日破圈'), findsOneWidget);

    final badge = tester.widget<Text>(find.byKey(_breakingBadgeKey));
    final scheme = Theme.of(
      tester.element(find.byKey(_breakingBadgeKey)),
    ).colorScheme;
    expect(badge.data, '突发');
    expect(badge.style?.color, scheme.error);
    expect(badge.style?.fontWeight, FontWeight.w700);
  });

  testWidgets(
      'read breaking card still shows 突发 and has no unread-dot',
      (tester) async {
    await _pumpSingle(
      tester,
      id: 'same-day-breaking',
      readStore: ReadStore.memory({'same-day-breaking'}),
    );

    expect(find.byKey(_breakingBadgeKey), findsOneWidget);
    expect(find.text('突发'), findsOneWidget);
    expect(find.byKey(_breakingUnreadDotKey), findsNothing);
  });

  testWidgets('single normal card has no 突发 badge', (tester) async {
    await _pumpSingle(tester, id: 'same-day-normal-high-score');

    expect(find.byKey(_normalBadgeKey), findsNothing);
    expect(find.text('突发'), findsNothing);
  });

  testWidgets('tap 突发 badge opens url and does not copy or share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final copied = <String>[];
    await _pumpSingle(
      tester,
      id: 'same-day-breaking',
      openUrl: (uri) async => opened.add(uri),
      shareEvent: ({
        required title,
        required url,
        required sharePositionOrigin,
      }) async {
        shared.add((title: title, url: url));
      },
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byKey(_breakingBadgeKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(copied, isEmpty);
    expect(shared, isEmpty);
    expect(find.byKey(const Key('copy-snackbar')), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets(
      'unread breaking badge top-aligns with unread-dot; read keeps 突发 padding',
      (tester) async {
    await _pumpSingle(tester, id: 'same-day-breaking');

    expect(find.byKey(_breakingBadgeKey), findsOneWidget);
    expect(find.byKey(_breakingUnreadDotKey), findsOneWidget);
    expect(_badgeOuterPadding(tester).padding, const EdgeInsets.only(right: 6, top: 6));
    expect(
      (tester.getRect(find.byKey(_breakingBadgeKey)).top -
              tester.getRect(find.byKey(_breakingUnreadDotKey)).top)
          .abs(),
      lessThanOrEqualTo(1.0),
    );

    await _pumpSingle(
      tester,
      id: 'same-day-breaking',
      readStore: ReadStore.memory({'same-day-breaking'}),
      key: const ValueKey('read-breaking'),
    );

    expect(find.byKey(_breakingBadgeKey), findsOneWidget);
    expect(find.text('突发'), findsOneWidget);
    expect(find.byKey(_breakingUnreadDotKey), findsNothing);
    expect(_badgeOuterPadding(tester).padding, const EdgeInsets.only(right: 6, top: 6));
  });

  testWidgets('long-press title copies 同日破圈 and not 突发', (tester) async {
    final copied = <String>[];
    await _pumpSingle(
      tester,
      id: 'same-day-breaking',
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(copied, ['同日破圈']);
    expect(copied.any((text) => text.contains('突发')), isFalse);
    expect(find.byKey(const Key('copy-snackbar')), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });
}

Padding _badgeOuterPadding(WidgetTester tester) {
  return tester.widget<Padding>(
    find.byWidgetPredicate((widget) {
      return widget is Padding &&
          widget.child is Text &&
          (widget.child as Text).key == _breakingBadgeKey;
    }),
  );
}

Future<void> _pumpSingle(
  WidgetTester tester, {
  required String id,
  ReadStore? readStore,
  OpenUrl? openUrl,
  ShareEvent? shareEvent,
  CopyText? copyText,
  Key? key,
}) async {
  final raw = loadFixtureJson();
  raw['items'] = [
    (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
          (item) => item['id'] == id,
        ),
  ];
  await tester.pumpWidget(
    AquaApp(
      key: key,
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: openUrl ?? _forbidLaunch,
      shareEvent: shareEvent ?? _forbidShare,
      copyText: copyText ?? _forbidCopy,
      readStore: readStore ?? ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
