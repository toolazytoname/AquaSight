import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _copySnackKey = Key('copy-snackbar');
const _fullDisplayTitle = '同日破圈';

/// Long enough that two-line paint would ellipsize; copy must still get this.
const _longDisplayTitle =
    '这是一条故意写得很长的同日破圈标题用来确认复制分享打开都走完整 displayTitle '
    '而不是界面上被省略号截断后的可见文本一二三四五六七八九十甲乙丙丁戊己庚辛壬癸';

void main() {
  testWidgets(
      'after first load, breaking title has maxLines 2 and ellipsis overflow',
      (tester) async {
    await _pumpFixture(tester, copyText: (_) async {});

    final title = tester.widget<Text>(find.byKey(_breakingTitleKey));
    expect(title.maxLines, 2);
    expect(title.overflow, TextOverflow.ellipsis);
    expect(title.data, _fullDisplayTitle);
  });

  testWidgets(
      'long-press title copies full displayTitle and shows 已复制, not ellipsized paint',
      (tester) async {
    final copied = <String>[];
    await _pumpFixture(tester, copyText: (text) async => copied.add(text));

    final title = tester.widget<Text>(find.byKey(_breakingTitleKey));
    expect(title.data, _fullDisplayTitle);
    expect(title.maxLines, 2);
    expect(title.overflow, TextOverflow.ellipsis);

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(copied, [_fullDisplayTitle]);
    expect(
      tester.widget<Text>(find.byKey(_breakingTitleKey)).data,
      _fullDisplayTitle,
    );
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets(
      'long-press of an overflowing title still copies the full long displayTitle',
      (tester) async {
    final copied = <String>[];
    await _pumpBreakingWithTitle(
      tester,
      titleZh: _longDisplayTitle,
      copyText: (text) async => copied.add(text),
    );

    final title = tester.widget<Text>(find.byKey(_breakingTitleKey));
    expect(title.maxLines, 2);
    expect(title.overflow, TextOverflow.ellipsis);
    expect(title.data, _longDisplayTitle);

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(copied, [_longDisplayTitle]);
    expect(
      tester.widget<Text>(find.byKey(_breakingTitleKey)).data,
      _longDisplayTitle,
    );
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });
}

Future<void> _pumpFixture(
  WidgetTester tester, {
  required Future<void> Function(String) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _pumpBreakingWithTitle(
  WidgetTester tester, {
  required String titleZh,
  required Future<void> Function(String) copyText,
}) async {
  final raw = loadFixtureJson();
  raw['items'] = [
    (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
          (item) => item['id'] == 'same-day-breaking',
        )
      ..['titleZh'] = titleZh,
  ];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: _forbidLaunch,
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
