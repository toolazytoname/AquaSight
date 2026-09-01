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

const _breakingShareKey = Key('event-card-same-day-breaking-share');
const _shareErrorSnackKey = Key('share-error-snackbar');
const _breakingUrl = 'https://example.com/breaking';

void main() {
  testWidgets(
      'tap event-card-same-day-breaking-share plays one selectionClick haptic',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    final shared = <({String title, Uri url, Rect sharePositionOrigin})>[];
    await _pumpDefault(
      tester,
      shareEvent: ({
        required title,
        required url,
        required sharePositionOrigin,
      }) async {
        shared.add((
          title: title,
          url: url,
          sharePositionOrigin: sharePositionOrigin,
        ));
      },
    );

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(shared, hasLength(1));
    expect(shared.single.title, '同日破圈');
    expect(shared.single.url, Uri.parse(_breakingUrl));
    final origin = shared.single.sharePositionOrigin;
    expect(origin.isEmpty, isFalse);
    final buttonRect = tester.getRect(find.byKey(_breakingShareKey));
    expect(origin.inflate(1).overlaps(buttonRect), isTrue);
    expect(find.byKey(_shareErrorSnackKey), findsNothing);
  });

  testWidgets(
      'shareEvent throw plays no haptic and shows 无法分享',
      (tester) async {
    _setDefaultSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpDefault(
      tester,
      shareEvent: ({
        required title,
        required url,
        required sharePositionOrigin,
      }) async {
        throw StateError('share failed');
      },
    );

    await tester.tap(find.byKey(_breakingShareKey));
    await tester.pumpAndSettle();

    expect(find.byKey(_shareErrorSnackKey), findsOneWidget);
    expect(find.text('无法分享'), findsOneWidget);
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
  required ShareEvent shareEvent,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: shareEvent,
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

Future<void> _forbidCopy(String text) {
  throw StateError('tests must not copy ($text)');
}
