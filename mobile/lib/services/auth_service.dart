import 'package:shared_preferences/shared_preferences.dart';
import '../api/types.dart';

class AuthService {
  static const _keyUrl = 'riffplayer_server_url';
  static const _keyUsername = 'riffplayer_username';
  static const _keyPassword = 'riffplayer_password';
  static const _keyToken = 'riffplayer_jwt';
  static const _keyApiKey = 'riffplayer_api_key';

  Future<Credentials?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final url = prefs.getString(_keyUrl);
    final username = prefs.getString(_keyUsername);
    final password = prefs.getString(_keyPassword);
    if (url == null || username == null || password == null) return null;
    return Credentials(
      serverUrl: url,
      username: username,
      password: password,
      token: prefs.getString(_keyToken),
      apiKey: prefs.getString(_keyApiKey),
    );
  }

  Future<void> save(Credentials creds) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_keyUrl, creds.serverUrl);
    await prefs.setString(_keyUsername, creds.username);
    await prefs.setString(_keyPassword, creds.password);
    if (creds.token != null) await prefs.setString(_keyToken, creds.token!);
    if (creds.apiKey != null) await prefs.setString(_keyApiKey, creds.apiKey!);
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_keyUrl);
    await prefs.remove(_keyUsername);
    await prefs.remove(_keyPassword);
    await prefs.remove(_keyToken);
    await prefs.remove(_keyApiKey);
  }
}
