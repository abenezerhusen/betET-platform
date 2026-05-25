package com.ptoproxy.telebirr_pay_client

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.util.Log
import id.flutter.flutter_background_service.BackgroundService

/**
 * BootReceiver — wakes up the foreground service after device boot.
 *
 * Behaviour:
 *   1. Triggered by BOOT_COMPLETED, QUICKBOOT_POWERON, or
 *      MY_PACKAGE_REPLACED.
 *   2. Reads `flutter.cfg.autostart` from Flutter's SharedPreferences
 *      bridge (stored by AppConfig.setAutostart). If false → no-op.
 *   3. Starts the flutter_background_service ForegroundService via
 *      its Intent. The service's Dart entry point (_onForegroundStart
 *      in background_service.dart) will then re-bind everything.
 *
 * Why we don't `runFlutterEngine` ourselves: the background service
 * package already does that internally; double-starting would create
 * orphan engines and burn battery.
 *
 * Why MY_PACKAGE_REPLACED is included: when the APK is updated the
 * OS sends MY_PACKAGE_REPLACED, NOT BOOT_COMPLETED, so the service
 * needs to re-launch on every upgrade.
 */
class BootReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "BootReceiver"
        private const val FLUTTER_PREFS_FILE = "FlutterSharedPreferences"
        private const val AUTOSTART_KEY = "flutter.cfg.autostart"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        Log.i(TAG, "received: $action")

        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }

        val prefs: SharedPreferences =
            context.getSharedPreferences(FLUTTER_PREFS_FILE, Context.MODE_PRIVATE)
        val autostart = prefs.getBoolean(AUTOSTART_KEY, false)
        if (!autostart) {
            Log.i(TAG, "autostart=false; not starting service")
            return
        }

        try {
            val serviceIntent = Intent(context, BackgroundService::class.java)
            // ContextCompat.startForegroundService is what the plugin
            // expects on Android 8+. Using the unqualified version
            // here avoids needing androidx.core; the plugin's
            // BackgroundService overrides onStartCommand to call
            // startForeground() within the 5-second window.
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            Log.i(TAG, "BackgroundService start requested")

            // Schedule the watchdog so the service doesn't die silently.
            ServiceAlarmReceiver.schedule(context)
        } catch (e: Throwable) {
            Log.e(TAG, "failed to start BackgroundService on boot", e)
        }
    }
}
