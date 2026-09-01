import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _labelKey = Key('unread-only-label');
const _toggleKey = Key('unread-only-toggle');

void main() {
  testWidgets('tap unread-only-label toggles unread-only on then off',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_labelKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isTrue);

    await tester.tap(find.byKey(_labelKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isFalse);
  });

  testWidgets('tap unread-only-toggle still toggles unread-only on then off',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isTrue);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pumpAndSettle();
    expect(_toggle(tester).value, isFalse);
  });

  testWidgets(
      'unread-only-label ancestor InkWell uses theme primary splash tokens',
      (tester) async {
    _setPhoneSurface(tester);
    await _pumpFixture(tester);

    final labelFinder = find.byKey(_labelKey);
    final inkWell = tester.widget<InkWell>(
      find.ancestor(
        of: labelFinder,
        matching: find.byType(InkWell),
      ),
    );
    final scheme = Theme.of(tester.element(labelFinder)).colorScheme;
    expect(inkWell.splashColor, scheme.primary.withValues(alpha: 0.12));
    expect(inkWell.highlightColor, scheme.primary.withValues(alpha: 0.08));
    expect(inkWell.onTap, isNotNull);
  });
}

void _setPhoneSurface(WidgetTester tester) {
  tester.view.physicalSize = const Size(390, 800);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

Future<void> _pumpFixture(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory(),
      unreadOnlyStore: UnreadOnlyStore.memory(),
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
