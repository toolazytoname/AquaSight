import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/event_card.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');
const _openErrorSnackKey = Key('open-error-snackbar');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'tap event-card-same-day-breaking plays one selectionClick haptic',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    final opened = <Uri>[];
    await _pumpDefault(
      tester,
      openUrl: (uri) async {
        opened.add(uri);
      },
    );

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(opened, hasLength(1));
    expect(opened.single, Uri.parse(_breakingUrl));
    expect(find.byKey(_openErrorSnackKey), findsNothing);
  });

  testWidgets(
      'openUrl throw plays no haptic and shows 无法打开',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(
      tester,
      openUrl: (uri) async {
        throw StateError('opener failed');
      },
    );

    await tester.tap(find.byKey(_breakingKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_openErrorSnackKey), findsOneWidget);
    expect(find.text('无法打开'), findsOneWidget);
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
  required OpenUrl openUrl,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: openUrl,
      shareEvent: _forbidShare,
      copyText: _forbidCopy,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
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
