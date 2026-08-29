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
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _openErrorSnackKey = Key('open-error-snackbar');
const _shareErrorSnackKey = Key('share-error-snackbar');
const _copySnackKey = Key('copy-snackbar');

void main() {
  testWidgets(
      'copyText throw shows 无法复制 once and does not open, share, mark read, or change unread',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          shared.add((title: title, url: url));
        },
        copyText: (text) async => throw StateError('copy failed'),
        readStore: store,
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
    expect(_countText(tester), '未读 6');

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
    expect(find.byKey(_openErrorSnackKey), findsNothing);
    expect(find.text('无法打开'), findsNothing);
    expect(find.byKey(_shareErrorSnackKey), findsNothing);
    expect(find.text('无法分享'), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('已读'), findsNothing);
    expect(_countText(tester), '未读 6');
  });

  testWidgets(
      'copyText success still shows 已复制 and does not show copy-error snackbar',
      (tester) async {
    final copied = <String>[];
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
    final store = ReadStore.memory();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async => opened.add(uri),
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
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
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
    expect(find.byKey(_copyErrorSnackKey), findsNothing);
    expect(find.text('无法复制'), findsNothing);
    expect(store.isRead('same-day-breaking'), isFalse);
    expect(_countText(tester), '未读 6');
  });

  testWidgets('copyText throw replaces 已复制 instead of stacking', (tester) async {
    var fail = false;
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async {},
        shareEvent: _forbidShare,
        copyText: (text) async {
          if (fail) throw StateError('copy failed');
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();
    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);

    fail = true;
    await tester.longPress(find.byKey(_breakingTitleKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(find.text('已复制'), findsNothing);
  });
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
