import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/connect/connect_models.dart';
import 'package:riffplayer_mobile/connect/connect_notifier.dart';
import 'package:riffplayer_mobile/connect/connect_prefs.dart';
import 'package:riffplayer_mobile/connect/connect_provider.dart';
import 'package:riffplayer_mobile/connect/remote_queue.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/screens/queue_screen.dart';
import 'package:riffplayer_mobile/widgets/song_tile.dart';

import '../helpers/mocks.dart';

const me = 'me-device-0001';
const other = 'other-device-01';

Song song(String id) => Song(
      id: id,
      title: 'Title $id',
      artist: 'Artist $id',
      artistId: 'ar',
      album: 'Album',
      albumId: 'al',
      suffix: 'mp3',
      duration: 200,
    );

class _Prefs implements ConnectPrefs {
  @override
  Future<String?> deviceId() async => me;
  @override
  Future<void> saveDeviceId(String id) async {}
  @override
  Future<String?> deviceName() async => 'My phone';
  @override
  Future<void> saveDeviceName(String name) async {}
  @override
  Future<String?> deviceModel() async => null;
}

class SpyConnect extends ConnectNotifier {
  final played = <int>[];
  int watching = 0;
  int unwatched = 0;

  SpyConnect(PlayerNotifier player, MockDownloadService downloads)
      : super(
          player: player,
          downloads: downloads,
          prefs: _Prefs(),
          onRevoked: () async {},
          showMessage: (_) {},
        );

  void setTestState(ConnectState s) => state = s;

  @override
  void Function() watchRemoteQueue() {
    watching++;
    return () => unwatched++;
  }

  @override
  void playRemoteQueueItem(int index) => played.add(index);
}

class SpyPlayer extends PlayerNotifier {
  final removed = <int>[];
  final reordered = <(int, int)>[];
  SpyPlayer(super.handler);

  void setTestState(PlayerState s) => state = s;

  @override
  Future<void> removeFromQueue(int index) async => removed.add(index);

  @override
  Future<void> reorderQueue(int from, int to) async =>
      reordered.add((from, to));
}

void main() {
  setUpAll(registerMockFallbackValues);

  late MockAudioHandler handler;
  late MockDownloadService downloads;
  late SpyPlayer player;
  late SpyConnect connect;

  setUp(() {
    handler = MockAudioHandler();
    downloads = MockDownloadService();
    when(() => handler.positionStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.durationStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.playingStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.currentIndexStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.shuffleModeEnabledStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.loopModeStream).thenAnswer((_) => const Stream.empty());
    player = SpyPlayer(handler);
    connect = SpyConnect(player, downloads);
  });

  void remoteMode(RemoteQueueView? view) {
    connect.setTestState(ConnectState(
      status: ConnectStatus.online,
      deviceId: me,
      deviceName: 'My phone',
      devices: const [
        DeviceInfo(
            id: other,
            name: 'Desk PC',
            type: DeviceType.web,
            online: true,
            unreachable: false,
            active: true),
      ],
      activeDeviceId: other,
      remoteQueue: view,
    ));
  }

  RemoteQueueView view(List<String> ids, int index) => RemoteQueueView(
        version: 1,
        songs: ids.map(song).toList(),
        positions: List.generate(ids.length, (i) => i),
        index: index,
      );

  Future<void> pump(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        connectProvider.overrideWith((ref) => connect),
        playerProvider.overrideWith((ref) => player),
      ],
      child: const MaterialApp(home: QueueScreen()),
    ));
    await tester.pump();
  }

  testWidgets('shows this phone\'s own queue as before while it is the player',
      (tester) async {
    player.setTestState(
        PlayerState(queue: [song('a'), song('b'), song('c')], currentIndex: 0));
    await pump(tester);

    expect(find.text('NOW PLAYING'), findsOneWidget);
    expect(find.text('Title a'), findsOneWidget);
    expect(find.text('Title c'), findsOneWidget);
    expect(find.text('Clear'), findsOneWidget);
    expect(find.textContaining('On '), findsNothing);
  });

  testWidgets(
      'shows the other device\'s queue instead, names it, and hides "Clear"',
      (tester) async {
    player.setTestState(PlayerState(queue: [song('mine')], currentIndex: 0));
    remoteMode(view(['r0', 'r1', 'r2', 'r3'], 1));
    await pump(tester);

    expect(find.text('Title mine'), findsNothing);
    expect(find.text('On Desk PC'), findsOneWidget);
    expect(find.text('Title r1'), findsOneWidget); // now playing
    expect(find.text('Title r0'), findsNothing); // already played
    expect(find.text('Title r2'), findsOneWidget); // next up
    expect(find.text('Title r3'), findsOneWidget);
    expect(find.text('Clear'), findsNothing);
  });

  testWidgets('watches the remote queue while it is open and stops when closed',
      (tester) async {
    remoteMode(view(['r0'], 0));
    await pump(tester);
    expect(connect.watching, 1);
    expect(connect.unwatched, 0);

    await tester.pumpWidget(const SizedBox());
    expect(connect.unwatched, 1);
  });

  testWidgets('says it is loading until the queue arrives', (tester) async {
    remoteMode(null);
    await pump(tester);
    expect(find.text('Loading the queue…'), findsOneWidget);
  });

  testWidgets(
      'tapping a song jumps there on the other device, in queue positions',
      (tester) async {
    remoteMode(view(['r0', 'r1', 'r2', 'r3'], 1));
    await pump(tester);

    await tester.tap(find.text('Title r3'));
    await tester.pump();

    expect(
        connect.played, [3]); // r3 is at position 3 of the other device's queue
  });

  testWidgets('removing a song from the list edits the other device\'s queue',
      (tester) async {
    remoteMode(view(['r0', 'r1', 'r2', 'r3'], 1));
    await pump(tester);

    // Swipe-to-remove on the "next up" tile is wired through SongTile.onRemove.
    final tile =
        tester.widget<SongTile>(find.widgetWithText(SongTile, 'Title r3'));
    tile.onRemove!();
    expect(player.removed, [3]);
  });

  testWidgets(
      'reordering "next up" is sent with positions in the other device\'s queue',
      (tester) async {
    remoteMode(view(['r0', 'r1', 'r2', 'r3', 'r4'], 1));
    await pump(tester);

    // "next up" starts after the current song (position 2), so list index 0 is queue position 2.
    final list =
        tester.widget<ReorderableListView>(find.byType(ReorderableListView));
    list.onReorderItem!(0, 2);

    expect(player.reordered, [(2, 4)]);
  });
}
