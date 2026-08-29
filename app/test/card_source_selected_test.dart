import 'package:aquasight/data/events_repository.dart';
import 'package:aquasight/data/read_store.dart';
import 'package:aquasight/data/scroll_offset_store.dart';
import 'package:aquasight/data/unread_only_store.dart';
import 'package:aquasight/ui/aqua_app.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fixture.dart';

const _breakingKey = Key('event-card-same-day-breaking');
const _breakingWeiboChipKey = Key('event-card-same-day-breaking-source-weibo');
const _breakingBaiduChipKey = Key('event-card-same-day-breaking-source-baidu');

void main() {
  testWidgets(
      'card weibo chip uses selected colors; baidu stays unselected; tap again restores',
      (tester) async {
    await tester.pumpWidget(
      AquaApp(
        repository: EventsRepository.fromJsonString(loadFixtureBytes()),
        openUrl: (uri) async {},
        readStore: ReadStore.memory(),
        unreadOnlyStore: UnreadOnlyStore.memory(),
        scrollOffsetStore: ScrollOffsetStore.memory(),
      ),
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.byKey(_breakingWeiboChipKey));
    await tester.tap(find.byKey(_breakingWeiboChipKey));
    await tester.pumpAndSettle();

    final cardContext = tester.element(find.byKey(_breakingKey));
    final scheme = Theme.of(cardContext).colorScheme;
    expect(
      _chip(tester, _breakingWeiboChipKey).backgroundColor,
      scheme.primaryContainer,
    );
    expect(
      _chip(tester, _breakingBaiduChipKey).backgroundColor,
      scheme.secondaryContainer,
    );

    await tester.ensureVisible(find.byKey(_breakingWeiboChipKey));
    await tester.tap(find.byKey(_breakingWeiboChipKey));
    await tester.pumpAndSettle();

    expect(
      _chip(tester, _breakingWeiboChipKey).backgroundColor,
      Theme.of(tester.element(find.byKey(_breakingKey)))
          .colorScheme
          .secondaryContainer,
    );
  });
}

Chip _chip(WidgetTester tester, Key key) {
  return tester.widget<Chip>(
    find.descendant(of: find.byKey(key), matching: find.byType(Chip)),
  );
}
