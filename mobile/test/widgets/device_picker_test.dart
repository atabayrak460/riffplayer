import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart' show LoopMode;
import 'package:go_router/go_router.dart';
import 'package:mocktail/mocktail.dart';
import 'package:riffplayer_mobile/api/types.dart';
import 'package:riffplayer_mobile/connect/connect_models.dart';
import 'package:riffplayer_mobile/connect/connect_notifier.dart';
import 'package:riffplayer_mobile/connect/connect_prefs.dart';
import 'package:riffplayer_mobile/connect/connect_provider.dart';
import 'package:riffplayer_mobile/providers/providers.dart';
import 'package:riffplayer_mobile/services/audio_output.dart';
import 'package:riffplayer_mobile/widgets/device_picker.dart';
import 'package:riffplayer_mobile/widgets/mini_player.dart';

import '../helpers/mocks.dart';

const me = 'me-device-0001';
const phone = 'phone-device-01';

DeviceInfo device(
  String id, {
  String? name,
  DeviceType type = DeviceType.android,
  bool online = true,
  bool unreachable = false,
  bool active = false,
}) =>
    DeviceInfo(
      id: id,
      name: name ?? (id == me ? 'My phone' : 'Desk PC'),
      type: type,
      online: online,
      unreachable: unreachable,
      active: active,
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

/// A [ConnectNotifier] whose state tests set directly, and whose side effects are recorded.
class SpyConnect extends ConnectNotifier {
  final transfers = <String>[];
  final renames = <String>[];
  final volumes = <double>[];

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
  void setVolume(double volume) => volumes.add(volume);

  @override
  Future<void> transferTo(String deviceId) async => transfers.add(deviceId);

  @override
  Future<void> transferHere() async => transfers.add(state.deviceId);

  @override
  Future<void> renameThisDevice(String name) async {
    renames.add(name);
    state = state.copyWith(deviceName: name.trim());
  }
}

class _FakeOutput implements AudioOutputService {
  AudioOutput output = const AudioOutput();
  bool canOpen = true;
  int opened = 0;
  int permissionRequests = 0;
  final _changes = StreamController<AudioOutput>.broadcast();

  @override
  Future<AudioOutput> current() async => output;
  @override
  Future<bool> openSwitcher() async {
    opened++;
    return canOpen;
  }

  @override
  Future<void> requestBluetoothPermission() async {
    permissionRequests++;
    output = const AudioOutput(label: 'Bluetooth: JBL Flip 6');
  }

  @override
  Stream<AudioOutput> get changes => _changes.stream;
}

Song _song(String id) => Song(
      id: id,
      title: 'Title $id',
      artist: 'Artist $id',
      artistId: 'artist-1',
      album: 'Album',
      albumId: 'album-1',
      suffix: 'mp3',
      duration: 200,
    );

void main() {
  setUpAll(registerMockFallbackValues);

  late MockAudioHandler handler;
  late MockDownloadService downloads;
  late MockSubsonicClient client;
  late PlayerNotifier player;
  late SpyConnect connect;
  late _FakeOutput outputService;

  setUp(() {
    handler = MockAudioHandler();
    downloads = MockDownloadService();
    client = MockSubsonicClient();
    when(() => handler.positionStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.durationStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.playingStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.currentIndexStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.shuffleModeEnabledStream)
        .thenAnswer((_) => const Stream.empty());
    when(() => handler.loopModeStream).thenAnswer((_) => const Stream.empty());
    when(() => handler.play()).thenAnswer((_) async {});
    when(() => handler.pause()).thenAnswer((_) async {});
    when(() => handler.playQueue(any(), any())).thenAnswer((_) async {});
    when(() => downloads.localPath(any())).thenAnswer((_) async => null);
    when(() => client.streamUrl(any())).thenReturn('http://test/stream');
    when(() => client.scrobble(any(), submission: any(named: 'submission')))
        .thenAnswer((_) async {});
    player = PlayerNotifier(handler);
    connect = SpyConnect(player, downloads);
    outputService = _FakeOutput();
  });

  void setConnect({
    ConnectStatus status = ConnectStatus.online,
    List<DeviceInfo> devices = const [],
    String? active,
  }) {
    connect.setTestState(ConnectState(
      status: status,
      deviceId: me,
      deviceName: 'My phone',
      devices: devices,
      activeDeviceId: active,
    ));
  }

  Future<void> pump(WidgetTester tester, Widget child) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        connectProvider.overrideWith((ref) => connect),
        playerProvider.overrideWith((ref) => player),
        apiClientProvider.overrideWithValue(client),
        downloadServiceProvider.overrideWithValue(downloads),
        audioOutputServiceProvider.overrideWithValue(outputService),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: child,
          ),
        ),
      ),
    ));
    await tester.pump();
  }

  // ── Pure helpers ───────────────────────────────────────────────────────────

  group('helpers', () {
    test(
        'sortDevices: this device, then the playing one, then others, then those that are gone',
        () {
      final sorted = sortDevices([
        device('d-gone-00000001',
            name: 'Old tablet', online: false, unreachable: true),
        device('c-laptop-00001', name: 'Laptop'),
        device('b-pc-0000000001', name: 'Desk PC', active: true),
        device(me, name: 'My phone'),
      ], me);

      expect(sorted.map((d) => d.name),
          ['My phone', 'Desk PC', 'Laptop', 'Old tablet']);
    });

    test(
        'a device\'s output is part of its subtitle, and parsed from the server',
        () {
      final d = DeviceInfo.fromJson({
        'id': 'x-0000000001',
        'name': 'Pixel',
        'type': 'android',
        'output': 'Bluetooth: JBL',
      });
      expect(d.output, 'Bluetooth: JBL');
      expect(deviceSubtitle(d, me), 'Android · Bluetooth: JBL');
      expect(
          DeviceInfo.fromJson({'id': 'y', 'name': 'n', 'type': 'web'}).output,
          isNull);
    });

    test('sortDevices orders equals by name, ignoring case', () {
      final sorted = sortDevices([
        device('b-00000000001', name: 'zeta'),
        device('a-00000000001', name: 'Alpha')
      ], me);
      expect(sorted.map((d) => d.name), ['Alpha', 'zeta']);
    });

    test(
        'deviceSubtitle: type, "This device", "Playing", reconnecting and unreachable',
        () {
      expect(deviceSubtitle(device(me), me), 'Android · This device');
      expect(
          deviceSubtitle(
              device('x-0000000001', type: DeviceType.web, active: true), me),
          'Web · Playing');
      expect(
          deviceSubtitle(device('x-0000000001', type: DeviceType.desktop), me),
          'Desktop');
      expect(deviceSubtitle(device('x-0000000001', online: false), me),
          'Android · Reconnecting…');
      expect(
          deviceSubtitle(
              device('x-0000000001', online: false, unreachable: true), me),
          'Android · Unreachable');
    });

    test(
        'remoteLabel: "Playing on", reconnecting, unreachable — and null when this device plays',
        () {
      ConnectState s(List<DeviceInfo> d, String? active) => ConnectState(
          status: ConnectStatus.online,
          deviceId: me,
          deviceName: 'x',
          devices: d,
          activeDeviceId: active);

      final playing = remoteLabel(
          s([device(me), device(phone, name: 'Desk PC', active: true)], phone));
      expect(
          (playing?.text, playing?.unreachable), ('Playing on Desk PC', false));

      final blip = remoteLabel(s([
        device(me),
        device(phone, name: 'Desk PC', active: true, online: false)
      ], phone));
      expect(
          (blip?.text, blip?.unreachable), ('Desk PC · reconnecting…', false));

      final gone = remoteLabel(s([
        device(me),
        device(phone,
            name: 'Desk PC', active: true, online: false, unreachable: true)
      ], phone));
      expect((gone?.text, gone?.unreachable), ('Desk PC is unreachable', true));

      expect(remoteLabel(s([device(me, active: true)], me)), isNull);
      expect(remoteLabel(s([device(me)], null)), isNull);
      expect(remoteLabel(s([device(me)], phone)),
          isNull); // active device not in the list
    });
  });

  // ── The button ─────────────────────────────────────────────────────────────

  group('DevicePickerButton', () {
    testWidgets(
        'is hidden until connected, and against a server without Connect',
        (tester) async {
      for (final status in [ConnectStatus.idle, ConnectStatus.unavailable]) {
        setConnect(status: status);
        await pump(tester, const DevicePickerButton());
        expect(find.byTooltip('Connect to a device'), findsNothing,
            reason: '$status');
      }
    });

    testWidgets('shows for connecting, offline and online', (tester) async {
      for (final status in [
        ConnectStatus.connecting,
        ConnectStatus.offline,
        ConnectStatus.online
      ]) {
        setConnect(status: status);
        await pump(tester, const DevicePickerButton());
        expect(find.byTooltip('Connect to a device'), findsOneWidget,
            reason: '$status');
      }
    });

    testWidgets('is highlighted while another device is the one playing',
        (tester) async {
      setConnect(
          devices: [device(me), device(phone, active: true)], active: phone);
      await pump(tester, const DevicePickerButton());

      final icon =
          tester.widget<Icon>(find.byIcon(Icons.speaker_group_outlined));
      expect(icon.color, isNotNull);
    });

    testWidgets('opens the device list on tap', (tester) async {
      setConnect(devices: [device(me)]);
      await pump(tester, const DevicePickerButton());

      await tester.tap(find.byTooltip('Connect to a device'));
      await tester.pumpAndSettle();

      expect(find.text('CONNECT TO A DEVICE'), findsOneWidget);
    });
  });

  // ── The sheet ──────────────────────────────────────────────────────────────

  group('DevicePickerSheet', () {
    Future<void> open(WidgetTester tester) async {
      await pump(tester, const DevicePickerButton());
      await tester.tap(find.byTooltip('Connect to a device'));
      await tester.pumpAndSettle();
    }

    testWidgets(
        'shows the phone speaker as the output until something else is connected',
        (tester) async {
      setConnect(devices: [device(me)]);
      await open(tester);
      expect(find.text('AUDIO OUTPUT'), findsOneWidget);
      expect(find.text('Phone speaker'), findsOneWidget);
    });

    testWidgets(
        'shows a connected Bluetooth speaker, and hands over to the system switcher',
        (tester) async {
      outputService.output = const AudioOutput(label: 'Bluetooth: JBL Flip 6');
      setConnect(devices: [device(me)]);
      await open(tester);
      expect(find.text('Bluetooth: JBL Flip 6'), findsOneWidget);

      await tester.tap(find.text('Change'));
      await tester.pumpAndSettle();
      expect(outputService.opened, 1);
    });

    testWidgets('says what to do when the system switcher cannot be opened',
        (tester) async {
      outputService.canOpen = false;
      setConnect(devices: [device(me)]);
      await open(tester);
      await tester.tap(find.text('Change'));
      await tester.pumpAndSettle();
      expect(
          find.textContaining('Bluetooth or sound settings'), findsOneWidget);
    });

    testWidgets(
        'asks for permission to read the speaker\'s name, then shows it',
        (tester) async {
      outputService.output =
          const AudioOutput(label: 'Bluetooth speaker', needsPermission: true);
      setConnect(devices: [device(me)]);
      await open(tester);

      await tester.tap(find.text('Show the speaker\'s name'));
      await tester.pumpAndSettle();

      expect(outputService.permissionRequests, 1);
      expect(find.text('Bluetooth: JBL Flip 6'), findsOneWidget);
      expect(find.text('Show the speaker\'s name'), findsNothing);
    });

    testWidgets('shows other devices\' outputs in the list', (tester) async {
      setConnect(devices: [
        device(me),
        const DeviceInfo(
            id: phone,
            name: 'Pixel',
            type: DeviceType.android,
            online: true,
            unreachable: false,
            active: false,
            output: 'Headphones'),
      ]);
      await open(tester);
      expect(find.text('Android · Headphones'), findsOneWidget);
    });

    testWidgets('lists every device with its label', (tester) async {
      setConnect(
        devices: [
          device(me),
          device(phone, name: 'Desk PC', type: DeviceType.web, active: true),
          device('c-gone-0000001',
              name: 'Lost', online: false, unreachable: true),
        ],
        active: phone,
      );
      await open(tester);

      expect(find.text('My phone'), findsOneWidget);
      expect(find.text('Android · This device'), findsOneWidget);
      expect(find.text('Web · Playing'), findsOneWidget);
      expect(find.text('Android · Unreachable'), findsOneWidget);
    });

    testWidgets(
        'shows a volume slider for the device that is playing and drives its volume',
        (tester) async {
      connect.setTestState(ConnectState(
        status: ConnectStatus.online,
        deviceId: me,
        deviceName: 'My phone',
        devices: [device(me), device(phone, active: true)],
        activeDeviceId: phone,
        remote: const PublicState(
          activeDeviceId: phone,
          playing: true,
          song: null,
          index: 0,
          queueLength: 1,
          queueVersion: 1,
          positionMs: 0,
          positionAtMs: 0,
          durationMs: null,
          repeat: LoopMode.off,
          shuffle: false,
          counted: false,
          volume: 0.25,
        ),
      ));
      await open(tester);

      final slider =
          tester.widget<Slider>(find.byKey(const Key('remote-volume')));
      expect(slider.value, 0.25);

      slider.onChanged!(0.8);
      expect(connect.volumes, [0.8]);
    });

    testWidgets(
        'no volume slider when this device is the player, or the playing device is gone',
        (tester) async {
      setConnect(
          devices: [device(me, active: true), device(phone)], active: me);
      await open(tester);
      expect(find.byKey(const Key('remote-volume')), findsNothing);
      Navigator.of(tester.element(find.byType(DevicePickerSheet))).pop();
      await tester.pumpAndSettle();

      setConnect(devices: [
        device(me),
        device(phone, active: true, online: false, unreachable: true),
      ], active: phone);
      await tester.tap(find.byTooltip('Connect to a device'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('remote-volume')), findsNothing);
    });

    testWidgets(
        'offers "Play here" on this device while another one is playing',
        (tester) async {
      setConnect(
          devices: [device(me), device(phone, active: true)], active: phone);
      await open(tester);
      expect(find.text('Play here'), findsOneWidget);

      await tester.tap(find.text('My phone'));
      await tester.pumpAndSettle();

      expect(connect.transfers, [me]);
    });

    testWidgets('no "Play here" when this device is the one playing',
        (tester) async {
      setConnect(devices: [device(me, active: true)], active: me);
      await open(tester);
      expect(find.text('Play here'), findsNothing);
    });

    testWidgets(
        'choosing another online device hands playback to it and closes the sheet',
        (tester) async {
      setConnect(devices: [device(me), device(phone, name: 'Desk PC')]);
      await open(tester);

      await tester.tap(find.text('Desk PC'));
      await tester.pumpAndSettle();

      expect(connect.transfers, [phone]);
      expect(find.text('CONNECT TO A DEVICE'), findsNothing);
    });

    testWidgets('choosing the device that is already playing does nothing',
        (tester) async {
      setConnect(
          devices: [device(me), device(phone, name: 'Desk PC', active: true)],
          active: phone);
      await open(tester);

      await tester.tap(find.text('Desk PC'));
      await tester.pumpAndSettle();

      expect(connect.transfers, isEmpty);
    });

    testWidgets('a device that is gone cannot be chosen', (tester) async {
      setConnect(devices: [
        device(me),
        device(phone, name: 'Lost', online: false, unreachable: true)
      ]);
      await open(tester);

      await tester.tap(find.text('Lost'));
      await tester.pumpAndSettle();

      expect(connect.transfers, isEmpty);
      expect(
          find.text('CONNECT TO A DEVICE'), findsOneWidget); // sheet stays open
    });

    testWidgets(
        'suggests opening RiffPlayer elsewhere when this is the only device',
        (tester) async {
      setConnect(devices: [device(me)]);
      await open(tester);
      expect(find.text('Open RiffPlayer on another device to see it here.'),
          findsOneWidget);
    });

    testWidgets(
        'tells the user when the connection is down or still being made',
        (tester) async {
      setConnect(status: ConnectStatus.offline, devices: [device(me)]);
      await open(tester);
      expect(find.text('Not connected — trying again'), findsOneWidget);
      expect(find.text('Open RiffPlayer on another device to see it here.'),
          findsNothing);
    });

    testWidgets('says "Connecting…" while connecting', (tester) async {
      setConnect(status: ConnectStatus.connecting);
      await open(tester);
      expect(find.text('Connecting…'), findsOneWidget);
    });
  });

  // ── The label ──────────────────────────────────────────────────────────────

  group('RemoteLabel', () {
    testWidgets('says which device is playing while it is another one',
        (tester) async {
      setConnect(
          devices: [device(me), device(phone, name: 'Desk PC', active: true)],
          active: phone);
      await pump(tester, const RemoteLabel());
      expect(find.text('Playing on Desk PC'), findsOneWidget);
    });

    testWidgets('shows nothing when this device is the player', (tester) async {
      setConnect(devices: [device(me, active: true)], active: me);
      await pump(tester, const RemoteLabel());
      expect(find.textContaining('Playing on'), findsNothing);
    });

    testWidgets(
        'offers "Continue here" once the playing device is unreachable, and it brings playback over',
        (tester) async {
      setConnect(devices: [
        device(me),
        device(phone,
            name: 'Desk PC', active: true, online: false, unreachable: true)
      ], active: phone);
      await pump(tester, const RemoteLabel());
      expect(find.text('Desk PC is unreachable'), findsOneWidget);

      await tester.tap(find.text('Continue here'));
      await tester.pump();

      expect(connect.transfers, [me]);
    });

    testWidgets('no "Continue here" while the device is merely reconnecting',
        (tester) async {
      setConnect(devices: [
        device(me),
        device(phone, name: 'Desk PC', active: true, online: false)
      ], active: phone);
      await pump(tester, const RemoteLabel());
      expect(find.text('Continue here'), findsNothing);
      expect(find.text('Desk PC · reconnecting…'), findsOneWidget);
    });
  });

  // ── Settings: the device name ──────────────────────────────────────────────

  group('DeviceNameSection', () {
    testWidgets(
        'shows the current name; Save is disabled until the name really changes',
        (tester) async {
      setConnect();
      await pump(tester, const DeviceNameSection());
      expect(find.widgetWithText(TextField, 'My phone'), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNull);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pump();
      expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNull);

      await tester.enterText(find.byType(TextField), 'Kitchen phone');
      await tester.pump();
      expect(tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
          isNotNull);
    });

    testWidgets(
        'saves the new name and confirms it, and drops the confirmation on the next edit',
        (tester) async {
      setConnect();
      await pump(tester, const DeviceNameSection());
      await tester.enterText(find.byType(TextField), 'Kitchen phone');
      await tester.pump();

      await tester.tap(find.byType(FilledButton));
      await tester.pump();

      expect(connect.renames, ['Kitchen phone']);
      expect(find.text('Saved'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'Kitchen phone 2');
      await tester.pump();
      expect(find.text('Saved'), findsNothing);
    });

    testWidgets('limits the name to 40 characters', (tester) async {
      setConnect();
      await pump(tester, const DeviceNameSection());
      expect(tester.widget<TextField>(find.byType(TextField)).maxLength, 40);
    });

    testWidgets('is hidden against a server without Connect', (tester) async {
      setConnect(status: ConnectStatus.unavailable);
      await pump(tester, const DeviceNameSection());
      expect(find.text('THIS DEVICE'), findsNothing);
    });
  });

  // ── Mini player ────────────────────────────────────────────────────────────

  group('MiniPlayer with Connect', () {
    Future<void> pumpMini(WidgetTester tester) async {
      await player.playSong(_song('a'), client, downloads);
      final router = GoRouter(
        routes: [
          GoRoute(
              path: '/', builder: (_, __) => const Scaffold(body: MiniPlayer()))
        ],
      );
      await tester.pumpWidget(ProviderScope(
        overrides: [
          connectProvider.overrideWith((ref) => connect),
          playerProvider.overrideWith((ref) => player),
          apiClientProvider.overrideWithValue(client),
          downloadServiceProvider.overrideWithValue(downloads),
        ],
        child: MaterialApp.router(routerConfig: router),
      ));
      await tester.pump();
    }

    testWidgets('names the device that is playing next to the artist',
        (tester) async {
      setConnect(
          devices: [device(me), device(phone, name: 'Desk PC', active: true)],
          active: phone);
      await pumpMini(tester);

      expect(find.text('Artist a · Playing on Desk PC'), findsOneWidget);
    });

    testWidgets('shows just the artist when this device is the player',
        (tester) async {
      setConnect(devices: [device(me, active: true)], active: me);
      await pumpMini(tester);

      expect(find.text('Artist a'), findsOneWidget);
    });
  });
}
