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

const _breakingReasonKey = Key('event-card-same-day-breaking-reason');
const _reason = 'hard impact keyword';
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'breaking reason has tooltip of full string; no Semantics label; key stays on Text',
      (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
    );

    final reason = tester.widget<Text>(find.byKey(_breakingReasonKey));
    expect(reason.data, _reason);
    expect(reason.maxLines, 1);
    expect(reason.overflow, TextOverflow.ellipsis);

    expect(find.byTooltip(_reason), findsOneWidget);
    expect(
      find.descendant(
        of: find.byTooltip(_reason),
        matching: find.byKey(_breakingReasonKey),
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel(_reason), findsNothing);
    expect(_tooltipSemantics(_reason), findsOne);
  });

  testWidgets(
      'short tap on reason still calls openUrl and does not share or copy',
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

    await tester.tap(find.byKey(_breakingReasonKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(shared, isEmpty);
    expect(copied, isEmpty);
    expect(find.byKey(const Key('copy-snackbar')), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('empty reason is not rendered and has no tooltip', (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      reason: '',
    );

    expect(find.byKey(_breakingReasonKey), findsNothing);
    expect(find.byTooltip(_reason), findsNothing);
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
  ShareEvent shareEvent = _forbidShare,
  CopyText copyText = _forbidCopy,
  String? reason,
}) async {
  final raw = loadFixtureJson();
  final item = (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
        (item) => item['id'] == 'same-day-breaking',
      );
  if (reason != null) {
    item['reason'] = reason;
  }
  raw['items'] = [item];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: openUrl,
      shareEvent: shareEvent,
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
