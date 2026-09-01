import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/source_filter_store.dart';
import 'package:aquasight/data/title_search_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _searchKey = Key('timeline-search');
const _searchIconKey = Key('timeline-search-icon');
const _clearKey = Key('timeline-search-clear');

void main() {
  testWidgets(
      'timeline-search-icon is InkWell with theme primary splash; no wrapping onTap GestureDetector',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpLive(tester);

    final iconFinder = find.byKey(_searchIconKey);
    expect(iconFinder, findsOneWidget);

    final hitFinder = find.ancestor(
      of: iconFinder,
      matching: find.byType(InkWell),
    );
    expect(hitFinder, findsOneWidget);

    final inkWell = tester.widget<InkWell>(hitFinder);
    final scheme = Theme.of(tester.element(hitFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);

    final hitSize = tester.getSize(hitFinder);
    expect(hitSize.width, greaterThanOrEqualTo(kMinInteractiveDimension));
    expect(hitSize.height, greaterThanOrEqualTo(kMinInteractiveDimension));

    // Ancestors of timeline-search-icon only (not a global find.byType).
    // InkWell inserts an inner GestureDetector with onTap; skip those
    // descendants. Our wrapping GestureDetector is gone.
    final gestureDetectors = find.ancestor(
      of: iconFinder,
      matching: find.byType(GestureDetector),
    );
    for (final element in gestureDetectors.evaluate()) {
      final insideInkWell = find
          .descendant(
            of: hitFinder,
            matching: find.byWidget(element.widget),
          )
          .evaluate()
          .isNotEmpty;
      if (insideInkWell) continue;
      expect((element.widget as GestureDetector).onTap, isNull);
    }

    expect(_searchHasFocus(tester), isFalse);
    expect(find.byKey(_clearKey), findsNothing);

    await tester.tap(iconFinder);
    await tester.pumpAndSettle();

    expect(_searchFocusNode(tester).hasFocus, isTrue);
    expect(_searchField(tester).controller!.text, isEmpty);
    expect(find.byKey(_clearKey), findsNothing);
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpLive(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
      scrollOffsetStore: ScrollOffsetStore.memory(),
      sourceFilterStore: SourceFilterStore.memory(),
      titleSearchStore: TitleSearchStore.memory(),
    ),
  );
  await tester.pumpAndSettle();
}

FocusNode _searchFocusNode(WidgetTester tester) {
  return tester
      .widget<EditableText>(
        find.descendant(
          of: find.byKey(_searchKey),
          matching: find.byType(EditableText),
        ),
      )
      .focusNode;
}

bool _searchHasFocus(WidgetTester tester) {
  return _searchFocusNode(tester).hasFocus;
}

TextField _searchField(WidgetTester tester) {
  return tester.widget<TextField>(find.byKey(_searchKey));
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
