import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/screens/people_screen.dart';

import '../helpers/mocks.dart';

Person _person({
  int id = 2,
  String name = 'Bobby',
  String? bio,
  Song? now,
  int playlists = 0,
  bool me = false,
  List<Playlist> list = const [],
}) =>
    Person(
      id: id,
      username: name.toLowerCase(),
      displayName: name,
      bio: bio,
      isMe: me,
      nowListening: now,
      publicPlaylistCount: playlists,
      playlists: list,
    );

Future<void> _pump(
  WidgetTester tester,
  Widget screen, {
  bool enabled = true,
  List<Person> people = const [],
  Person? person,
}) async {
  tester.view.physicalSize = const Size(420, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(MockSubsonicClient()),
      socialEnabledProvider.overrideWith((ref) async => enabled),
      peopleProvider.overrideWith((ref) async => people),
      personProvider.overrideWith((ref, id) async => person ?? _person()),
    ],
    child: MaterialApp(home: screen),
  ));
  await tester.pumpAndSettle();
}

const _song = Song(
  id: 's',
  title: 'Karma Police',
  artist: 'Radiohead',
  artistId: 'a',
  album: 'OK Computer',
  albumId: 'al',
  suffix: 'mp3',
);

void main() {
  group('Person.fromJson', () {
    test('parses a member with the song they chose to share', () {
      final p = Person.fromJson({
        'id': 2,
        'username': 'bob',
        'displayName': 'Bobby',
        'bio': 'Jazz',
        'hasAvatar': true,
        'avatarVersion': 7,
        'isMe': false,
        'publicPlaylistCount': 3,
        'nowListening': {
          'id': 's',
          'title': 'Karma Police',
          'artist': 'Radiohead',
          'suffix': 'mp3'
        },
      });
      expect(p.displayName, 'Bobby');
      expect(p.avatarVersion, 7);
      expect(p.nowListening?.title, 'Karma Police');
      expect(p.publicPlaylistCount, 3);
    });

    test('falls back to the username and treats missing parts as absent', () {
      final p = Person.fromJson({'id': 2, 'username': 'bob'});
      expect(p.displayName, 'bob');
      expect(p.nowListening, isNull);
      expect(p.playlists, isEmpty);
    });
  });

  group('MyProfile.fromJson', () {
    test('listening is off when the server says nothing (older server)', () {
      expect(MyProfile.fromJson(null).showListening, isFalse);
      expect(MyProfile.fromJson({'displayName': 'A'}).showListening, isFalse);
      expect(MyProfile.fromJson({'showListening': true}).showListening, isTrue);
    });
  });

  group('PeopleScreen', () {
    testWidgets('lists people with their bio or playlist count',
        (tester) async {
      await _pump(tester, const PeopleScreen(), people: [
        _person(bio: 'Jazz on Sundays'),
        _person(id: 3, name: 'Carol', playlists: 2),
        _person(id: 1, name: 'Me', me: true, playlists: 1),
      ]);
      expect(find.text('Bobby'), findsOneWidget);
      expect(find.text('Jazz on Sundays'), findsOneWidget);
      expect(find.text('2 public playlists'), findsOneWidget);
      expect(find.text('Me (you)'), findsOneWidget);
      expect(find.text('1 public playlist'), findsOneWidget);
    });

    testWidgets('shows what someone is listening to only when it was sent',
        (tester) async {
      await _pump(tester, const PeopleScreen(), people: [
        _person(now: _song),
        _person(id: 3, name: 'Carol'),
      ]);
      expect(
          find.text('Listening to Karma Police — Radiohead'), findsOneWidget);
      expect(find.textContaining('Listening to'), findsOneWidget);
    });

    testWidgets('says so when social features are off', (tester) async {
      await _pump(tester, const PeopleScreen(), enabled: false);
      expect(find.textContaining('turned off on this server'), findsOneWidget);
    });
  });

  group('PersonScreen', () {
    testWidgets('shows the profile and public playlists', (tester) async {
      await _pump(
        tester,
        const PersonScreen(id: 2),
        person: _person(bio: 'Hello there', list: const [
          Playlist(
              id: 'p1',
              name: 'Open mix',
              owner: 'bob',
              songCount: 1,
              duration: 100)
        ]),
      );
      expect(find.text('Bobby'), findsWidgets);
      expect(find.text('@bobby'), findsOneWidget);
      expect(find.text('Hello there'), findsOneWidget);
      expect(find.text('PUBLIC PLAYLISTS'), findsOneWidget);
      expect(find.text('Open mix'), findsOneWidget);
    });

    testWidgets('your own profile says "Your playlists"', (tester) async {
      await _pump(tester, const PersonScreen(id: 1),
          person: _person(id: 1, me: true));
      expect(find.text('YOUR PLAYLISTS'), findsOneWidget);
      expect(find.text('You have no playlists yet.'), findsOneWidget);
    });
  });
}
