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

const _breakingReasonKey = Key('event-card-same-day-breaking-reason');
const _reason = 'hard impact keyword';
const _copySnackKey = Key('copy-snackbar');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'long-press breaking reason copies item.reason and shows 已复制',
      (tester) async {
    _setDefaultSurface(tester);
    final copied = <String>[];
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_breakingReasonKey));
    await tester.pumpAndSettle();

    expect(copied, [_reason]);
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('short-press breaking reason opens url and does not copy',
      (tester) async {
    _setDefaultSurface(tester);
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpBreaking(
      tester,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.tap(find.byKey(_breakingReasonKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('empty reason has no reason key', (tester) async {
    _setDefaultSurface(tester);
    await _pumpBreaking(
      tester,
      openUrl: _forbidLaunch,
      copyText: _forbidCopy,
      reason: '',
    );

    expect(find.byKey(_breakingReasonKey), findsNothing);
  });
}

void _setDefaultSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpBreaking(
  WidgetTester tester, {
  required OpenUrl openUrl,
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
