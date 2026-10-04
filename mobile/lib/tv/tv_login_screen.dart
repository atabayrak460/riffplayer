import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../app_colors.dart';
import '../providers/providers.dart';
import '../services/device_pairing.dart';
import 'tv_widgets.dart';

final devicePairingServiceProvider =
    Provider<DevicePairingService>((ref) => DevicePairingService());

/// Signing in on a TV without typing a password: enter the server address once, then the TV shows a
/// code to type in the web app or the phone app (Settings → Link a TV).
class TvLoginScreen extends ConsumerStatefulWidget {
  const TvLoginScreen({super.key});

  @override
  ConsumerState<TvLoginScreen> createState() => _TvLoginScreenState();
}

class _TvLoginScreenState extends ConsumerState<TvLoginScreen> {
  final _url = TextEditingController();
  PairingStart? _pairing;
  String? _serverUrl;
  String? _error;
  bool _busy = false;
  Timer? _poller;

  @override
  void dispose() {
    _poller?.cancel();
    _url.dispose();
    super.dispose();
  }

  Future<void> _requestCode() async {
    final service = ref.read(devicePairingServiceProvider);
    final url = DevicePairingService.normaliseServerUrl(_url.text);
    if (url.isEmpty) {
      setState(() => _error = 'Enter your server address first.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final p = await service.start(url, deviceName: 'Android TV');
      if (!mounted) return;
      setState(() {
        _pairing = p;
        _serverUrl = url;
      });
      _startPolling(p);
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startPolling(PairingStart p) {
    _poller?.cancel();
    final deadline = DateTime.now().add(Duration(seconds: p.expiresIn));
    _poller = Timer.periodic(Duration(seconds: p.interval), (t) async {
      if (DateTime.now().isAfter(deadline)) {
        t.cancel();
        if (mounted) {
          setState(() {
            _pairing = null;
            _error = 'The code expired. Get a new one.';
          });
        }
        return;
      }
      try {
        final r = await ref
            .read(devicePairingServiceProvider)
            .poll(_serverUrl!, p.deviceCode);
        switch (r) {
          case PairingPending():
            break;
          case PairingExpired():
            t.cancel();
            if (mounted) {
              setState(() {
                _pairing = null;
                _error = 'The code expired. Get a new one.';
              });
            }
          case PairingApproved(:final credentials):
            t.cancel();
            // The router's redirect takes it from here once the credentials are saved.
            await ref.read(authProvider.notifier).loginLinked(credentials);
        }
      } catch (_) {
        // a network hiccup: try again on the next tick
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final pairing = _pairing;
    return Scaffold(
      body: Center(
        child: SizedBox(
          width: 720,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('RiffPlayer',
                  style: TextStyle(
                      color: AppColors.brand,
                      fontSize: 56,
                      fontWeight: FontWeight.bold)),
              const SizedBox(height: 32),
              if (pairing == null) ...[
                Text('Server address',
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 22)),
                const SizedBox(height: 12),
                TextField(
                  controller: _url,
                  autofocus: true,
                  keyboardType: TextInputType.url,
                  style: const TextStyle(fontSize: 24),
                  decoration: const InputDecoration(
                      hintText: 'http://192.168.1.20:4533'),
                  onSubmitted: (_) => _requestCode(),
                ),
                const SizedBox(height: 20),
                TvFocusable(
                  onActivate: _busy ? () {} : _requestCode,
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 32, vertical: 16),
                    decoration: BoxDecoration(
                      color: AppColors.brand,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(_busy ? 'Contacting the server…' : 'Get a code',
                        style: TextStyle(
                            color: AppColors.onBrand,
                            fontSize: 24,
                            fontWeight: FontWeight.w600)),
                  ),
                ),
              ] else ...[
                Text(
                    'On your phone or in the web app, open Settings → Link a TV and type:',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                        color: AppColors.textSecondary, fontSize: 24)),
                const SizedBox(height: 24),
                Text(pairing.userCode,
                    style: TextStyle(
                        color: AppColors.text,
                        fontSize: 88,
                        letterSpacing: 8,
                        fontWeight: FontWeight.bold,
                        fontFamily: 'monospace')),
                const SizedBox(height: 24),
                Text('Waiting for you to approve it…',
                    style: TextStyle(color: AppColors.muted, fontSize: 20)),
              ],
              if (_error != null) ...[
                const SizedBox(height: 20),
                Text(_error!,
                    style: TextStyle(color: AppColors.danger, fontSize: 20)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
