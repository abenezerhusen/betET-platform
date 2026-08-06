import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'env.dart';

/// Operator-mutable runtime configuration. Persisted in SharedPreferences.
///
/// NOTE: the backend URL is NOT operator-mutable — it is baked into the build
/// ([Env.defaultBackendUrl], the production API) and is never read from or
/// written to storage. Only [autostart] is persisted here.
class AppConfig {
  AppConfig({required this.backendUrl, required this.autostart});

  /// Always the compile-time production API URL. Kept as a field so existing
  /// consumers (api client, sms service) read it unchanged.
  final String backendUrl;

  /// When true the boot receiver will start PayService on device boot.
  /// We default to false so a fresh install never silently starts a
  /// background service before the operator logs in.
  final bool autostart;

  AppConfig copyWith({bool? autostart}) {
    return AppConfig(
      backendUrl: backendUrl,
      autostart: autostart ?? this.autostart,
    );
  }

  static const _kAutostart = 'cfg.autostart';

  static Future<AppConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    return AppConfig(
      // Production backend, fixed at build time — never user-editable.
      backendUrl: Env.defaultBackendUrl,
      autostart: prefs.getBool(_kAutostart) ?? false,
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_kAutostart, autostart);
  }
}

/// Notifier that holds the current AppConfig and exposes mutators.
/// Loads on first read; UI binds against this so a backend-URL change
/// propagates without restarting the app.
class AppConfigNotifier extends AsyncNotifier<AppConfig> {
  @override
  Future<AppConfig> build() => AppConfig.load();

  Future<void> setAutostart(bool enabled) async {
    final next = (state.value ?? await AppConfig.load()).copyWith(
      autostart: enabled,
    );
    await next.save();
    state = AsyncData(next);
  }
}

final appConfigProvider =
    AsyncNotifierProvider<AppConfigNotifier, AppConfig>(AppConfigNotifier.new);
