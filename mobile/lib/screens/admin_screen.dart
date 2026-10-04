import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/types.dart';
import '../providers/providers.dart';
import '../app_colors.dart';

class AdminScreen extends StatelessWidget {
  const AdminScreen({super.key});

  @override
  Widget build(BuildContext context) => DefaultTabController(
        length: 3,
        child: Scaffold(
          appBar: AppBar(
            title: const Text('Admin'),
            bottom: const TabBar(
              tabs: [
                Tab(text: 'Users'),
                Tab(text: 'Libraries'),
                Tab(text: 'Settings'),
              ],
            ),
          ),
          body: const TabBarView(
            children: [
              _UsersTab(),
              _LibrariesTab(),
              _ServerSettingsTab(),
            ],
          ),
        ),
      );
}

// ── Users ────────────────────────────────────────────────────────────────────

class _UsersTab extends ConsumerStatefulWidget {
  const _UsersTab();
  @override
  ConsumerState<_UsersTab> createState() => _UsersTabState();
}

class _UsersTabState extends ConsumerState<_UsersTab> {
  bool _creating = false;
  final _userCtrl = TextEditingController();
  final _passCtrl = TextEditingController();
  String _role = 'user';
  String? _error;

  @override
  void dispose() {
    _userCtrl.dispose();
    _passCtrl.dispose();
    super.dispose();
  }

  Future<void> _create() async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    if (_userCtrl.text.trim().isEmpty || _passCtrl.text.isEmpty) return;
    setState(() => _error = null);
    try {
      await client.adminCreateUser(
          _userCtrl.text.trim(), _passCtrl.text, _role);
      ref.invalidate(adminUsersProvider);
      setState(() {
        _creating = false;
        _userCtrl.clear();
        _passCtrl.clear();
        _role = 'user';
      });
    } catch (e) {
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  @override
  Widget build(BuildContext context) {
    final meAsync = ref.watch(meProvider);
    final usersAsync = ref.watch(adminUsersProvider);
    final myId = meAsync.valueOrNull?.id;

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(adminUsersProvider),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Users',
                  style: TextStyle(
                      color: AppColors.text,
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              TextButton.icon(
                onPressed: () => setState(() => _creating = !_creating),
                icon: const Icon(Icons.add),
                label: const Text('Add user'),
              ),
            ],
          ),
          if (_creating) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _userCtrl,
                    decoration: const InputDecoration(hintText: 'Username'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _passCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(hintText: 'Password'),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    initialValue: _role,
                    dropdownColor: AppColors.surface,
                    items: const [
                      DropdownMenuItem(value: 'user', child: Text('User')),
                      DropdownMenuItem(value: 'admin', child: Text('Admin')),
                    ],
                    onChanged: (v) => setState(() => _role = v ?? 'user'),
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 8),
                    Text(_error!,
                        style:
                            TextStyle(color: AppColors.danger, fontSize: 12)),
                  ],
                  const SizedBox(height: 10),
                  ElevatedButton(
                      onPressed: _create, child: const Text('Create')),
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
          usersAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Text('Failed to load users.',
                style: TextStyle(color: AppColors.muted)),
            data: (users) => Column(
              children: users
                  .map((u) => _UserRow(user: u, isSelf: u.id == myId))
                  .toList(),
            ),
          ),
        ],
      ),
    );
  }
}

class _UserRow extends ConsumerStatefulWidget {
  final AdminUser user;
  final bool isSelf;
  const _UserRow({required this.user, required this.isSelf});

  @override
  ConsumerState<_UserRow> createState() => _UserRowState();
}

class _UserRowState extends ConsumerState<_UserRow> {
  bool _editingPw = false;
  final _pwCtrl = TextEditingController();

  @override
  void dispose() {
    _pwCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final client = ref.read(apiClientProvider);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.background,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      widget.isSelf
                          ? '${widget.user.username} (you)'
                          : widget.user.username,
                      style: TextStyle(
                          color: AppColors.text, fontWeight: FontWeight.w600),
                    ),
                    Text(widget.user.role,
                        style: TextStyle(color: AppColors.muted, fontSize: 12)),
                  ],
                ),
              ),
              if (!widget.isSelf) ...[
                IconButton(
                  icon: Icon(Icons.key, size: 18, color: AppColors.muted),
                  tooltip: 'Change password',
                  onPressed: () => setState(() => _editingPw = !_editingPw),
                ),
                IconButton(
                  icon:
                      Icon(Icons.swap_horiz, size: 18, color: AppColors.muted),
                  tooltip: 'Toggle role',
                  onPressed: () async {
                    if (client == null) return;
                    final newRole =
                        widget.user.role == 'admin' ? 'user' : 'admin';
                    await client.adminUpdateUser(widget.user.id, role: newRole);
                    ref.invalidate(adminUsersProvider);
                  },
                ),
                IconButton(
                  icon: Icon(Icons.delete_outline,
                      size: 18, color: AppColors.danger),
                  tooltip: 'Delete',
                  onPressed: () async {
                    final confirmed = await showDialog<bool>(
                      context: context,
                      builder: (dialogContext) => AlertDialog(
                        title: const Text('Delete user?'),
                        content: Text('Delete "${widget.user.username}"?'),
                        actions: [
                          TextButton(
                            onPressed: () =>
                                Navigator.pop(dialogContext, false),
                            child: const Text('Cancel'),
                          ),
                          TextButton(
                            onPressed: () => Navigator.pop(dialogContext, true),
                            child: Text('Delete',
                                style: TextStyle(color: AppColors.danger)),
                          ),
                        ],
                      ),
                    );
                    if (confirmed == true && client != null) {
                      await client.adminDeleteUser(widget.user.id);
                      ref.invalidate(adminUsersProvider);
                    }
                  },
                ),
              ],
            ],
          ),
          if (_editingPw) ...[
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _pwCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                        hintText: 'New password', isDense: true),
                  ),
                ),
                const SizedBox(width: 8),
                TextButton(
                  onPressed: () async {
                    if (client == null || _pwCtrl.text.isEmpty) return;
                    await client.adminUpdateUser(widget.user.id,
                        password: _pwCtrl.text);
                    _pwCtrl.clear();
                    setState(() => _editingPw = false);
                  },
                  child: const Text('Save'),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ── Libraries ────────────────────────────────────────────────────────────────

class _LibrariesTab extends ConsumerStatefulWidget {
  const _LibrariesTab();
  @override
  ConsumerState<_LibrariesTab> createState() => _LibrariesTabState();
}

class _LibrariesTabState extends ConsumerState<_LibrariesTab> {
  bool _adding = false;
  final _nameCtrl = TextEditingController();
  final _pathCtrl = TextEditingController();
  int? _scanningId;

  @override
  void dispose() {
    _nameCtrl.dispose();
    _pathCtrl.dispose();
    super.dispose();
  }

  Future<void> _add() async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    if (_nameCtrl.text.trim().isEmpty || _pathCtrl.text.trim().isEmpty) return;
    await client.adminAddLibrary(_nameCtrl.text.trim(), _pathCtrl.text.trim());
    ref.invalidate(adminLibrariesProvider);
    setState(() {
      _adding = false;
      _nameCtrl.clear();
      _pathCtrl.clear();
    });
  }

  Future<void> _scan(int id) async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    setState(() => _scanningId = id);
    try {
      await client.adminScanLibrary(id);
    } finally {
      if (mounted) setState(() => _scanningId = null);
    }
  }

  Future<void> _remove(Library lib) async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove library?'),
        content: Text('Remove "${lib.name}"? Track data stays.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(dialogContext, false),
              child: const Text('Cancel')),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            child: Text('Remove', style: TextStyle(color: AppColors.danger)),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await client.adminDeleteLibrary(lib.id);
      ref.invalidate(adminLibrariesProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final librariesAsync = ref.watch(adminLibrariesProvider);
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(adminLibrariesProvider),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Music Libraries',
                  style: TextStyle(
                      color: AppColors.text,
                      fontSize: 18,
                      fontWeight: FontWeight.bold)),
              TextButton.icon(
                onPressed: () => setState(() => _adding = !_adding),
                icon: const Icon(Icons.add),
                label: const Text('Add library'),
              ),
            ],
          ),
          if (_adding) ...[
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  TextField(
                    controller: _nameCtrl,
                    decoration:
                        const InputDecoration(hintText: 'Name (e.g. Music)'),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _pathCtrl,
                    decoration:
                        const InputDecoration(hintText: 'Path (e.g. /music)'),
                  ),
                  const SizedBox(height: 10),
                  ElevatedButton(onPressed: _add, child: const Text('Add')),
                ],
              ),
            ),
          ],
          const SizedBox(height: 16),
          librariesAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Text('Failed to load libraries.',
                style: TextStyle(color: AppColors.muted)),
            data: (libs) => libs.isEmpty
                ? Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Text(
                        'No libraries yet. Add your music folder path above.',
                        style: TextStyle(color: AppColors.muted)),
                  )
                : Column(
                    children: libs
                        .map((lib) => Container(
                              margin: const EdgeInsets.only(bottom: 8),
                              padding: const EdgeInsets.all(12),
                              decoration: BoxDecoration(
                                color: AppColors.background,
                                borderRadius: BorderRadius.circular(10),
                              ),
                              child: Row(
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(lib.name,
                                            style: TextStyle(
                                                color: AppColors.text,
                                                fontWeight: FontWeight.w600)),
                                        Text(lib.path,
                                            style: TextStyle(
                                                color: AppColors.muted,
                                                fontSize: 12)),
                                      ],
                                    ),
                                  ),
                                  TextButton(
                                    onPressed: _scanningId == lib.id
                                        ? null
                                        : () => _scan(lib.id),
                                    child: Text(_scanningId == lib.id
                                        ? 'Scanning…'
                                        : 'Scan'),
                                  ),
                                  IconButton(
                                    icon: Icon(Icons.delete_outline,
                                        size: 18, color: AppColors.danger),
                                    onPressed: () => _remove(lib),
                                  ),
                                ],
                              ),
                            ))
                        .toList(),
                  ),
          ),
        ],
      ),
    );
  }
}

// ── Server settings ────────────────────────────────────────────────────────

class _ServerSettingsTab extends ConsumerStatefulWidget {
  const _ServerSettingsTab();
  @override
  ConsumerState<_ServerSettingsTab> createState() => _ServerSettingsTabState();
}

class _ServerSettingsTabState extends ConsumerState<_ServerSettingsTab> {
  late final TextEditingController _lfmKeyCtrl;
  late final TextEditingController _lfmSecretCtrl;
  late final TextEditingController _ollamaUrlCtrl;
  late final TextEditingController _ollamaModelCtrl;
  bool _lfmEnabled = false;
  bool _recoEnabled = true;
  bool _donationEnabled = true;
  bool _init = false;

  @override
  void initState() {
    super.initState();
    _lfmKeyCtrl = TextEditingController();
    _lfmSecretCtrl = TextEditingController();
    _ollamaUrlCtrl = TextEditingController();
    _ollamaModelCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _lfmKeyCtrl.dispose();
    _lfmSecretCtrl.dispose();
    _ollamaUrlCtrl.dispose();
    _ollamaModelCtrl.dispose();
    super.dispose();
  }

  void _initFrom(Map<String, String> settings) {
    if (_init) return;
    _lfmKeyCtrl.text = settings['lastfm_api_key'] ?? '';
    _lfmSecretCtrl.text = settings['lastfm_api_secret'] ?? '';
    _lfmEnabled = settings['lastfm_enabled'] == 'true';
    _recoEnabled = settings['recommendations_enabled'] != 'false';
    _ollamaUrlCtrl.text = settings['ollama_url'] ?? '';
    _ollamaModelCtrl.text = settings['ollama_model'] ?? 'llama3.2';
    _donationEnabled = settings['donation_prompt_enabled'] != 'false';
    _init = true;
  }

  Future<void> _save(Map<String, String?> patch) async {
    final client = ref.read(apiClientProvider);
    if (client == null) return;
    await client.adminPatchSettings(patch);
  }

  @override
  Widget build(BuildContext context) {
    final settingsAsync = ref.watch(adminSettingsProvider);

    return settingsAsync.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(
        child: Text('Failed to load settings.',
            style: TextStyle(color: AppColors.muted)),
      ),
      data: (settings) {
        _initFrom(settings);
        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('Server Settings',
                style: TextStyle(
                    color: AppColors.text,
                    fontSize: 18,
                    fontWeight: FontWeight.bold)),
            const SizedBox(height: 20),
            const _SectionLabel('Last.fm Scrobbling'),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('Enable Last.fm',
                  style: TextStyle(color: AppColors.text, fontSize: 14)),
              subtitle: Text('Scrobble plays for users with a session key.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12)),
              value: _lfmEnabled,
              onChanged: (v) {
                setState(() => _lfmEnabled = v);
                _save({'lastfm_enabled': v ? 'true' : 'false'});
              },
            ),
            TextField(
              controller: _lfmKeyCtrl,
              decoration: const InputDecoration(labelText: 'API Key'),
              onEditingComplete: () => _save({
                'lastfm_api_key': _lfmKeyCtrl.text.trim().isEmpty
                    ? null
                    : _lfmKeyCtrl.text.trim()
              }),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _lfmSecretCtrl,
              obscureText: true,
              decoration: const InputDecoration(labelText: 'Shared Secret'),
              onEditingComplete: () => _save({
                'lastfm_api_secret': _lfmSecretCtrl.text.trim().isEmpty
                    ? null
                    : _lfmSecretCtrl.text.trim()
              }),
            ),
            const SizedBox(height: 24),
            const _SectionLabel('Recommendations (opt-in)'),
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('Enable recommendations',
                  style: TextStyle(color: AppColors.text, fontSize: 14)),
              subtitle: Text('Similar artists and Discover weekly.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12)),
              value: _recoEnabled,
              onChanged: (v) {
                setState(() => _recoEnabled = v);
                _save({'recommendations_enabled': v ? 'true' : 'false'});
              },
            ),
            TextField(
              controller: _ollamaUrlCtrl,
              decoration: const InputDecoration(
                  labelText: 'Ollama URL', hintText: 'http://localhost:11434'),
              onEditingComplete: () => _save({
                'ollama_url': _ollamaUrlCtrl.text.trim().isEmpty
                    ? null
                    : _ollamaUrlCtrl.text.trim()
              }),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: _ollamaModelCtrl,
              decoration: const InputDecoration(
                  labelText: 'Ollama model', hintText: 'llama3.2'),
              onEditingComplete: () => _save({
                'ollama_model': _ollamaModelCtrl.text.trim().isEmpty
                    ? null
                    : _ollamaModelCtrl.text.trim()
              }),
            ),
            const SizedBox(height: 8),
            Text(
              'If Ollama is not configured, recommendations use Last.fm similar-artist data. '
              'All suggestions come from your own library — no acquisition links are ever shown.',
              style: TextStyle(color: AppColors.border, fontSize: 11.5),
            ),
            const SizedBox(height: 24),
            const _SectionLabel('Donations'),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: Text('Show donation link',
                  style: TextStyle(color: AppColors.text, fontSize: 14)),
              subtitle: Text('A quiet link, hidden for everyone when off.',
                  style: TextStyle(color: AppColors.muted, fontSize: 12)),
              value: _donationEnabled,
              onChanged: (v) {
                setState(() => _donationEnabled = v);
                _save({'donation_prompt_enabled': v ? 'true' : 'false'});
              },
            ),
            const SizedBox(height: 24),
          ],
        );
      },
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
