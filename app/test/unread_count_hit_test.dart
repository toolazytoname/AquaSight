import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _hitKey = Key('unread-count-hit');
const _countKey = Key('unread-count');
const _scrollKey = Key('timeline-scroll');
const _toggleKey = Key('unread-only-toggle');

void main() {
  testWidgets('unread-count-hit is at least 48×48 and larger than the text',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_hitKey), findsOneWidget);
    final hitSize = tester.getSize(find.byKey(_hitKey));
    expect(hitSize.width, greaterThanOrEqualTo(48));
    expect(hitSize.height, greaterThanOrEqualTo(48));

    final textSize = tester.getSize(find.byKey(_countKey));
    final textAlreadyMin = textSize.width >= 48 && textSize.height >= 48;
    expect(
      textAlreadyMin ||
          hitSize.width > textSize.width ||
          hitSize.height > textSize.height,
      isTrue,
    );
  });

  testWidgets(
      'memory(120) + tap unread-count-hit top-right jumps to top; no open/share/toggle',
      (tester) async {
    final opened = <Uri>[];
    final shared = <({String title, Uri url})>[];
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
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(120),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_scrollKey), findsOneWidget);
    expect((_scrollPixels(tester) - 120).abs(), lessThanOrEqualTo(2));
    expect(_toggle(tester).value, isFalse);
    expect(_countText(tester), '未读 6');

    await tester.tapAt(
      tester.getTopRight(find.byKey(_hitKey)) + const Offset(-4, 4),
    );
    await tester.pumpAndSettle();

    expect(_scrollPixels(tester).abs(), lessThanOrEqualTo(2));
    expect(opened, isEmpty);
    expect(shared, isEmpty);
    expect(_toggle(tester).value, isFalse);
    expect(_countText(tester), '未读 6');
  });
}

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<SingleChildScrollView>(find.byKey(_scrollKey))
      .controller!
      .offset;
}

String _countText(WidgetTester tester) {
  return tester.widget<Text>(find.byKey(_countKey)).data!;
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
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
