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

const _hostKey = Key('event-card-same-day-breaking-host');
const _timeKey = Key('event-card-same-day-breaking-time');
const _cardKey = Key('event-card-same-day-breaking');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'single breaking card shows uri.host on the time row',
      (tester) async {
    await _pumpSingle(tester);

    expect(find.byKey(_timeKey), findsOneWidget);
    expect(find.byKey(_hostKey), findsOneWidget);
    final host = tester.widget<Text>(find.byKey(_hostKey));
    expect(host.data, 'example.com');
    expect(host.maxLines, 1);
    expect(host.overflow, TextOverflow.ellipsis);

    final scheme = Theme.of(tester.element(find.byKey(_hostKey))).colorScheme;
    expect(host.style?.color, scheme.onSurfaceVariant);

    final timeRow = find.ancestor(
      of: find.byKey(_hostKey),
      matching: find.byType(Row),
    );
    expect(
      find.descendant(of: timeRow, matching: find.byKey(_timeKey)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: timeRow, matching: find.textContaining(' · ')),
      findsOneWidget,
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
    expect(_tooltipSemantics(_breakingUrl), findsOne);
  });

  testWidgets('empty url hides host and keeps time', (tester) async {
    await _pumpSingle(tester, url: '', clearSourceUrls: true);

    expect(find.byKey(_hostKey), findsNothing);
    expect(find.byKey(_timeKey), findsOneWidget);
    expect(find.textContaining(' · '), findsNothing);
    expect(find.byTooltip(_breakingUrl), findsNothing);
  });

  testWidgets('ftp url hides host (not http(s))', (tester) async {
    await _pumpSingle(tester, url: 'ftp://example.com/x');

    expect(find.byKey(_hostKey), findsNothing);
    expect(find.byKey(_timeKey), findsOneWidget);
    expect(find.byTooltip(_breakingUrl), findsNothing);
  });

  testWidgets('tap host center opens url and does not copy or share',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final copied = <String>[];
    await _pumpSingle(
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

    await tester.tap(find.byKey(_hostKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse(_breakingUrl)]);
    expect(copied, isEmpty);
    expect(shared, isEmpty);
    expect(find.byKey(const Key('copy-snackbar')), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('host stays on the time row under title and above chips',
      (tester) async {
    await _pumpSingle(tester);

    final title = tester.getBottomLeft(find.text('同日破圈'));
    final time = tester.getTopLeft(find.byKey(_timeKey));
    final host = tester.getTopLeft(find.byKey(_hostKey));
    final chip = tester.getTopLeft(
      find.descendant(
        of: find.byKey(_cardKey),
        matching: find.text('weibo'),
      ),
    );
    expect(time.dy, greaterThan(title.dy));
    expect(time.dy, lessThan(chip.dy));
    expect(host.dy, greaterThan(title.dy));
    expect(host.dy, lessThan(chip.dy));
    expect(host.dx, greaterThan(time.dx));
  });
}

FinderBase<SemanticsNode> _tooltipSemantics(String message) {
  return find.semantics.byPredicate(
    (node) => node.tooltip == message,
    describeMatch: (_) => 'SemanticsNode with tooltip "$message"',
  );
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
