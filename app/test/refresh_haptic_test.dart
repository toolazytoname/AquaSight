import 'dart:async';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');

void main() {
  testWidgets(
      'RefreshIndicator.show that runs _reload plays one selectionClick',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpFixture(tester);

    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(haptics, isEmpty);

    final refresh = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pumpAndSettle();
    await refresh;

    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(find.byKey(_breakingKey), findsOneWidget);
  });

  testWidgets(
      'second RefreshIndicator.show while _refreshing plays no extra haptic',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    var loads = 0;
    final hang = Completer<String>();
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async {
            loads++;
            if (loads == 1) return loadFixtureBytes();
            return hang.future;
          },
          loadCache: () async => null,
          loadFallback: () async => throw StateError('must not read sibling'),
          loadAsset: () async => throw StateError('must not read asset'),
        ),
        openUrl: _forbidLaunch,
        shareEvent: _forbidShare,
        copyText: _forbidCopy,
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    expect(loads, 1);
    expect(find.byKey(_breakingKey), findsOneWidget);
    expect(haptics, isEmpty);

    final first = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));
    expect(loads, 2);
    expect(haptics.where(_isSelectionClick), hasLength(1));

    final second = tester
        .state<RefreshIndicatorState>(find.byType(RefreshIndicator))
        .show();
    await tester.pump();
    expect(loads, 2);
    expect(haptics.where(_isSelectionClick), hasLength(1));

    hang.complete(loadFixtureBytes());
    await tester.pumpAndSettle();
    await first;
    await second;

    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(find.byKey(_breakingKey), findsOneWidget);
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

List<MethodCall> _listenHaptics(WidgetTester tester) {
  final calls = <MethodCall>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
    SystemChannels.platform,
    (MethodCall call) async {
      if (call.method == 'HapticFeedback.vibrate') {
        calls.add(call);
      }
      return null;
    },
  );
  addTearDown(() {
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
      SystemChannels.platform,
      null,
    );
  });
  return calls;
}

/// Matches the argument `HapticFeedback.selectionClick` actually sends.
bool _isSelectionClick(MethodCall call) {
  if (call.method != 'HapticFeedback.vibrate') return false;
  final args = call.arguments;
  if (args == 'HapticFeedbackType.selectionClick') return true;
  if (args == 'selectionClick') return true;
  if (args is Enum) {
    return args.name == 'selectionClick';
  }
  if (args is Map) {
    return args.values.any(
      (value) =>
          value == 'HapticFeedbackType.selectionClick' ||
          value == 'selectionClick',
    );
  }
  return args.toString().contains('selectionClick');
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: _forbidCopy,
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
