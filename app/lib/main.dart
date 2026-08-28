import 'package:flutter/material.dart';

import 'data/events_repository.dart';
import 'ui/aqua_app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(AquaApp(repository: EventsRepository.live()));
}
