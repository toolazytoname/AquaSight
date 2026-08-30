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

const _cardKey = Key('event-card-same-day-breaking');
const _titleKey = Key('event-card-same-day-breaking-title');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _openErrorSnackKey = Key('open-error-snackbar');
const _openErrorCopyKey = Key('open-error-copy');

void main() {
  testWidgets(
      'copy-snackbar 已复制 can be dismissed via Icons.close',
      (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: (_) async {},
    );

    await tester.longPress(find.byKey(_titleKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
    expect(_closeInside(find.byKey(_copySnackKey)), findsOneWidget);

    await tester.tap(_closeInside(find.byKey(_copySnackKey)));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets(
      'copy-error-snackbar 无法复制 can be dismissed via Icons.close',
      (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: (_) async => throw StateError('copy failed'),
    );

    await tester.longPress(find.byKey(_titleKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(_closeInside(find.byKey(_copyErrorSnackKey)), findsOneWidget);

    await tester.tap(_closeInside(find.byKey(_copyErrorSnackKey)));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsNothing);
    expect(find.text('无法复制'), findsNothing);
  });

  testWidgets(
      'open-error-snackbar keeps 复制 and also has a close icon',
      (tester) async {
    await _pumpBreaking(
      tester,
      openUrl: (_) async => throw StateError('opener failed'),
      copyText: (_) async {},
    );

    await tester.tap(find.byKey(_cardKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_openErrorSnackKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);
    expect(find.byKey(_openErrorCopyKey), findsOneWidget);
    expect(find.text('复制'), findsOneWidget);
    expect(
      find.descendant(
        of: find.byKey(_openErrorSnackKey),
        matching: find.byIcon(Icons.close),
      ),
      findsOneWidget,
    );
  });
}

Finder _closeInside(Finder snack) {
  return find.descendant(
    of: snack,
    matching: find.byIcon(Icons.close),
  );
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
