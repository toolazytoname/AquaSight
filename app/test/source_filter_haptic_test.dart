import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');

void main() {
  testWidgets(
      'tap source-filter-weibo then source-filter-all each play one selectionClick',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpFixture(tester);

    expect(_chip(tester, _allKey).selected, isTrue);
    expect(_chip(tester, _weiboKey).selected, isFalse);

    await tester.ensureVisible(find.byKey(_weiboKey));
    await tester.tap(find.byKey(_weiboKey));
    await tester.pumpAndSettle();
    expect(haptics.where(_isSelectionClick), hasLength(1));
    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);

    await tester.tap(find.byKey(_allKey));
    await tester.pumpAndSettle();
    expect(haptics.where(_isSelectionClick), hasLength(2));
    expect(_chip(tester, _weiboKey).selected, isFalse);
    expect(_chip(tester, _allKey).selected, isTrue);
  });

  testWidgets(
      'cold-start restore of weibo source filter plays no haptic',
      (tester) async {
    _setPhoneSurface(tester);
    final haptics = _listenHaptics(tester);
    await _pumpFixture(
      tester,
      sourceFilterStore: SourceFilterStore.memory('weibo'),
    );

    expect(_chip(tester, _weiboKey).selected, isTrue);
    expect(_chip(tester, _allKey).selected, isFalse);
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
  SourceFilterStore? sourceFilterStore,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: sourceFilterStore ?? SourceFilterStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

FilterChip _chip(WidgetTester tester, Key key) {
  return tester.widget<FilterChip>(find.byKey(key));
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
