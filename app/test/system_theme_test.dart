import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:aquasight/ui/timeline_page.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

void main() {
  Future<void> pumpFixtureApp(WidgetTester tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository(
          loadLive: () async => loadFixtureBytes(),
          loadFallback: () async => throw StateError('tests must not hit fallback'),
          loadCache: () async => throw StateError('tests must not read cache'),
          loadAsset: () async => throw StateError('tests must not read asset'),
        ),
        openUrl: (uri) async {
          throw StateError('tests must not open URLs ($uri)');
        },
        shareEvent: ({
          required title,
          required url,
          required sharePositionOrigin,
        }) async {
          throw StateError('tests must not share');
        },
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
      ),
    );
    await tester.pumpAndSettle();
  }

  Brightness timelineBrightness(WidgetTester tester) {
    return Theme.of(tester.element(find.byType(TimelinePage))).brightness;
  }

  testWidgets('system brightness drives TimelinePage Theme; MaterialApp follows system',
      (tester) async {
    addTearDown(tester.binding.platformDispatcher.clearPlatformBrightnessTestValue);

    tester.binding.platformDispatcher.platformBrightnessTestValue =
        Brightness.light;
    await pumpFixtureApp(tester);
    expect(timelineBrightness(tester), Brightness.light);

    tester.binding.platformDispatcher.platformBrightnessTestValue =
        Brightness.dark;
    await tester.pumpAndSettle();
    expect(timelineBrightness(tester), Brightness.dark);

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.system);
    expect(app.darkTheme, isNotNull);
  });

  testWidgets('light surfaces follow ColorScheme tokens, not parchment hex',
      (tester) async {
    addTearDown(tester.binding.platformDispatcher.clearPlatformBrightnessTestValue);
    tester.binding.platformDispatcher.platformBrightnessTestValue =
        Brightness.light;
    await pumpFixtureApp(tester);

    final scheme = Theme.of(tester.element(find.byType(TimelinePage))).colorScheme;
    expect(scheme.brightness, Brightness.light);
    expect(
      tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
      scheme.surface,
    );
    expect(
      tester.widget<Card>(find.byKey(const Key('event-card-same-day-breaking'))).color,
      scheme.errorContainer,
    );
  });

  testWidgets('dark surfaces follow ColorScheme tokens, not parchment hex',
      (tester) async {
    addTearDown(tester.binding.platformDispatcher.clearPlatformBrightnessTestValue);
    tester.binding.platformDispatcher.platformBrightnessTestValue =
        Brightness.dark;
    await pumpFixtureApp(tester);

    final scheme = Theme.of(tester.element(find.byType(TimelinePage))).colorScheme;
    expect(scheme.brightness, Brightness.dark);
    final scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
    final breaking = tester.widget<Card>(
      find.byKey(const Key('event-card-same-day-breaking')),
    );
    expect(scaffold.backgroundColor, scheme.surface);
    expect(scaffold.backgroundColor, isNot(const Color(0xFFF4EFE4)));
    expect(breaking.color, scheme.errorContainer);
    expect(breaking.color, isNot(const Color(0xFFFFF1EE)));
  });
}
