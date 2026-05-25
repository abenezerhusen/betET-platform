import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Wraps flutter_secure_storage with a small typed API for the values
/// we actually store on this app:
///   - the agent JWT (`token`)
///   - a JSON blob of "session metadata" (agent name, tenant name,
///     agent id, telebirr number, expires_at) so the UI can render
///     the dashboard before we hit /status the first time.
///
/// Anything else (queue, settings, transaction log) goes through
/// SharedPreferences instead — secure storage is slow on Android
/// (~10ms/read) and has no advantage for non-secret data.
class SecureStore {
  SecureStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  static const _kToken = 'auth.token';
  static const _kSession = 'auth.session';

  Future<String?> readToken() => _storage.read(key: _kToken);
  Future<void> writeToken(String token) =>
      _storage.write(key: _kToken, value: token);
  Future<void> deleteToken() => _storage.delete(key: _kToken);

  Future<Map<String, dynamic>?> readSession() async {
    final raw = await _storage.read(key: _kSession);
    if (raw == null) return null;
    try {
      return Map<String, dynamic>.from(jsonDecode(raw) as Map);
    } catch (_) {
      // Corrupt blob — treat as absent and let the UI prompt re-login.
      return null;
    }
  }

  Future<void> writeSession(Map<String, dynamic> session) =>
      _storage.write(key: _kSession, value: jsonEncode(session));

  Future<void> deleteSession() => _storage.delete(key: _kSession);

  Future<void> clear() async {
    await deleteToken();
    await deleteSession();
  }
}

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());
