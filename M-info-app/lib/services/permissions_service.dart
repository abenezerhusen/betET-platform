import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:permission_handler/permission_handler.dart';

import '../core/utils/app_logger.dart';

/// Centralised runtime-permission requester.
///
/// We ask for the bare minimum the app needs to function:
///   - SMS: read incoming messages on the agent device
///   - notifications: the foreground-service persistent notification
///   - phone state: device id (only on older Android — on Android 10+
///     we use a randomly-generated install-id instead, but asking
///     once on first launch keeps the install flow simple)
///
/// All requests are no-ops on iOS — the SMS-pay client only ships on
/// Android in production.
class PermissionsService {
  PermissionsService();

  /// Ordered request flow used on first launch / from the Settings
  /// "fix permissions" button. Returns true iff every essential
  /// permission was granted.
  Future<bool> requestEssential() async {
    if (!Platform.isAndroid) return true;

    final outcomes = <Permission, PermissionStatus>{};

    for (final perm in <Permission>[
      Permission.sms,
      Permission.notification,
      Permission.phone,
      Permission.ignoreBatteryOptimizations,
    ]) {
      try {
        final status = await perm.request();
        outcomes[perm] = status;
      } catch (err, st) {
        AppLogger.instance
            .w('permission request crashed: $perm', error: err, stackTrace: st);
      }
    }

    AppLogger.instance.i('permission outcomes: $outcomes');
    final smsOk = outcomes[Permission.sms]?.isGranted ?? false;
    return smsOk;
  }

  Future<bool> isSmsGranted() async {
    if (!Platform.isAndroid) return true;
    return Permission.sms.isGranted;
  }

  Future<bool> isNotificationsGranted() async {
    if (!Platform.isAndroid) return true;
    return Permission.notification.isGranted;
  }
}

final permissionsServiceProvider =
    Provider<PermissionsService>((_) => PermissionsService());
