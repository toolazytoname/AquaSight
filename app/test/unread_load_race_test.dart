import 'dart:async';

import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _toggleKey = Key('unread-only-toggle');
const _breakingKey = Key('event-card-same-day-breaking');
const _breakingReadKey = Key('event-card-same-day-breaking-read');
const _normalKey = Key('event-card-same-day-normal-high-score');

const _allFixtureIds = [
  'cross-midnight',
  'same-day-normal-high-score',
  'same-day-breaking',
  'seen-only',
  'missing-title-zh',
  'unknown-date',
];

void main() {
  testWidgets(
      'seeded false, hang load, toggle on: release must not snap the toggle off',
      (tester) async {
    final hang = Completer<void>();
    final saved = <bool>[];
    final store = _hangableStore(
      seed: false,
      hang: hang,
      saved: saved,
    );

    await _pumpHungApp(tester, unreadOnly: store);
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pump();
    expect(_toggle(tester).value, isTrue);
    expect(saved, [true]);

    hang.complete();
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(saved, [true]);
    expect(store.value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.text('同日破圈'), findsNothing);
    expect(find.byKey(_normalKey), findsOneWidget);
    expect(find.byKey(const Key('event-card-cross-midnight')), findsOneWidget);
  });

  testWidgets(
      'seeded true, hang load, toggle off: release must not snap the toggle on',
      (tester) async {
    final hang = Completer<void>();
    final saved = <bool>[];
    final store = _hangableStore(
      seed: true,
      hang: hang,
      saved: saved,
    );

    await _pumpHungApp(tester, unreadOnly: store);
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);
    expect(_toggle(tester).value, isFalse);

    await tester.tap(find.byKey(_toggleKey));
    await tester.pump();
    expect(_toggle(tester).value, isTrue);
    await tester.tap(find.byKey(_toggleKey));
    await tester.pump();
    expect(_toggle(tester).value, isFalse);
    expect(saved, [true, false]);

    hang.complete();
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    expect(saved, [true, false]);
    expect(saved.last, isFalse);
    expect(store.value, isFalse);
    _expectAllFixtureCards();
    expect(find.byKey(_breakingReadKey), findsOneWidget);
  });

  testWidgets('hang load with no toggle still applies a seeded true',
      (tester) async {
    final hang = Completer<void>();
    final saved = <bool>[];
    final store = _hangableStore(
      seed: true,
      hang: hang,
      saved: saved,
    );

    await _pumpHungApp(tester, unreadOnly: store);
    expect(_toggle(tester).value, isFalse);
    expect(find.byKey(const Key('timeline-loading')), findsOneWidget);

    hang.complete();
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isTrue);
    expect(saved, isEmpty);
    expect(store.value, isTrue);
    expect(find.byKey(_breakingKey), findsNothing);
    expect(find.byKey(_breakingReadKey), findsNothing);
    expect(find.byKey(_normalKey), findsOneWidget);
  });

  testWidgets('hang load with no toggle still applies a seeded false',
      (tester) async {
    final hang = Completer<void>();
    final saved = <bool>[];
    final store = _hangableStore(
      seed: false,
      hang: hang,
      saved: saved,
    );

    await _pumpHungApp(tester, unreadOnly: store);
    expect(_toggle(tester).value, isFalse);

    hang.complete();
    await tester.pumpAndSettle();

    expect(_toggle(tester).value, isFalse);
    expect(saved, isEmpty);
    expect(store.value, isFalse);
    _expectAllFixtureCards();
    expect(find.byKey(_breakingReadKey), findsOneWidget);
  });
}

/// In-flight [loadValue] returns the original [seed], even if [save] ran.
UnreadOnlyStore _hangableStore({
  required bool seed,
  required Completer<void> hang,
  required List<bool> saved,
}) {
  return UnreadOnlyStore(
    loadValue: () async {
      await hang.future;
      return seed;
    },
    saveValue: (next) async => saved.add(next),
  );
}

Future<void> _pumpHungApp(
  WidgetTester tester, {
  required UnreadOnlyStore unreadOnly,
}) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository.fromJsonString(loadFixtureBytes()),
      openUrl: _forbidLaunch,
      readStore: ReadStore.memory({'same-day-breaking'}),
      unreadOnlyStore: unreadOnly,
    ),
  );
  await tester.pump();
}

Switch _toggle(WidgetTester tester) {
  return tester.widget<Switch>(find.byKey(_toggleKey));
}

void _expectAllFixtureCards() {
  for (final id in _allFixtureIds) {
    expect(find.byKey(Key('event-card-$id')), findsOneWidget);
  }
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
