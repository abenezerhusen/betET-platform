import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'env.dart';

/// Operator-mutable runtime configuration. Persisted in SharedPreferences
/// so the user can change the backend URL once on first run and never
/// again. Anything here MUST tolerate being missing (caller falls back
/// to [Env] defaults).
class AppConfig {
  AppConfig({required this.backendUrl, required this.autostart});

  final String backendUrl;

  /// When true the boot receiver will start PayService on device boot.
  /// We default to false so a fresh install never silently starts a
  /// background service before the operator logs in.
  final bool autostart;

  AppConfig copyWith({String? backendUrl, bool? autostart}) {
    return AppConfig(
      backendUrl: backendUrl ?? this.backendUrl,
      autostart: autostart ?? this.autostart,
    );
  }

  static const _kBackendUrl = 'cfg.backend_url';
  static const _kAutostart = 'cfg.autostart';

  static Future<AppConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    return AppConfig(
      backendUrl: prefs.getString(_kBackendUrl) ?? Env.defaultBackendUrl,
      autostart: prefs.getBool(_kAutostart) ?? false,
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kBackendUrl, backendUrl);
    await prefs.setBool(_kAutostart, autostart);
  }
}

/// Notifier that holds the current AppConfig and exposes mutators.
/// Loads on first read; UI binds against this so a backend-URL change
/// propagates without restarting the app.
class AppConfigNotifier extends AsyncNotifier<AppConfig> {
  @override
  Future<AppConfig> build() => AppConfig.load();

  Future<void> setBackendUrl(String url) async {
    final next = (state.value ?? await AppConfig.load()).copyWith(
      backendUrl: _normalise(url),
    );
    await next.save();
    state = AsyncData(next);
  }

  Future<void> setAutostart(bool enabled) async {
    final next = (state.value ?? await AppConfig.load()).copyWith(
      autostart: enabled,
    );
    await next.save();
    state = AsyncData(next);
  }

  /// Strips trailing slashes so the Dio baseUrl never produces "//api"
  /// when the user typed "http://host/" in Settings.
  static String _normalise(String url) {
    var u = url.trim();
    while (u.endsWith('/')) {
      u = u.substring(0, u.length - 1);
    }
    return u;
  }
}

final appConfigProvider =
    AsyncNotifierProvider<AppConfigNotifier, AppConfig>(AppConfigNotifier.new);
