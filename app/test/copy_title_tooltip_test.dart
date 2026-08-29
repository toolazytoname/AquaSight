import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'breaking title has 复制 tooltip; no Semantics label; title key stays on Text',
      (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: (_) async {},
    );

    expect(find.byTooltip('复制'), findsOneWidget);
    expect(find.byKey(_breakingTitleKey), findsOneWidget);
    expect(tester.widget<Text>(find.byKey(_breakingTitleKey)), isA<Text>());
    expect(
      find.descendant(
        of: find.byTooltip('复制'),
        matching: find.byKey(_breakingTitleKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('复制'), findsNothing);
    expect(_tooltipSemantics('复制'), findsOne);
  });

  testWidgets('short tap on 复制 title still calls openUrl and does not copy',
      (tester) async {
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byTooltip('复制'));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets(
      'long press on 复制 title shows 已复制 and does not call openUrl',
      (tester) async {
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byTooltip('复制'));
    await tester.pumpAndSettle();

    expect(copied, ['同日破圈']);
    expect(opened, isEmpty);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
}

Future<void> _pumpBreaking(
  WidgetTester tester, {
  required OpenUrl openUrl,
  required CopyText copyText,
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
      shareEvent: _forbidShare,
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
