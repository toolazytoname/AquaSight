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

const _hostKey = Key('event-card-same-day-breaking-host');
const _titleKey = Key('event-card-same-day-breaking-title');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'long-press host copies httpUrlToOpen uri and does not open or share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final copied = <String>[];
    await _pumpBreaking(
      tester,
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

    await tester.longPress(find.byKey(_hostKey));
    await tester.pumpAndSettle();

    expect(copied, [_breakingUrl]);
    expect(copied, hasLength(1));
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('short tap host still only opens and does not copy',
      (tester) async {
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byKey(_hostKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets(
      'copyText throw on host long-press shows 无法复制 and does not open',
      (tester) async {
    final opened = <Uri>[];
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => throw StateError('copy failed'),
    );

    await tester.longPress(find.byKey(_hostKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets(
      'host tooltip stays uri.toString(); no Semantics label for the URL',
      (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: (_) async {},
    );

    expect(find.byTooltip(_breakingUrl), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip(_breakingUrl),
        matching: find.byKey(_hostKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(_breakingUrl), findsNothing);
  });

  testWidgets('long-press title still copies only 同日破圈, not the URL',
      (tester) async {
    final copied = <String>[];
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_titleKey));
    await tester.pumpAndSettle();

    expect(copied, ['同日破圈']);
    expect(copied, isNot(contains(_breakingUrl)));
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });
}

Future<void> _pumpBreaking(
  WidgetTester tester, {
  required OpenUrl openUrl,
  required CopyText copyText,
  ShareEvent? shareEvent,
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
      shareEvent: shareEvent ?? _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
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
