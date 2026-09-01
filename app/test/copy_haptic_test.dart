import 'dart:convert';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

final _fixedNow = DateTime.parse('2026-08-26T02:00:00.000Z');

const _breakingTimeKey = Key('event-card-same-day-breaking-time');
const _hitKey = Key('last-refresh-hit');
const _copySnackKey = Key('copy-snackbar');
const _copyErrorSnackKey = Key('copy-error-snackbar');
const _tenMinutesAgo = '2026-08-26T01:50:00.000Z';

void main() {
  testWidgets(
      'long-press event-card-same-day-breaking-time plays one selectionClick haptic',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(
      tester,
      copyText: (_) async {},
    );

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(find.text('已复制'), findsOneWidget);
    expect(haptics.where(_isSelectionClick), hasLength(1));
  });

  testWidgets(
      'long-press last-refresh-hit plays one selectionClick haptic',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpLastRefresh(
      tester,
      copyText: (_) async {},
    );

    await tester.longPress(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copySnackKey), findsOneWidget);
    expect(haptics.where(_isSelectionClick), hasLength(1));
  });

  testWidgets(
      'copyText throw via the card path plays no haptic and shows 无法复制',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(
      tester,
      copyText: (_) async => throw StateError('copy failed'),
    );

    await tester.longPress(find.byKey(_breakingTimeKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_copyErrorSnackKey), findsOneWidget);
    expect(find.text('无法复制'), findsOneWidget);
    expect(find.byKey(_copySnackKey), findsNothing);
    expect(haptics, isEmpty);
  });
}

void _setDefaultSurface(WidgetTester tester) {
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

Future<void> _pumpDefault(
  WidgetTester tester, {
  required Future<void> Function(String text) copyText,
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

Future<void> _pumpLastRefresh(
  WidgetTester tester, {
  required Future<void> Function(String text) copyText,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => _fixtureWithUpdatedAt(_tenMinutesAgo),
        loadCache: () async => throw StateError('must not read cache'),
        loadFallback: () async => throw StateError('must not read sibling'),
        loadAsset: () async => throw StateError('must not read asset'),
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      copyText: copyText,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      now: () => _fixedNow,
    ),
  );
  await tester.pumpAndSettle();
}

String _fixtureWithUpdatedAt(String updatedAt) {
  final raw = loadFixtureJson();
  raw['updatedAt'] = updatedAt;
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
