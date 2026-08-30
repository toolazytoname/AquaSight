import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/models/event.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

const _errorTitleKey = Key('timeline-error-title');
const _errorDetailKey = Key('timeline-error-detail');
const _errorRetryKey = Key('timeline-error-retry');

void main() {
  testWidgets(
      'error-page title uses titleLarge + onSurface; detail stays variant',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpError(tester);

    expect(find.byKey(_errorTitleKey), findsOneWidget);
    final titleFinder = find.byKey(_errorTitleKey);
    final title = tester.widget<Text>(titleFinder);
    expect(title.data, '加载失败');

    final theme = Theme.of(tester.element(titleFinder));
    expect(title.style!.color, theme.colorScheme.onSurface);
    expect(
      title.style!.fontSize,
      theme.textTheme.titleLarge!.fontSize,
    );
    expect(title.style!.color, isNot(theme.colorScheme.onSurfaceVariant));

    expect(find.byKey(_errorDetailKey), findsOneWidget);
    final detailFinder = find.byKey(_errorDetailKey);
    final detail = tester.widget<Text>(detailFinder);
    final detailTheme = Theme.of(tester.element(detailFinder));
    expect(detail.style!.color, detailTheme.colorScheme.onSurfaceVariant);
    expect(
      detail.style!.fontSize,
      detailTheme.textTheme.bodyMedium!.fontSize,
    );

    expect(find.byKey(_errorRetryKey), findsOneWidget);
  });
}

Future<void> _pumpError(WidgetTester tester) async {
  await tester.pumpWidget(
    AquaApp(
      repository: EventsRepository(
        loadLive: () async => throw EventsLoadException('网络不可用'),
        loadCache: () async => null,
        loadFallback: () async => null,
        loadAsset: () async => null,
      ),
      openUrl: _forbidLaunch,
      shareEvent: _forbidShare,
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

Future<void> _forbidShare({
  required String title,
  required Uri url,
  required Rect sharePositionOrigin,
}) {
  throw StateError('tests must not share');
}
