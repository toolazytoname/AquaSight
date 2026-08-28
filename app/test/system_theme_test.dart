import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
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
}
