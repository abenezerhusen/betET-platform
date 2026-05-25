package com.ptoproxy.telebirr_pay_client

import android.app.AlarmManager
import android.app.PendingIntent
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import id.flutter.flutter_background_service.BackgroundService

/**
 * Watchdog. AlarmManager wakes us up every ~15 minutes (the OS may
 * batch us with other alarms in Doze mode; that's fine — at the next
 * unbatch we still get fired). On each tick we check whether
 * BackgroundService is alive; if not, we restart it.
 *
 * AlarmManager is preferred over JobScheduler here because:
 *   - we care about latency on restart-after-kill (operators need
 *     payments matched in seconds)
 *   - we don't need network-conditional execution
 *   - the foreground service itself drives the heavy lifting; the
 *     alarm is just a heartbeat
 *
 * We schedule with `setRepeating` for compatibility down to API 21.
 * On API 23+ the OS will defer alarms in Doze unless we use
 * `setAndAllowWhileIdle`; for our 15m cadence the deferral is fine.
 */
class ServiceAlarmReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ServiceAlarmReceiver"
        private const val INTERVAL_MS = 15L * 60L * 1000L // 15 min
        private const val REQ_CODE = 0x8978

        private fun pendingIntent(context: Context): PendingIntent {
            val intent = Intent(context, ServiceAlarmReceiver::class.java)
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
            return PendingIntent.getBroadcast(context, REQ_CODE, intent, flags)
        }

        fun schedule(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                ?: return
            val pi = pendingIntent(context)
            val triggerAt = SystemClock.elapsedRealtime() + INTERVAL_MS

            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        triggerAt,
                        pi
                    )
                } else {
                    am.setRepeating(
                        AlarmManager.ELAPSED_REALTIME_WAKEUP,
                        triggerAt,
                        INTERVAL_MS,
                        pi
                    )
                }
                Log.i(TAG, "watchdog alarm scheduled in ${INTERVAL_MS / 1000}s")
            } catch (e: SecurityException) {
                // Android 12+ may require SCHEDULE_EXACT_ALARM at
                // runtime; we degrade gracefully because the
                // foreground service itself is enough most of the time.
                Log.w(TAG, "alarm schedule denied; degrading to foreground-only", e)
            }
        }

        fun cancel(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager
                ?: return
            val pi = pendingIntent(context)
            am.cancel(pi)
            pi.cancel()
            Log.i(TAG, "watchdog alarm cancelled")
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        Log.i(TAG, "watchdog tick")

        if (!isBackgroundServiceRunning(context)) {
            Log.w(TAG, "BackgroundService not running; restarting")
            try {
                val svc = Intent(context, BackgroundService::class.java)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(svc)
                } else {
                    context.startService(svc)
                }
            } catch (e: Throwable) {
                Log.e(TAG, "watchdog restart failed", e)
            }
        }

        // Re-arm: setAndAllowWhileIdle is one-shot.
        schedule(context)
    }

    @Suppress("DEPRECATION")
    private fun isBackgroundServiceRunning(context: Context): Boolean {
        // ActivityManager.getRunningServices is deprecated on API 26+
        // for third-party services but STILL returns our own services
        // — which is all we care about. Wrapped in a try in case a
        // future API blocks it entirely.
        return try {
            val am = context.getSystemService(Context.ACTIVITY_SERVICE)
                    as? ActivityManager ?: return false
            am.getRunningServices(Int.MAX_VALUE).any {
                it.service.className == BackgroundService::class.java.name
            }
        } catch (e: Throwable) {
            Log.w(TAG, "failed to enumerate services", e)
            false
        }
    }
}
