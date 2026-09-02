import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _allKey = Key('source-filter-all');
const _weiboKey = Key('source-filter-weibo');

void main() {
  testWidgets(
      'source-filter chips overlay uses theme primary splash 0.12 / 0.08',
      (tester) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

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

    final all = tester.widget<FilterChip>(find.byKey(_allKey));
    final weibo = tester.widget<FilterChip>(find.byKey(_weiboKey));
    expect(all, isA<FilterChip>());
    expect(weibo, isA<FilterChip>());

    for (final key in [_allKey, _weiboKey]) {
      final chip = tester.widget<FilterChip>(find.byKey(key));
      final theme = Theme.of(tester.element(find.byKey(key)));
      final scheme = theme.colorScheme;
      expect(theme.splashColor, scheme.primary.withValues(alpha: 0.12));
      expect(theme.hoverColor, scheme.primary.withValues(alpha: 0.08));
      expect(theme.focusColor, scheme.primary.withValues(alpha: 0.08));
      expect(theme.highlightColor, scheme.primary.withValues(alpha: 0.08));

      expect(chip.shape, isA<RoundedRectangleBorder>());
      expect(
        (chip.shape as RoundedRectangleBorder).borderRadius,
        BorderRadius.circular(8),
      );
    }
  });
}

Future<void> _forbidLaunch(Uri uri) {
  throw StateError('tests must not call launchUrl ($uri)');
}
