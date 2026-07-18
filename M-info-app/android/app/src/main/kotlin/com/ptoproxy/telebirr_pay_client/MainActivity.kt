package com.ptoproxy.telebirr_pay_client

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.telecom.TelecomManager
import android.telephony.TelephonyManager
import android.text.TextUtils
import androidx.core.content.ContextCompat
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.embedding.android.FlutterActivity
import io.flutter.plugin.common.MethodChannel

/**
 * Flutter host activity. Exposes the `telebirr_pay/native` MethodChannel:
 *   - scheduleWatchdog / cancelWatchdog     → AlarmManager watchdog
 *   - sendUssd                               → legacy one-shot USSD request
 *   - startUssdSession                       → dial the Telebirr menu and let
 *                                              UssdAccessibilityService walk it
 *   - isUssdAccessibilityEnabled             → is our a11y service on?
 *   - openAccessibilitySettings              → deep-link to enable it
 *
 * Interactive USSD (Telebirr "send money") is a multi-step menu that cannot be
 * completed with TelephonyManager.sendUssdRequest, so we dial the opening code
 * and drive the dialogs via an AccessibilityService.
 */
class MainActivity : FlutterActivity() {
    private val channelName = "telebirr_pay/native"

    companion object {
        /** Set while a Flutter engine is attached so background components
         *  (the accessibility service) can push results back to Dart. */
        @Volatile
        var methodChannel: MethodChannel? = null
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        val channel = MethodChannel(
            flutterEngine.dartExecutor.binaryMessenger,
            channelName,
        )
        methodChannel = channel

        channel.setMethodCallHandler { call, result ->
            when (call.method) {
                "scheduleWatchdog" -> {
                    ServiceAlarmReceiver.schedule(this)
                    result.success(true)
                }
                "cancelWatchdog" -> {
                    ServiceAlarmReceiver.cancel(this)
                    result.success(true)
                }
                "sendUssd" -> {
                    val code = call.argument<String>("code")
                    val simSlot = call.argument<Int>("simSlot") ?: 0
                    if (code.isNullOrBlank()) {
                        result.error("bad_args", "USSD code is required", null)
                    } else {
                        sendUssd(code, simSlot, result)
                    }
                }
                "isUssdAccessibilityEnabled" -> {
                    result.success(isAccessibilityServiceEnabled())
                }
                "openAccessibilitySettings" -> {
                    startActivity(
                        Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    result.success(true)
                }
                "canDrawOverlays" -> {
                    result.success(Settings.canDrawOverlays(this))
                }
                "openOverlaySettings" -> {
                    startActivity(
                        Intent(
                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:$packageName"),
                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    result.success(true)
                }
                "startUssdSession" -> {
                    val id = call.argument<String>("id")
                    val initial = call.argument<String>("initial")
                    val steps = call.argument<List<String>>("steps")
                    val simSlot = call.argument<Int>("simSlot") ?: 0
                    startUssdSession(id, initial, steps, simSlot, result)
                }
                else -> result.notImplemented()
            }
        }
    }

    override fun onDestroy() {
        // Only clear if we own it (avoid clobbering a newer activity's channel).
        super.onDestroy()
    }

    /* --------------------------------------------------------------------- */
    /* Interactive USSD session                                              */
    /* --------------------------------------------------------------------- */

    private fun startUssdSession(
        id: String?,
        initial: String?,
        steps: List<String>?,
        simSlot: Int,
        result: MethodChannel.Result,
    ) {
        if (id.isNullOrBlank() || initial.isNullOrBlank() || steps.isNullOrEmpty()) {
            result.error("bad_args", "id, initial and steps are required", null)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            result.error("permission_denied", "CALL_PHONE permission not granted", null)
            return
        }
        if (!isAccessibilityServiceEnabled() || !UssdAccessibilityService.isRunning()) {
            result.error(
                "accessibility_disabled",
                "Enable BirrPay USSD Automation under Settings > Accessibility",
                null,
            )
            return
        }

        UssdSession.start(id, steps)
        // Cover the screen so the operator never sees the USSD dialogs flash.
        // Best-effort: only if the overlay permission is granted.
        UssdOverlay.show(applicationContext)
        try {
            dialUssd(initial, simSlot)
            // Result is delivered asynchronously via `ussdSessionResult` once
            // the accessibility service finishes walking the menu.
            result.success(true)
        } catch (e: Throwable) {
            UssdSession.finish(false, "dial_failed: ${e.message}")
            result.error("dial_failed", e.message, null)
        }
    }

    /** Dial a USSD code, routing to a specific SIM slot when possible.
     *
     *  Uses TelecomManager.placeCall so the request goes straight to the
     *  telephony ConnectionService — this avoids the "Complete action using"
     *  app-chooser that ACTION_CALL can raise when another app (e.g. the
     *  Telebirr app) also registers the `tel:` scheme. */
    private fun dialUssd(code: String, simSlot: Int) {
        val uri = Uri.fromParts("tel", code, null)
        val tm = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
        if (tm != null &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE)
            == PackageManager.PERMISSION_GRANTED
        ) {
            try {
                val extras = Bundle()
                phoneAccountHandleForSlot(simSlot)?.let { handle ->
                    extras.putParcelable(
                        TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle,
                    )
                }
                tm.placeCall(uri, extras)
                return
            } catch (_: Throwable) {
                // Fall through to the intent path below.
            }
        }
        val intent = Intent(Intent.ACTION_CALL, uri)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        phoneAccountHandleForSlot(simSlot)?.let { handle ->
            intent.putExtra(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle)
        }
        startActivity(intent)
    }

    /** Best-effort SIM-slot → PhoneAccountHandle mapping to avoid the SIM
     *  chooser popup on dual-SIM devices. */
    private fun phoneAccountHandleForSlot(slot: Int): android.telecom.PhoneAccountHandle? {
        return try {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.READ_PHONE_STATE,
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                return null
            }
            val tm = getSystemService(Context.TELECOM_SERVICE) as? TelecomManager
                ?: return null
            val handles = tm.callCapablePhoneAccounts
            if (handles.isNullOrEmpty()) return null
            if (slot in handles.indices) handles[slot] else handles[0]
        } catch (_: Throwable) {
            null
        }
    }

    /* --------------------------------------------------------------------- */
    /* Accessibility service status                                          */
    /* --------------------------------------------------------------------- */

    private fun isAccessibilityServiceEnabled(): Boolean {
        val expected = "$packageName/$packageName.UssdAccessibilityService"
        val enabled = Settings.Secure.getString(
            contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val splitter = TextUtils.SimpleStringSplitter(':')
        splitter.setString(enabled)
        while (splitter.hasNext()) {
            val entry = splitter.next()
            if (entry.equals(expected, ignoreCase = true) ||
                entry.contains("UssdAccessibilityService")
            ) {
                return true
            }
        }
        return false
    }

    /* --------------------------------------------------------------------- */
    /* Legacy one-shot USSD (kept for simple codes / diagnostics)            */
    /* --------------------------------------------------------------------- */

    private fun sendUssd(code: String, simSlot: Int, result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            result.error("unsupported", "USSD requires Android 8.0 (API 26)+", null)
            return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CALL_PHONE)
            != PackageManager.PERMISSION_GRANTED
        ) {
            result.error("permission_denied", "CALL_PHONE permission not granted", null)
            return
        }

        val baseTm = getSystemService(TELEPHONY_SERVICE) as? TelephonyManager
        if (baseTm == null) {
            result.error("no_telephony", "TelephonyManager unavailable", null)
            return
        }

        val tm: TelephonyManager = try {
            val subId = subscriptionIdForSlot(simSlot)
            if (subId != null) baseTm.createForSubscriptionId(subId) else baseTm
        } catch (_: Throwable) {
            baseTm
        }

        val handler = Handler(Looper.getMainLooper())
        var replied = false
        fun reply(action: () -> Unit) {
            if (replied) return
            replied = true
            action()
        }

        try {
            tm.sendUssdRequest(
                code,
                object : TelephonyManager.UssdResponseCallback() {
                    override fun onReceiveUssdResponse(
                        telephonyManager: TelephonyManager,
                        request: String,
                        response: CharSequence,
                    ) {
                        reply { result.success(response.toString()) }
                    }

                    override fun onReceiveUssdResponseFailed(
                        telephonyManager: TelephonyManager,
                        request: String,
                        failureCode: Int,
                    ) {
                        reply {
                            result.error(
                                "ussd_failed",
                                "USSD failed (code $failureCode)",
                                null,
                            )
                        }
                    }
                },
                handler,
            )
        } catch (e: SecurityException) {
            reply { result.error("permission_denied", e.message, null) }
        } catch (e: Throwable) {
            reply { result.error("ussd_error", e.message, null) }
        }
    }

    /** Best-effort map from a physical SIM slot index to a subscription id. */
    private fun subscriptionIdForSlot(slot: Int): Int? {
        return try {
            if (ContextCompat.checkSelfPermission(
                    this,
                    Manifest.permission.READ_PHONE_STATE,
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                return null
            }
            val sm = getSystemService(TELEPHONY_SUBSCRIPTION_SERVICE)
                as? android.telephony.SubscriptionManager ?: return null
            val info = sm.getActiveSubscriptionInfoForSimSlotIndex(slot) ?: return null
            info.subscriptionId
        } catch (_: Throwable) {
            null
        }
    }
}
