package com.ptoproxy.telebirr_pay_client

import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.MethodChannel

/**
 * Standard Flutter host activity. We intentionally don't override
 * `configureFlutterEngine` here — every plugin registers itself, and
 * the only native↔Dart channel we need (notification updates) is
 * handled by `flutter_background_service` inside the foreground
 * service isolate, NOT this activity.
 *
 * If we later need a custom MethodChannel (e.g. to read the SIM
 * balance via TelephonyManager), wire it here.
 */
class MainActivity : FlutterActivity() {
    private val channelName = "telebirr_pay/native"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "scheduleWatchdog" -> {
                        ServiceAlarmReceiver.schedule(this)
                        result.success(true)
                    }
                    "cancelWatchdog" -> {
                        ServiceAlarmReceiver.cancel(this)
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }
}
