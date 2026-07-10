import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:flutter_background_service/flutter_background_service.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/env.dart';
import '../core/utils/app_logger.dart';

/// Wraps `flutter_background_service` so the rest of the app can
/// start/stop the foreground service and update the persistent
/// notification through one façade.
///
/// Why a foreground service:
///   - On Android 12+ the OS aggressively kills passive listeners
///     after a few minutes; a foreground service with a persistent
///     notification stays alive for the full operating session.
///   - The notification is also user-visible feedback that the app
///     is "doing its job" — agents notice when it disappears.
///
/// Why we don't write a custom PayService.kt:
///   - flutter_background_service ships with its own Kotlin
///     ForegroundService that already handles startForeground(),
///     wake-locks, and channel registration. Wrapping it in custom
///     Kotlin would duplicate work and risk drifting from upstream.
class BackgroundServiceController {
  BackgroundServiceController();

  static const _notifChannelId = Env.foregroundChannelId;
  static const _notifChannelName = Env.foregroundChannelName;
  static const _notifId = 8978;

  final _service = FlutterBackgroundService();

  bool _initialised = false;

  Future<void> ensureInitialised() async {
    if (_initialised) return;
    if (!Platform.isAndroid) {
      _initialised = true;
      return;
    }
    final localNotifs = FlutterLocalNotificationsPlugin();
    await localNotifs
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(
          const AndroidNotificationChannel(
            _notifChannelId,
            _notifChannelName,
            description: 'BirrPay Service status',
            importance: Importance.low,
            showBadge: false,
          ),
        );

    await _service.configure(
      androidConfiguration: AndroidConfiguration(
        onStart: _onForegroundStart,
        autoStart: false,
        isForegroundMode: true,
        notificationChannelId: _notifChannelId,
        initialNotificationTitle: 'BirrPay',
        initialNotificationContent: 'Initialising…',
        foregroundServiceNotificationId: _notifId,
      ),
      iosConfiguration: IosConfiguration(
        autoStart: false,
        onForeground: _onIosNoop,
        onBackground: _onIosBgNoop,
      ),
    );
    _initialised = true;
  }

  Future<bool> isRunning() => _service.isRunning();

  Future<void> start() async {
    if (!Platform.isAndroid) return;
    await ensureInitialised();
    if (await _service.isRunning()) return;
    await _service.startService();
  }

  Future<void> stop() async {
    if (!Platform.isAndroid) return;
    if (!await _service.isRunning()) return;
    _service.invoke('stopService');
  }

  /// Update the persistent notification text. The foreground-service
  /// background isolate listens for these `update` events and sets
  /// the notification through `flutter_local_notifications`.
  void updateNotification({
    required String title,
    required String body,
  }) {
    _service.invoke('update_notification', <String, dynamic>{
      'title': title,
      'body': body,
    });
  }
}

/// Top-level entry point invoked inside the foreground-service
/// background isolate. CANNOT use Riverpod state — that lives in the
/// main isolate. We listen for `update_notification` events from the
/// main isolate and forward them to flutter_local_notifications.
@pragma('vm:entry-point')
void _onForegroundStart(ServiceInstance service) async {
  DartPluginRegistrant.ensureInitialized();

  final notifs = FlutterLocalNotificationsPlugin();

  service.on('stopService').listen((_) {
    service.stopSelf();
  });

  service.on('update_notification').listen((event) async {
    final title = event?['title'] as String? ?? 'BirrPay';
    final body = event?['body'] as String? ?? '';
    if (service is AndroidServiceInstance) {
      service.setForegroundNotificationInfo(title: title, content: body);
    }
    try {
      await notifs.show(
        BackgroundServiceController._notifId,
        title,
        body,
        const NotificationDetails(
          android: AndroidNotificationDetails(
            BackgroundServiceController._notifChannelId,
            BackgroundServiceController._notifChannelName,
            // Must set an explicit small icon here: this background isolate
            // never runs initialize() with a default icon, so a null icon
            // makes the plugin's setSmallIcon() throw a NullPointerException.
            // `ic_bg_service_small` is bundled by flutter_background_service,
            // so it always resolves.
            icon: 'ic_bg_service_small',
            ongoing: true,
            importance: Importance.low,
            priority: Priority.low,
            playSound: false,
            onlyAlertOnce: true,
          ),
        ),
      );
    } catch (err) {
      // Background isolate has no AppLogger; print as a fallback.
      // ignore: avoid_print
      print('notification update failed: $err');
    }
  });

  AppLogger.instance.i('Foreground service started');
}

@pragma('vm:entry-point')
Future<bool> _onIosNoop(ServiceInstance _) async => true;

@pragma('vm:entry-point')
Future<bool> _onIosBgNoop(ServiceInstance _) async => true;

final backgroundServiceProvider =
    Provider<BackgroundServiceController>((_) => BackgroundServiceController());
