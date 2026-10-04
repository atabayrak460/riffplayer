import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../utils/snackbar.dart';
import '../widgets/device_picker.dart';
import '../app_colors.dart';
import 'package:image_picker/image_picker.dart';
import '../audio/replay_gain.dart';
import '../widgets/avatar.dart';
import '../audio/equalizer_model.dart';
import '../providers/equalizer_provider.dart';
import '../providers/playback_settings_provider.dart';
import '../providers/theme_provider.dart';

const _transcodeFormats = [
  (null, 'Original format'),
  ('mp3', 'MP3'),
  ('aac', 'AAC'),
  ('opus', 'Opus'),
  ('ogg', 'OGG Vorbis'),
];

const _bitrates = [
  (null, 'No limit'),
  (64, '64 kbps'),
  (128, '128 kbps'),
  (192, '192 kbps'),
  (256, '256 kbps'),
  (320, '320 kbps'),
];

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final creds = auth.valueOrNull;
    final meAsync = ref.watch(meProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          if (creds != null) ...[
            const _SectionLabel('Account'),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Theme.of(context).colorScheme.primary,
                    child: Text(
                      creds.username.isNotEmpty
                          ? creds.username[0].toUpperCase()
                          : '?',
                      style: TextStyle(color: AppColors.text),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          creds.username,
                          style: TextStyle(
                            color: AppColors.text,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        Text(
                          creds.serverUrl,
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 24),
            const _ProfileSection(),
            const SizedBox(height: 24),
            const _AppearanceSection(),
            const SizedBox(height: 24),
            const _PlaybackSection(),
            const SizedBox(height: 24),
            const LinkTvSection(),
            const SizedBox(height: 24),
            const EqualizerSection(),
            const SizedBox(height: 16),
            const _PasswordSection(),
            const SizedBox(height: 24),
            const DeviceNameSection(),
            const SizedBox(height: 24),
          ],
          meAsync.when(
            loading: () => const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, __) => const SizedBox.shrink(),
            data: (me) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _PreferencesSection(me: me),
                if (me.isAdmin) ...[
                  const SizedBox(height: 24),
                  const _SectionLabel('Admin'),
                  const SizedBox(height: 8),
                  Container(
                    decoration: BoxDecoration(
                      color: AppColors.background,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: ListTile(
                      leading: Icon(Icons.admin_panel_settings,
                          color: AppColors.muted),
                      title: Text('Admin panel',
                          style: TextStyle(color: AppColors.text)),
                      subtitle: Text('Users, libraries, server settings',
                          style:
                              TextStyle(color: AppColors.muted, fontSize: 12)),
                      trailing:
                          Icon(Icons.chevron_right, color: AppColors.muted),
                      onTap: () => context.push('/admin'),
                    ),
                  ),
                ],
                const SizedBox(height: 24),
              ],
            ),
          ),
          OutlinedButton.icon(
            onPressed: () => ref.read(authProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
            label: const Text('Sign out'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.danger,
              side: BorderSide(color: AppColors.danger),
              minimumSize: const Size.fromHeight(48),
            ),
          ),
        ],
      ),
    );
  }
}

class _PasswordSection extends ConsumerStatefulWidget {
  const _PasswordSection();

  @override
  ConsumerState<_PasswordSection> createState() => _PasswordSectionState();
}

class _PasswordSectionState extends ConsumerState<_PasswordSection> {
  final _currentCtrl = TextEditingController();
  final _newCtrl = TextEditingController();
  final _confirmCtrl = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _currentCtrl.dispose();
    _newCtrl.dispose();
    _confirmCtrl.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_currentCtrl.text.isEmpty || _newCtrl.text.isEmpty) {
      setState(() => _error = 'Fill in all fields.');
      return;
    }
    if (_newCtrl.text != _confirmCtrl.text) {
      setState(() => _error = "New passwords don't match.");
      return;
    }
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await client.changeMyPassword(_currentCtrl.text, _newCtrl.text);
      if (!mounted) return;
      showSnackBar(context, 'Password changed — please sign in again.');
      // Changing your own password bumps token_version server-side,
      // invalidating this session's JWT and Subsonic credentials (now the
      // old password) immediately — same reasoning as the "Sign out" button
      // below, which also just clears credentials and lets the router
      // redirect to the login screen on its own.
      await ref.read(authProvider.notifier).logout();
    } on DioException catch (e) {
      final message = (e.response?.data is Map)
          ? (e.response?.data as Map)['error'] as String?
          : null;
      if (mounted) {
        setState(() => _error = message ?? 'Failed to change password.');
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Password'),
        const SizedBox(height: 8),
        TextField(
          controller: _currentCtrl,
          obscureText: true,
          autofillHints: const [AutofillHints.password],
          decoration: const InputDecoration(hintText: 'Current password'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _newCtrl,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          decoration: const InputDecoration(hintText: 'New password'),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _confirmCtrl,
          obscureText: true,
          autofillHints: const [AutofillHints.newPassword],
          decoration: const InputDecoration(hintText: 'Confirm new password'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _saving ? null : _submit,
          child: Text(_saving ? 'Changing…' : 'Change password'),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!,
              style: TextStyle(color: AppColors.danger, fontSize: 12)),
        ],
      ],
    );
  }
}

/// Profile: picture, name, about text, "show what I'm listening to" (off by default) and a way to
/// the other people on this server.
class _ProfileSection extends ConsumerStatefulWidget {
  const _ProfileSection();

  @override
  ConsumerState<_ProfileSection> createState() => _ProfileSectionState();
}

class _ProfileSectionState extends ConsumerState<_ProfileSection> {
  final _name = TextEditingController();
  final _bio = TextEditingController();
  bool _loaded = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _bio.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() job) async {
    try {
      await job();
      setState(() => _error = null);
      ref.invalidate(myProfileProvider);
      ref.invalidate(peopleProvider);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'That didn\'t work. Please try again.');
      }
    }
  }

  Future<void> _pickPicture() async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final picked = await ImagePicker()
        .pickImage(source: ImageSource.gallery, imageQuality: 90);
    if (picked == null) return;
    await _run(() => client.uploadAvatar(picked.path));
  }

  @override
  Widget build(BuildContext context) {
    final client = ref.watch(apiClientProvider);
    final me = ref.watch(authProvider).valueOrNull;
    final profile = ref.watch(myProfileProvider).valueOrNull;
    final socialOn = ref.watch(socialEnabledProvider).valueOrNull ?? false;
    final user = ref.watch(meProvider).valueOrNull;
    if (client == null || me == null || profile == null || user == null) {
      return const SizedBox.shrink();
    }
    if (!_loaded) {
      _loaded = true;
      _name.text = profile.displayName ?? '';
      _bio.text = profile.bio ?? '';
    }
    final shown = profile.displayName ?? me.username;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Profile'),
        const SizedBox(height: 8),
        if (!socialOn)
          Text(
              'An admin has turned social features off on this server, so others can\'t see your profile.',
              style: TextStyle(color: AppColors.muted, fontSize: 12)),
        Row(
          children: [
            Avatar(
                userId: user.id,
                name: shown,
                hasAvatar: profile.hasAvatar,
                version: profile.avatarVersion,
                size: 64),
            const SizedBox(width: 16),
            Expanded(
              child: Wrap(
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: _pickPicture,
                    child: Text(
                        profile.hasAvatar ? 'Change picture' : 'Add a picture'),
                  ),
                  if (profile.hasAvatar)
                    TextButton(
                      onPressed: () => _run(client.deleteAvatar),
                      child: const Text('Remove'),
                    ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _name,
          maxLength: 40,
          decoration:
              InputDecoration(labelText: 'Display name', hintText: me.username),
        ),
        TextField(
          controller: _bio,
          maxLength: 200,
          maxLines: 2,
          decoration: const InputDecoration(labelText: 'About you'),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: FilledButton(
            onPressed: () => _run(() => client.updateMyProfile(
                  displayName:
                      _name.text.trim().isEmpty ? null : _name.text.trim(),
                  bio: _bio.text.trim().isEmpty ? null : _bio.text.trim(),
                  clearDisplayName: _name.text.trim().isEmpty,
                  clearBio: _bio.text.trim().isEmpty,
                )),
            child: const Text('Save profile'),
          ),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Show what I\'m listening to'),
          subtitle: Text(
            'Off by default. When on, other people on this server can see the song you are playing '
            'right now. Only your public playlists are ever visible to others. (The server admin can '
            'already read the play history on their own server — this doesn\'t change that.)',
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          value: profile.showListening,
          onChanged: (v) =>
              _run(() => client.updateMyProfile(showListening: v)),
        ),
        if (_error != null)
          Text(_error!,
              style: TextStyle(color: AppColors.danger, fontSize: 12)),
        if (socialOn)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(Icons.people),
            title: const Text('People on this server'),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push('/people'),
          ),
      ],
    );
  }
}

class _AppearanceSection extends ConsumerWidget {
  const _AppearanceSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    final skin = ref.watch(skinProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Appearance'),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<AppThemeMode>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: AppThemeMode.system, label: Text('System')),
              ButtonSegment(value: AppThemeMode.dark, label: Text('Dark')),
              ButtonSegment(value: AppThemeMode.light, label: Text('Light')),
            ],
            selected: {mode},
            onSelectionChanged: (s) =>
                ref.read(themeModeProvider.notifier).set(s.first),
          ),
        ),
        const SizedBox(height: 16),
        const _SectionLabel('Interface style'),
        const SizedBox(height: 8),
        RadioGroup<AppSkin>(
          groupValue: skin,
          onChanged: (v) {
            if (v != null) ref.read(skinProvider.notifier).set(v);
          },
          child: Column(
            children: [
              for (final entry in skinLabels.entries)
                RadioListTile<AppSkin>(
                  value: entry.key,
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(entry.value.$1),
                  subtitle: Text(entry.value.$2,
                      style: TextStyle(color: AppColors.muted, fontSize: 12)),
                ),
            ],
          ),
        ),
        if (skin != AppSkin.standard)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              "This style has its own colours, so the theme above doesn't apply to it.",
              style: TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          ),
      ],
    );
  }
}

class _PlaybackSection extends ConsumerWidget {
  const _PlaybackSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(playbackSettingsProvider);
    final notifier = ref.read(playbackSettingsProvider.notifier);
    final off = settings.replayGain == ReplayGainMode.off;
    final db = settings.preampDb;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Playback'),
        const SizedBox(height: 8),
        Text('Volume levelling (ReplayGain)',
            style: TextStyle(color: AppColors.text, fontSize: 14)),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: SegmentedButton<ReplayGainMode>(
            showSelectedIcon: false,
            segments: const [
              ButtonSegment(value: ReplayGainMode.off, label: Text('Off')),
              ButtonSegment(value: ReplayGainMode.track, label: Text('Track')),
              ButtonSegment(value: ReplayGainMode.album, label: Text('Album')),
            ],
            selected: {settings.replayGain},
            onSelectionChanged: (s) => notifier.setReplayGain(s.first),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Uses the gain tags in your files. Album keeps an album\'s own dynamics. '
          'The phone can\'t play louder than full volume, so a boost is capped there.',
          style: TextStyle(color: AppColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Text('Pre-amp',
                style: TextStyle(
                    color: off ? AppColors.muted : AppColors.text,
                    fontSize: 14)),
            const Spacer(),
            Text('${db > 0 ? '+' : ''}${db % 1 == 0 ? db.toInt() : db} dB',
                style: TextStyle(color: AppColors.muted, fontSize: 13)),
          ],
        ),
        Slider(
          value: db,
          min: -maxPreampDb,
          max: maxPreampDb,
          divisions: (maxPreampDb * 4).toInt(),
          onChanged: off ? null : notifier.setPreampDb,
        ),
        Text(
          'Gapless playback is always on. Crossfade isn\'t available on the phone yet.',
          style: TextStyle(color: AppColors.muted, fontSize: 12),
        ),
      ],
    );
  }
}

/// "Link a TV": type the code an Android TV shows, so it signs in without a password on the TV.
class LinkTvSection extends ConsumerStatefulWidget {
  const LinkTvSection({super.key});

  @override
  ConsumerState<LinkTvSection> createState() => _LinkTvSectionState();
}

class _LinkTvSectionState extends ConsumerState<LinkTvSection> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _message;
  bool _ok = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _link() async {
    final client = ref.read(apiClientProvider);
    final code = _code.text.trim();
    if (client == null || code.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _message = null;
    });
    try {
      final name = await client.approveDeviceCode(code);
      if (!mounted) return;
      setState(() {
        _ok = true;
        _message = '$name is now linked.';
        _code.clear();
      });
    } on DioException catch (e) {
      final data = e.response?.data;
      final text = data is Map ? data['error'] as String? : null;
      if (mounted) {
        setState(() {
          _ok = false;
          _message = text ?? 'That didn\'t work. Please try again.';
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Link a TV'),
        const SizedBox(height: 8),
        Text(
          'Open RiffPlayer on your Android TV — it shows a code. Type it here to sign the TV in '
          'without typing your password on it.',
          style: TextStyle(color: AppColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                maxLength: 12,
                decoration: const InputDecoration(
                    hintText: 'ABCD-EFGH', counterText: ''),
                onSubmitted: (_) => _link(),
              ),
            ),
            const SizedBox(width: 12),
            FilledButton(
              onPressed: _busy ? null : _link,
              child: const Text('Link'),
            ),
          ],
        ),
        if (_message != null)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(_message!,
                style: TextStyle(
                    color: _ok ? AppColors.success : AppColors.danger,
                    fontSize: 12)),
          ),
      ],
    );
  }
}

/// Equalizer settings. Public so it can be tested on its own.
class EqualizerSection extends ConsumerStatefulWidget {
  const EqualizerSection({super.key});

  @override
  ConsumerState<EqualizerSection> createState() => _EqualizerSectionState();
}

class _EqualizerSectionState extends ConsumerState<EqualizerSection> {
  @override
  void initState() {
    super.initState();
    // The phone's equalizer only exists once audio has been loaded; ask now, and again on demand.
    Future.microtask(() => ref.read(equalizerProvider.notifier).refresh());
  }

  static String _hz(double hz) => hz >= 1000
      ? '${(hz / 1000).toStringAsFixed(hz % 1000 == 0 ? 0 : 1)}k'
      : hz.round().toString();

  @override
  Widget build(BuildContext context) {
    final eq = ref.watch(equalizerProvider);
    final notifier = ref.read(equalizerProvider.notifier);
    final bands = eq.bands;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Equalizer'),
        const SizedBox(height: 8),
        if (defaultTargetPlatform != TargetPlatform.android)
          Text('The equalizer is only available on Android.',
              style: TextStyle(color: AppColors.muted, fontSize: 12))
        else if (bands == null) ...[
          Text(
            'Play a song once and the phone\'s equalizer becomes available — it starts with the first song.',
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
          TextButton(
            onPressed: notifier.refresh,
            child: const Text('Check again'),
          ),
        ] else ...[
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Enable equalizer'),
            value: eq.enabled,
            onChanged: notifier.setEnabled,
          ),
          Row(
            children: [
              DropdownButton<String>(
                value: eq.preset,
                dropdownColor: AppColors.surface,
                items: [
                  if (eq.preset == customPreset)
                    const DropdownMenuItem(
                        value: customPreset, child: Text(customPreset)),
                  for (final name in eqPresets.keys)
                    DropdownMenuItem(value: name, child: Text(name)),
                ],
                onChanged: (v) {
                  if (v != null) notifier.applyPreset(v);
                },
              ),
              const Spacer(),
              TextButton(onPressed: notifier.reset, child: const Text('Reset')),
            ],
          ),
          Opacity(
            opacity: eq.enabled ? 1 : 0.5,
            child: SizedBox(
              height: 190,
              child: Row(
                children: [
                  for (var i = 0; i < bands.centersHz.length; i++)
                    Expanded(
                      child: Column(
                        children: [
                          Text(
                              '${eq.gains[i] > 0 ? '+' : ''}${eq.gains[i] % 1 == 0 ? eq.gains[i].toInt() : eq.gains[i]}',
                              style: TextStyle(
                                  color: AppColors.muted, fontSize: 10)),
                          Expanded(
                            child: RotatedBox(
                              quarterTurns: 3,
                              child: Slider(
                                semanticFormatterCallback: (_) =>
                                    '${_hz(bands.centersHz[i])} Hz',
                                value:
                                    eq.gains[i].clamp(bands.minDb, bands.maxDb),
                                min: bands.minDb,
                                max: bands.maxDb,
                                onChanged: (v) => notifier.setGain(i, v),
                              ),
                            ),
                          ),
                          Text(_hz(bands.centersHz[i]),
                              style: TextStyle(
                                  color: AppColors.muted, fontSize: 10)),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          Text(
            'This phone offers ${bands.centersHz.length} bands, set by its audio hardware.',
            style: TextStyle(color: AppColors.muted, fontSize: 12),
          ),
        ],
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String text;
  const _SectionLabel(this.text);
  @override
  Widget build(BuildContext context) => Text(
        text.toUpperCase(),
        style: TextStyle(
          color: AppColors.muted,
          fontSize: 12,
          fontWeight: FontWeight.w700,
          letterSpacing: 1.2,
        ),
      );
}

class _PreferencesSection extends ConsumerStatefulWidget {
  final MeInfo me;
  const _PreferencesSection({required this.me});

  @override
  ConsumerState<_PreferencesSection> createState() =>
      _PreferencesSectionState();
}

class _PreferencesSectionState extends ConsumerState<_PreferencesSection> {
  String? _format;
  int? _bitrate;
  late final TextEditingController _lbCtrl;
  late final TextEditingController _lfmCtrl;
  bool _saving = false;
  String? _savedMsg;

  @override
  void initState() {
    super.initState();
    final prefs = widget.me.preferences;
    _format = prefs?.transcodeFormat;
    _bitrate = prefs?.transcodeBitrate;
    _lbCtrl = TextEditingController(text: prefs?.listenbrainzToken ?? '');
    _lfmCtrl = TextEditingController(text: prefs?.lastfmSessionKey ?? '');
  }

  @override
  void dispose() {
    _lbCtrl.dispose();
    _lfmCtrl.dispose();
    super.dispose();
  }

  Future<void> _save(Map<String, dynamic> patch) async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    setState(() {
      _saving = true;
      _savedMsg = null;
    });
    try {
      await client.updateMyPreferences(patch);
      if (mounted) setState(() => _savedMsg = 'Saved.');
    } catch (e) {
      if (mounted) setState(() => _savedMsg = 'Save failed.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _SectionLabel('Transcoding'),
        const SizedBox(height: 4),
        Text(
          'Preferred format/bitrate for mobile data saving. Leave as original to stream unmodified.',
          style: TextStyle(color: AppColors.muted, fontSize: 12),
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<String?>(
                initialValue: _format,
                dropdownColor: AppColors.surface,
                decoration: const InputDecoration(isDense: true),
                items: _transcodeFormats
                    .map(
                        (f) => DropdownMenuItem(value: f.$1, child: Text(f.$2)))
                    .toList(),
                onChanged: (v) => setState(() => _format = v),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: DropdownButtonFormField<int?>(
                initialValue: _bitrate,
                dropdownColor: AppColors.surface,
                decoration: const InputDecoration(isDense: true),
                items: _bitrates
                    .map(
                        (b) => DropdownMenuItem(value: b.$1, child: Text(b.$2)))
                    .toList(),
                onChanged: (v) => setState(() => _bitrate = v),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _saving
              ? null
              : () => _save(
                  {'transcode_format': _format, 'transcode_bitrate': _bitrate}),
          child: const Text('Save transcoding'),
        ),
        const SizedBox(height: 24),
        const _SectionLabel('ListenBrainz'),
        const SizedBox(height: 8),
        TextField(
          controller: _lbCtrl,
          decoration:
              const InputDecoration(hintText: 'ListenBrainz user token'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _saving
              ? null
              : () => _save({
                    'listenbrainz_token':
                        _lbCtrl.text.trim().isEmpty ? null : _lbCtrl.text.trim()
                  }),
          child: const Text('Save ListenBrainz'),
        ),
        const SizedBox(height: 24),
        const _SectionLabel('Last.fm'),
        const SizedBox(height: 8),
        TextField(
          controller: _lfmCtrl,
          decoration: const InputDecoration(hintText: 'Last.fm session key'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: _saving
              ? null
              : () => _save({
                    'lastfm_session_key': _lfmCtrl.text.trim().isEmpty
                        ? null
                        : _lfmCtrl.text.trim()
                  }),
          child: const Text('Save Last.fm'),
        ),
        if (_savedMsg != null) ...[
          const SizedBox(height: 8),
          Text(_savedMsg!,
              style: TextStyle(
                  color: _savedMsg == 'Saved.'
                      ? AppColors.success
                      : AppColors.danger,
                  fontSize: 12)),
        ],
      ],
    );
  }
}
