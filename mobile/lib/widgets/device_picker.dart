import '../services/audio_output.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../connect/connect_models.dart';
import '../connect/connect_notifier.dart';
import '../connect/connect_provider.dart';
import '../app_colors.dart';

Color get _muted => AppColors.muted;

/// This device first, then whichever is playing, then the rest online, then the ones that are gone.
List<DeviceInfo> sortDevices(List<DeviceInfo> devices, String thisId) {
  int rank(DeviceInfo d) =>
      d.id == thisId ? 0 : (d.active ? 1 : (d.online ? 2 : 3));
  final sorted = [...devices];
  sorted.sort((a, b) {
    final byRank = rank(a).compareTo(rank(b));
    return byRank != 0
        ? byRank
        : a.name.toLowerCase().compareTo(b.name.toLowerCase());
  });
  return sorted;
}

String deviceTypeLabel(DeviceType t) => switch (t) {
      DeviceType.web => 'Web',
      DeviceType.android => 'Android',
      DeviceType.desktop => 'Desktop',
    };

String deviceSubtitle(DeviceInfo d, String thisId) {
  final parts = [deviceTypeLabel(d.type)];
  if (d.id == thisId) parts.add('This device');
  if (d.active && d.online) parts.add('Playing');
  if (!d.online) parts.add(d.unreachable ? 'Unreachable' : 'Reconnecting…');
  if (d.output != null) parts.add(d.output!);
  return parts.join(' · ');
}

/// Speaker button that opens the device list (Spotify-Connect style). Hidden until connected, and
/// against an older server that has no Connect.
class DevicePickerButton extends ConsumerWidget {
  const DevicePickerButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(connectProvider.select((s) => s.status));
    final remoteActive =
        ref.watch(connectProvider.select((s) => s.remoteActive));
    if (status == ConnectStatus.idle || status == ConnectStatus.unavailable) {
      return const SizedBox.shrink();
    }
    return IconButton(
      icon: Icon(
        Icons.speaker_group_outlined,
        color: remoteActive ? Theme.of(context).colorScheme.primary : null,
      ),
      tooltip: 'Connect to a device',
      onPressed: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: AppColors.background,
        showDragHandle: true,
        builder: (_) => const DevicePickerSheet(),
      ),
    );
  }
}

class DevicePickerSheet extends ConsumerWidget {
  const DevicePickerSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(connectProvider);
    final list = sortDevices(s.devices, s.deviceId);
    final others = list.where((d) => d.id != s.deviceId);

    return SafeArea(
      // Scrolls rather than overflows: many devices plus the volume slider can outgrow a short screen.
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Text(
                'CONNECT TO A DEVICE',
                style: TextStyle(
                    color: _muted,
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.2),
              ),
            ),
            if (s.status != ConnectStatus.online)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                child: Text(
                  s.status == ConnectStatus.connecting
                      ? 'Connecting…'
                      : 'Not connected — trying again',
                  style: TextStyle(color: AppColors.warning, fontSize: 12),
                ),
              ),
            for (final d in list) _DeviceTile(device: d, state: s),
            const _OutputSection(),
            // Another device is playing: its volume is controlled from here (this phone's own is its volume keys).
            if (s.remoteActive && (s.activeDevice?.online ?? false))
              _RemoteVolume(state: s),
            if (s.status == ConnectStatus.online && others.isEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                child: Text(
                  'Open RiffPlayer on another device to see it here.',
                  style: TextStyle(color: _muted, fontSize: 12),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Volume slider for the device that is playing (while it isn't this one).
class _RemoteVolume extends ConsumerWidget {
  final ConnectState state;
  const _RemoteVolume({required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final volume = state.remote?.volume ?? 1.0;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Row(
        children: [
          Icon(volume == 0 ? Icons.volume_off : Icons.volume_up,
              color: _muted, size: 20),
          Expanded(
            child: Slider(
              key: const Key('remote-volume'),
              value: volume.clamp(0.0, 1.0),
              onChanged: (v) => ref.read(connectProvider.notifier).setVolume(v),
            ),
          ),
        ],
      ),
    );
  }
}

class _DeviceTile extends ConsumerWidget {
  final DeviceInfo device;
  final ConnectState state;

  const _DeviceTile({required this.device, required this.state});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isThis = device.id == state.deviceId;
    final playing = device.active && device.online;
    final disabled = !device.online && !isThis;
    final accent = Theme.of(context).colorScheme.primary;

    return ListTile(
      enabled: !disabled,
      leading: Icon(
        switch (device.type) {
          DeviceType.android => Icons.smartphone,
          DeviceType.desktop => Icons.computer,
          DeviceType.web => Icons.language,
        },
        color: playing ? accent : _muted,
      ),
      title: Text(
        device.name,
        style: TextStyle(
            color: playing ? accent : AppColors.text,
            fontWeight: playing ? FontWeight.w600 : null),
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(deviceSubtitle(device, state.deviceId),
          style: TextStyle(color: _muted, fontSize: 12)),
      trailing: isThis && !device.active && state.remoteActive
          ? Text('Play here',
              style: TextStyle(color: AppColors.textSecondary, fontSize: 12))
          : null,
      onTap: disabled
          ? null
          : () {
              Navigator.of(context).pop();
              if (playing) return; // already the one playing
              ref.read(connectProvider.notifier).transferTo(device.id);
            },
    );
  }
}

/// What to say under the track while another device plays — null when this device is the player.
/// Kept separate from the widget so it is easy to test.
({String text, bool unreachable})? remoteLabel(ConnectState s) {
  final d = s.activeDevice;
  if (!s.remoteActive || d == null) return null;
  if (d.unreachable) {
    return (text: '${d.name} is unreachable', unreachable: true);
  }
  return (
    text: d.online ? 'Playing on ${d.name}' : '${d.name} · reconnecting…',
    unreachable: false
  );
}

/// "Playing on <device>" — or "<device> is unreachable · Continue here" once that device is gone.
class RemoteLabel extends ConsumerWidget {
  final TextAlign align;
  const RemoteLabel({super.key, this.align = TextAlign.start});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final label = remoteLabel(ref.watch(connectProvider));
    if (label == null) return const SizedBox.shrink();
    final color = label.unreachable
        ? AppColors.warning
        : Theme.of(context).colorScheme.primary;
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Wrap(
        alignment: align == TextAlign.center
            ? WrapAlignment.center
            : WrapAlignment.start,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(label.text, style: TextStyle(color: color, fontSize: 12)),
          if (label.unreachable) ...[
            Text(' · ',
                style: TextStyle(color: AppColors.warning, fontSize: 12)),
            GestureDetector(
              onTap: () => ref.read(connectProvider.notifier).transferHere(),
              child: Text(
                'Continue here',
                style: TextStyle(
                    color: AppColors.warning,
                    fontSize: 12,
                    decoration: TextDecoration.underline),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Settings → "This device": the name other devices show in the device picker.
class DeviceNameSection extends ConsumerStatefulWidget {
  const DeviceNameSection({super.key});

  @override
  ConsumerState<DeviceNameSection> createState() => _DeviceNameSectionState();
}

class _DeviceNameSectionState extends ConsumerState<DeviceNameSection> {
  late final TextEditingController _controller;
  bool _saved = false;

  @override
  void initState() {
    super.initState();
    _controller =
        TextEditingController(text: ref.read(connectProvider).deviceName);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(connectProvider.select((s) => s.status));
    final current = ref.watch(connectProvider.select((s) => s.deviceName));
    // The stored name may arrive after this section was first built.
    if (_controller.text.isEmpty && current.isNotEmpty && !_saved) {
      _controller.text = current;
    }
    if (status == ConnectStatus.unavailable) return const SizedBox.shrink();

    final typed = _controller.text.trim();
    final changed = typed.isNotEmpty && typed != current;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'THIS DEVICE',
          style: TextStyle(
              color: _muted,
              fontSize: 11,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.2),
        ),
        const SizedBox(height: 8),
        Text(
          'The name your other devices show in the device picker, so you can send music here or control it from them.',
          style: TextStyle(color: _muted, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _controller,
                maxLength: 40,
                decoration: const InputDecoration(
                    labelText: 'Device name', counterText: ''),
                onChanged: (_) => setState(() => _saved = false),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(
              onPressed: changed
                  ? () async {
                      await ref
                          .read(connectProvider.notifier)
                          .renameThisDevice(_controller.text);
                      if (mounted) setState(() => _saved = true);
                    }
                  : null,
              child: const Text('Save'),
            ),
          ],
        ),
        if (_saved)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Saved', style: TextStyle(color: _muted, fontSize: 12)),
          ),
      ],
    );
  }
}

/// "Audio output": where this phone's sound goes. Android lets only the system connect or switch
/// Bluetooth outputs, so this shows the current one and opens the system switcher.
class _OutputSection extends ConsumerWidget {
  const _OutputSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final output = ref.watch(audioOutputProvider);
    final service = ref.read(audioOutputServiceProvider);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('AUDIO OUTPUT',
              style: TextStyle(
                  color: _muted,
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2)),
          const SizedBox(height: 6),
          Row(
            children: [
              Icon(
                  output.label == null
                      ? Icons.volume_up
                      : Icons.bluetooth_audio,
                  size: 20,
                  color: AppColors.text),
              const SizedBox(width: 10),
              Expanded(
                child: Text(output.label ?? 'Phone speaker',
                    style: TextStyle(color: AppColors.text),
                    overflow: TextOverflow.ellipsis),
              ),
              TextButton(
                onPressed: () async {
                  final opened = await service.openSwitcher();
                  if (!opened && context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                        content: Text(
                            'Open your phone\'s Bluetooth or sound settings to switch.')));
                  }
                },
                child: const Text('Change'),
              ),
            ],
          ),
          if (output.needsPermission)
            TextButton(
              onPressed: () async {
                await service.requestBluetoothPermission();
                await ref.read(audioOutputProvider.notifier).refresh();
              },
              child: const Text('Show the speaker\'s name'),
            ),
        ],
      ),
    );
  }
}
