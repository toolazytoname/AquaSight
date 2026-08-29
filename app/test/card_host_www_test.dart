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
const _wwwUrl = 'https://www.example.com/breaking';
const _www2Url = 'https://www2.example.com/x';

void main() {
  testWidgets(
      'www. prefix is stripped from host Text; tooltip stays full URL',
      (tester) async {
    await _pumpSingle(tester, url: _wwwUrl);

    final host = tester.widget<Text>(find.byKey(_hostKey));
    expect(host.data, 'example.com');
    expect(find.byTooltip(_wwwUrl), findsOneWidget);
    expect(find.bySemanticsLabel(_wwwUrl), findsNothing);
  });

  testWidgets(
      'long-press www host copies full URL and does not open',
      (tester) async {
    final opened = <Uri>[];
    final copied = <String>[];
    await _pumpSingle(
      tester,
      url: _wwwUrl,
      openUrl: (uri) async => opened.add(uri),
      copyText: (text) async => copied.add(text),
    );

    await tester.longPress(find.byKey(_hostKey));
    await tester.pumpAndSettle();

    expect(copied, [_wwwUrl]);
    expect(copied, hasLength(1));
    expect(opened, isEmpty);
  });

  testWidgets('www2. host is not stripped', (tester) async {
    await _pumpSingle(tester, url: _www2Url);

    final host = tester.widget<Text>(find.byKey(_hostKey));
    expect(host.data, 'www2.example.com');
  });
}

Future<void> _pumpSingle(
  WidgetTester tester, {
  String? url,
  bool clearSourceUrls = false,
  OpenUrl? openUrl,
  ShareEvent? shareEvent,
  CopyText? copyText,
}) async {
  final raw = loadFixtureJson();
  final item = (raw['items'] as List).cast<Map<String, dynamic>>().firstWhere(
        (candidate) => candidate['id'] == 'same-day-breaking',
      );
  if (url != null) {
    item['url'] = url;
  }
  if (clearSourceUrls) {
    final sources = (item['sources'] as List?)?.cast<Map<String, dynamic>>();
    if (sources != null) {
      for (final source in sources) {
        source['url'] = '';
      }
    }
  }
  raw['items'] = [item];
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(jsonEncode(raw)),
      openUrl: openUrl ?? _forbidLaunch,
      shareEvent: shareEvent ?? _forbidShare,
      copyText: copyText ?? _forbidCopy,
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
