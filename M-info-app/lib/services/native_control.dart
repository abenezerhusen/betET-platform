import 'package:flutter/services.dart';

/// Native hooks for Android-only watchdog scheduling.
///
/// The foreground service can run without this, but the watchdog alarm improves
/// resilience if the OS kills the process.
class NativeControl {
  static const MethodChannel _channel = MethodChannel('telebirr_pay/native');

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
}
