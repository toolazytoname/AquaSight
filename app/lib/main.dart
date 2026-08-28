import 'package:flutter/material.dart';

import 'data/events_repository.dart';
import 'data/read_store.dart';
import 'data/unread_only_store.dart';
import 'ui/aqua_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(
    AquaApp(
      repository: EventsRepository.live(),
      readStore: ReadStore.documents(),
      unreadOnlyStore: UnreadOnlyStore.documents(),
    ),
  );
}
