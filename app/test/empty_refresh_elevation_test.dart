import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _refreshKey = Key('timeline-empty-refresh');
const _updatedA = '2026-08-26T01:00:00.000Z';

void main() {
  testWidgets(
      'timeline-empty-refresh FilledButton elevation is 0; min 48×48; radius 8',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(_emptyFixture(_updatedA)),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
        sourceFilterStore: SourceFilterStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(_refreshKey), findsOneWidget);
    expect(tester.widget(find.byKey(_refreshKey)), isA<FilledButton>());

    final button = tester.widget<FilledButton>(find.byKey(_refreshKey));
    expect(button.style!.elevation!.resolve({}), 0);

    final minimumSize = button.style!.minimumSize!.resolve({});
    expect(
      minimumSize,
      const Size(kMinInteractiveDimension, kMinInteractiveDimension),
    );
    expect(minimumSize, const Size(48, 48));

    final shape = button.style!.shape!.resolve({});
    expect(shape, isA<RoundedRectangleBorder>());
    expect(
      (shape! as RoundedRectangleBorder).borderRadius,
      BorderRadius.circular(8),
    );
  });
}

String _emptyFixture(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
  raw['items'] = [];
  return jsonEncode(raw);
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
