import 'dart:async';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../core/storage/secure_store.dart';
import '../../core/utils/app_logger.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';

/// Resolved auth state for the app.
sealed class AuthState {
  const AuthState();
}

class AuthLoading extends AuthState {
  const AuthLoading();
}

class AuthSignedOut extends AuthState {
  const AuthSignedOut({this.lastError});
  final String? lastError;
}

class AuthSignedIn extends AuthState {
  const AuthSignedIn(this.session);
  final AgentSession session;
}

/// Stable per-install device id. We don't use the hardware
/// IMEI/Android-id (privacy + Android 10+ removes access); a UUID
/// stored in SharedPreferences is sufficient because pairing already
/// requires a password the operator types in.
class DeviceIdentifier {
  static const _kDeviceId = 'device.id';

  static Future<String> getOrCreate() async {
    final prefs = await SharedPreferences.getInstance();
    final existing = prefs.getString(_kDeviceId);
    if (existing != null) return existing;
    final id = const Uuid().v4();
    await prefs.setString(_kDeviceId, id);
    return id;
  }

  static Future<String?> deviceModel() async {
    if (!Platform.isAndroid) return null;
    try {
      final info = await DeviceInfoPlugin().androidInfo;
      return '${info.manufacturer} ${info.model}';
    } catch (_) {
      return null;
    }
  }
}

class AuthNotifier extends StateNotifier<AuthState> {
  AuthNotifier(this._api, this._secureStore) : super(const AuthLoading()) {
    unawaited(_bootstrap());
  }

  final AgentApi? _api;
  final SecureStore _secureStore;

  Future<void> _bootstrap() async {
    try {
      final token = await _secureStore.readToken();
      final session = await _secureStore.readSession();
      final restored = AgentSession.fromStored(
        token: token,
        session: session,
      );
      if (restored == null) {
        state = const AuthSignedOut();
        return;
      }
      state = AuthSignedIn(restored);
    } catch (err, st) {
      AppLogger.instance.w('auth bootstrap failed', error: err, stackTrace: st);
      state = AuthSignedOut(lastError: err.toString());
    }
  }

  Future<bool> login({
    required String telebirrNumber,
    required String password,
  }) async {
    final api = _api;
    if (api == null) {
      state = const AuthSignedOut(
        lastError: 'Backend URL not configured. Open Settings to set it.',
      );
      return false;
    }
    state = const AuthLoading();
    try {
      final deviceId = await DeviceIdentifier.getOrCreate();
      final deviceModel = await DeviceIdentifier.deviceModel();
      final pkg = await PackageInfo.fromPlatform();

      final session = await api.login(
        telebirrNumber: telebirrNumber,
        password: password,
        deviceId: deviceId,
        deviceName: deviceModel,
        appVersion: pkg.version,
      );

      await _secureStore.writeToken(session.token);
      await _secureStore.writeSession(session.toJson());
      state = AuthSignedIn(session);
      return true;
    } catch (err, st) {
      AppLogger.instance.w('login failed', error: err, stackTrace: st);
      final msg =
          err is ApiException ? err.message : 'Login failed: ${err.toString()}';
      state = AuthSignedOut(lastError: msg);
      return false;
    }
  }

  Future<void> logout() async {
    await _secureStore.clear();
    state = const AuthSignedOut();
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  final apiAsync = ref.watch(agentApiProvider);
  final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
  final secureStore = ref.watch(secureStoreProvider);
  return AuthNotifier(api, secureStore);
});

/// Convenience for guards: `true` once we know the user is signed in.
final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(authControllerProvider) is AuthSignedIn;
});
