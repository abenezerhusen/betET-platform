/// Build-time defaults for the agent app. Anything that should be
/// overridable at runtime by the operator (from the Settings screen)
/// lives in [AppConfig], not here. This class only holds:
///
///   - default backend URL (overridable from Settings on first run),
///   - timing constants the user has no business changing,
///   - the well-known list of Telebirr SMS sender ids.
///
/// Ship variants per build-flavor by passing
/// `--dart-define=BACKEND_URL=https://...` to `flutter run` / `flutter build`.
class Env {
  const Env._();

  static const String defaultBackendUrl = String.fromEnvironment(
    'BACKEND_URL',
    defaultValue: 'http://10.0.2.2:4000',
  );

  /// Heartbeat cadence for `/api/agent/auth/heartbeat`. Backend rate
  /// limit is 200/min, so 60s gives us a 200x safety margin.
  static const Duration heartbeatInterval = Duration(seconds: 60);

  /// Initial backoff for the offline SMS queue. Doubled on each
  /// failure up to [maxRetryBackoff].
  static const Duration initialRetryBackoff = Duration(seconds: 5);
  static const Duration maxRetryBackoff = Duration(minutes: 5);

  /// SMS sender ids that the device-side filter accepts as Telebirr.
  /// Anything else is dropped before it ever leaves the phone.
  static const Set<String> telebirrSenderAllowlist = {
    'Telebirr',
    'TELEBIRR',
    'telebirr',
    '8978',
  };

  /// Persistent foreground notification channel id. Must match the
  /// id the native PayService.kt uses when calling startForeground().
  static const String foregroundChannelId = 'telebirr_pay_service';
  static const String foregroundChannelName = 'Telebirr Pay Service';

  /// MethodChannel name shared with native Kotlin. Exact string is
  /// duplicated in MainActivity.kt — keep them in sync.
  static const String nativeMethodChannel =
      'com.ptoproxy.telebirr_pay_client/native';

  /// EventChannel name for native → Dart push of incoming SMS.
  static const String nativeSmsEventChannel =
      'com.ptoproxy.telebirr_pay_client/sms_events';
}
