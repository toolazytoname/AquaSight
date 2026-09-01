import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _labelKey = Key('unread-only-label');
const _toggleKey = Key('unread-only-toggle');

void main() {
  testWidgets(
      'tap unread-only-toggle then unread-only-label each play one selectionClick',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpFixture(tester);

    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(_toggle(tester).value, isTrue);

    await tester.tap(find.byKey(_labelKey));
    await tester.pumpAndSettle();
    expect(haptics.where(_isSelectionClick), hasLength(2));
    expect(_toggle(tester).value, isFalse);
  });

  testWidgets(
      'cold-start restore of unread-only true plays no haptic',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpFixture(
      tester,
      unreadOnlyStore: UnreadOnlyStore.memory(true),
    );

    expect(_toggle(tester).value, isTrue);
    expect(haptics, isEmpty);
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

Future<void> _pumpFixture(
  WidgetTester tester, {
  UnreadOnlyStore? unreadOnlyStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: unreadOnlyStore ?? UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
