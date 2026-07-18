import 'dart:async';

import 'package:flutter/services.dart';

/// Native hooks for Android-only watchdog scheduling + USSD automation.
///
/// The foreground service can run without this, but the watchdog alarm improves
/// resilience if the OS kills the process.
class NativeControl {
  static const MethodChannel _channel = MethodChannel('telebirr_pay/native');

  /// Pending interactive USSD sessions keyed by session id, completed when
  /// native calls back `ussdSessionResult`.
  static final Map<String, Completer<String>> _ussdSessions =
      <String, Completer<String>>{};

  static bool _handlerInstalled = false;

  static void _ensureHandler() {
    if (_handlerInstalled) return;
    _handlerInstalled = true;
    _channel.setMethodCallHandler((call) async {
      if (call.method == 'ussdSessionResult') {
        final args = (call.arguments as Map?)?.cast<String, dynamic>() ??
            <String, dynamic>{};
        final id = args['id']?.toString() ?? '';
        final ok = args['ok'] == true;
        final message = args['message']?.toString() ?? '';
        final completer = _ussdSessions.remove(id);
        if (completer != null && !completer.isCompleted) {
          if (ok) {
            completer.complete(message);
          } else {
            completer.completeError(
              PlatformException(code: 'ussd_session_failed', message: message),
            );
          }
        }
      }
      return null;
    });
  }

  static Future<void> scheduleWatchdog() async {
    try {
      await _channel.invokeMethod('scheduleWatchdog');
    } catch (_) {
      // best effort
    }
  }

  static Future<void> cancelWatchdog() async {
    try {
      await _channel.invokeMethod('cancelWatchdog');
    } catch (_) {
      // best effort
    }
  }

  /// Dial a USSD code and return the network's textual response.
  ///
  /// Backed by Android's `TelephonyManager.sendUssdRequest` (API 26+),
  /// which sends ONE code and returns ONE response — suitable only for a
  /// one-shot Telebirr send-money string. Throws a [PlatformException]
  /// if the permission is missing, the code fails, or on unsupported
  /// devices.
  static Future<String> sendUssd(String code, {int simSlot = 0}) async {
    final res = await _channel.invokeMethod<String>(
      'sendUssd',
      <String, dynamic>{'code': code, 'simSlot': simSlot},
    );
    return res ?? '';
  }

  /// Whether the BirrPay USSD-automation AccessibilityService is enabled.
  static Future<bool> isUssdAccessibilityEnabled() async {
    try {
      final res =
          await _channel.invokeMethod<bool>('isUssdAccessibilityEnabled');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Open the system Accessibility settings so the operator can turn the
  /// USSD-automation service on.
  static Future<void> openAccessibilitySettings() async {
    try {
      await _channel.invokeMethod('openAccessibilitySettings');
    } catch (_) {
      // best effort
    }
  }

  /// Whether "Display over other apps" is granted (used to hide the USSD
  /// dialogs behind a full-screen cover during a withdrawal).
  static Future<bool> canDrawOverlays() async {
    try {
      final res = await _channel.invokeMethod<bool>('canDrawOverlays');
      return res ?? false;
    } catch (_) {
      return false;
    }
  }

  /// Open the "Display over other apps" settings screen for this app.
  static Future<void> openOverlaySettings() async {
    try {
      await _channel.invokeMethod('openOverlaySettings');
    } catch (_) {
      // best effort
    }
  }

  /// Run a full interactive Telebirr USSD menu: dial [initial], then let the
  /// accessibility service type each entry of [steps] into the successive
  /// dialogs. Completes with the final dialog text on success, or throws a
  /// [PlatformException] on failure/timeout / when accessibility is disabled.
  static Future<String> runUssdSession({
    required String id,
    required String initial,
    required List<String> steps,
    int simSlot = 0,
  }) async {
    _ensureHandler();
    final completer = Completer<String>();
    _ussdSessions[id] = completer;
    try {
      await _channel.invokeMethod('startUssdSession', <String, dynamic>{
        'id': id,
        'initial': initial,
        'steps': steps,
        'simSlot': simSlot,
      });
    } catch (err) {
      _ussdSessions.remove(id);
      rethrow;
    }
    // Safety net in case the native callback never arrives.
    return completer.future.timeout(
      const Duration(seconds: 120),
      onTimeout: () {
        _ussdSessions.remove(id);
        throw PlatformException(
          code: 'ussd_session_timeout',
          message: 'No result from USSD automation',
        );
      },
    );
  }
}
