import 'dart:convert';
import 'dart:io';

const fixturePath = 'test/fixtures/events.json';

String loadFixtureBytes() => File(fixturePath).readAsStringSync();

Map<String, dynamic> loadFixtureJson() {
  return Map<String, dynamic>.from(jsonDecode(loadFixtureBytes()) as Map);
}

/// Tests must never open a socket. Inject this instead of [httpGetText].
Future<String> forbidHttp(Uri uri) {
  throw StateError('tests must not hit the network ($uri)');
}
