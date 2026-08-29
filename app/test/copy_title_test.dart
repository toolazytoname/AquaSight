import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _countKey = Key('unread-count');
const _breakingTitleKey = Key('event-card-same-day-breaking-title');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'long-press breaking title copies displayTitle and does not open/share/read',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final copied = <String>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        copyText: (text) async => copied.add(text),
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(_countText(tester), '未读 6');

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(copied, ['同日破圈']);
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
  });

  testWidgets('short-press breaking title opens the original url and does not copy',
      (tester) async {
    final opened = <Uri>[];
    final copied = <String>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: _forbidShare,
        copyText: (text) async => copied.add(text),
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(opened, [Uri.parse('https://example.com/breaking')]);
    expect(copied, isEmpty);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });

  testWidgets('long-press breaking title does not trigger share', (tester) async {
    final shared = <({String title, Uri url})>[];
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        copyText: (text) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(shared, isEmpty);
  });

  testWidgets('copy throw does not open, share, mark 已读, or show snackbar',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent:
            ({required title, required url, required sharePositionOrigin}) async {
          shared.add((title: title, url: url));
        },
        copyText: (text) async => throw StateError('copy failed'),
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
    expect(_countText(tester), '未读 6');
  });
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
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
