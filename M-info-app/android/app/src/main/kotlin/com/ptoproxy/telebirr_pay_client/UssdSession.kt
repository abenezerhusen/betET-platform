package com.ptoproxy.telebirr_pay_client

import android.os.Handler
import android.os.Looper

/**
 * Shared state for one in-flight interactive USSD "send money" session.
 *
 * The [MainActivity] (or heartbeat command handler) dials the initial code
 * and populates the ordered [steps]; the [UssdAccessibilityService] then reads
 * each USSD dialog as it appears and types the next step, advancing
 * [stepIndex]. When the last step has been sent and the final (input-less)
 * result dialog appears, the session is [finish]ed and the outcome is pushed
 * back to Dart via [MainActivity.methodChannel] → `ussdSessionResult`.
 *
 * Only ONE session can be active at a time (USSD is inherently serial).
 */
object UssdSession {
    @Volatile var active: Boolean = false
        private set

    @Volatile var id: String = ""
        private set

    @Volatile var steps: List<String> = emptyList()
        private set

    @Volatile var stepIndex: Int = 0

    /** Text of the last dialog we acted on, to debounce repeated events. */
    @Volatile var lastPromptText: String? = null

    private val handler = Handler(Looper.getMainLooper())
    private var timeoutRunnable: Runnable? = null

    /** Total wall-clock budget for the whole menu walk. */
    private const val SESSION_TIMEOUT_MS = 90_000L

    @Synchronized
    fun start(sessionId: String, sessionSteps: List<String>) {
        id = sessionId
        steps = sessionSteps
        stepIndex = 0
        lastPromptText = null
        active = true
        armTimeout()
    }

    @Synchronized
    fun finish(ok: Boolean, message: String) {
        if (!active) return
        active = false
        cancelTimeout()
        val resultId = id
        handler.post {
            UssdOverlay.hide()
            MainActivity.methodChannel?.invokeMethod(
                "ussdSessionResult",
                mapOf("id" to resultId, "ok" to ok, "message" to message),
            )
        }
    }

    private fun armTimeout() {
        cancelTimeout()
        val r = Runnable { finish(false, "ussd_timeout") }
        timeoutRunnable = r
        handler.postDelayed(r, SESSION_TIMEOUT_MS)
    }

    private fun cancelTimeout() {
        timeoutRunnable?.let { handler.removeCallbacks(it) }
        timeoutRunnable = null
    }
}
