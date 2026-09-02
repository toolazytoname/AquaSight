import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _hitKey = Key('unread-count-hit');
const _countKey = Key('unread-count');

void main() {
  testWidgets(
      'cold start unread > 1: tap unread-count-hit plays one selectionClick',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(tester);

    expect(find.byKey(_hitKey), findsOneWidget);
    expect(_countText(tester), '未读 6');
    expect(haptics, isEmpty);

    await tester.tap(find.byKey(_hitKey));
    await tester.pumpAndSettle();

    expect(haptics.where(_isSelectionClick), hasLength(1));
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

Future<void> _pumpDefault(WidgetTester tester) async {
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
  throw StateError('tests must not share ($url)');
}

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
