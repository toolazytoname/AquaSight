import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _endKey = Key('timeline-end');
const _scrollKey = Key('timeline-scroll');

void main() {
  testWidgets('cold start already at top: tap timeline-end plays no haptic',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(tester);

    expect(find.byKey(_endKey), findsOneWidget);
    expect(_scrollPixels(tester), 0);
    expect(haptics, isEmpty);

    // Below the fold at offset 0 on 390×800; invoke the same InkWell.onTap
    // a hit-tested tap would run so the offset==0 gate is actually checked.
    tester
        .widget<InkWell>(
          find.ancestor(
            of: find.byKey(_endKey),
            matching: find.byType(InkWell),
          ),
        )
        .onTap!();
    await tester.pumpAndSettle();

    expect(haptics, isEmpty);
    expect(_scrollPixels(tester), 0);
  });

  testWidgets(
      'after jumpTo maxScrollExtent: tap timeline-end plays one selectionClick',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(tester);

    expect(haptics, isEmpty);

    final controller = tester
        .widget<CustomScrollView>(find.byKey(_scrollKey))
        .controller!;
    expect(controller.hasClients, isTrue);
    expect(controller.position.maxScrollExtent, greaterThan(0));
    controller.jumpTo(controller.position.maxScrollExtent);
    await tester.pump();
    expect(_scrollPixels(tester), greaterThan(0));

    await tester.tap(find.byKey(_endKey));
    await tester.pumpAndSettle();

    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(_scrollPixels(tester), 0);
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

double _scrollPixels(WidgetTester tester) {
  return tester
      .widget<CustomScrollView>(find.byKey(_scrollKey))
      .controller!
      .position
      .pixels;
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
