package com.ptoproxy.telebirr_pay_client

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Drives Telebirr's multi-step "send money" USSD menu automatically.
 *
 * When a withdrawal session is active ([UssdSession.active]) it watches for
 * each USSD dialog the telephony framework shows, types the next queued reply
 * into the dialog's input field, and presses the positive ("Send") button —
 * walking the whole menu (option → recipient → amount → comment → PIN) with no
 * human interaction. The final input-less result dialog ends the session.
 *
 * The user must enable this service once under Settings → Accessibility.
 */
class UssdAccessibilityService : AccessibilityService() {

    companion object {
        @Volatile
        private var connected: Boolean = false

        /** True once the OS has bound this accessibility service. */
        fun isRunning(): Boolean = connected

        private val POSITIVE = listOf(
            "send", "ok", "yes", "confirm", "reply", "submit", "next",
            // Amharic
            "ላክ", "እሺ", "አዎ", "ይላኩ", "ቀጥል",
        )
        private val NEGATIVE = listOf(
            "cancel", "dismiss", "no", "close", "back",
            // Amharic
            "ሰርዝ", "አይ", "ተወው", "ዝጋ",
        )
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        connected = true
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        connected = false
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        connected = false
        super.onDestroy()
    }

    override fun onInterrupt() {}

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        if (!UssdSession.active) return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> Unit
            else -> return
        }
        val root = rootInActiveWindow ?: return
        try {
            handleDialog(root)
        } catch (_: Throwable) {
            // Never crash the accessibility service on a malformed tree.
        }
    }

    private fun handleDialog(root: AccessibilityNodeInfo) {
        val promptText = collectText(root).trim()
        if (promptText.isEmpty()) return
        if (promptText == UssdSession.lastPromptText) return

        val editable = findEditable(root)

        if (editable != null) {
            // A menu prompt awaiting our input.
            val idx = UssdSession.stepIndex
            val steps = UssdSession.steps
            if (idx >= steps.size) {
                // Telebirr asked for more than we scripted — abort safely.
                UssdSession.lastPromptText = promptText
                clickPositive(root)
                UssdSession.finish(false, "unexpected_prompt: $promptText")
                return
            }
            // Claim this dialog first so the content-change from typing does
            // not re-trigger us; roll back if the action fails so a later
            // event can retry.
            UssdSession.lastPromptText = promptText
            val typed = setText(editable, steps[idx])
            val sent = clickPositive(root)
            if (typed && sent) {
                UssdSession.stepIndex = idx + 1
            } else {
                UssdSession.lastPromptText = null // allow retry next event
            }
            return
        }

        // No input field: could be a transient "running…" progress dialog, an
        // app-chooser / SIM-picker shown BEFORE the Telebirr menu, or the
        // terminal result/error dialog AFTER the menu.
        val positive = findPositiveButton(root)
        if (positive == null) {
            // Progress dialog with no actionable button — wait for the next.
            return
        }
        if (UssdSession.stepIndex == 0) {
            // We have not entered a single menu reply yet, so this cannot be
            // the transaction result. It is a pre-USSD dialog (e.g. "Complete
            // action using" chooser). Do NOT touch it and do NOT end the
            // session — just wait for the real menu (which has an input box).
            return
        }
        UssdSession.lastPromptText = promptText
        val allStepsSent = UssdSession.stepIndex >= UssdSession.steps.size
        positive.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        UssdSession.finish(allStepsSent, promptText)
    }

    /* --------------------------------------------------------------------- */
    /* Node helpers                                                          */
    /* --------------------------------------------------------------------- */

    private fun findEditable(node: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
        node ?: return null
        if (node.isEditable ||
            (node.className?.toString()?.contains("EditText") == true)
        ) {
            return node
        }
        for (i in 0 until node.childCount) {
            val found = findEditable(node.getChild(i))
            if (found != null) return found
        }
        return null
    }

    private fun setText(node: AccessibilityNodeInfo, value: String): Boolean {
        val args = Bundle().apply {
            putCharSequence(
                AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
                value,
            )
        }
        return node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun clickPositive(root: AccessibilityNodeInfo): Boolean {
        val btn = findPositiveButton(root) ?: return false
        return btn.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    /** Best-effort discovery of the "Send"/"OK" button in a USSD dialog. */
    private fun findPositiveButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val buttons = mutableListOf<AccessibilityNodeInfo>()
        collectClickableButtons(root, buttons)
        if (buttons.isEmpty()) return null

        // 1) Prefer a button whose label matches a known positive word.
        for (b in buttons) {
            val t = (b.text?.toString() ?: "").lowercase().trim()
            if (POSITIVE.any { t == it || t.contains(it) }) return b
        }
        // 2) Otherwise pick the first button that is NOT a known negative.
        for (b in buttons) {
            val t = (b.text?.toString() ?: "").lowercase().trim()
            if (t.isNotEmpty() && NEGATIVE.none { t == it || t.contains(it) }) {
                return b
            }
        }
        // 3) Single-button dialogs (e.g. only "OK") — use it.
        return if (buttons.size == 1) buttons[0] else null
    }

    private fun collectClickableButtons(
        node: AccessibilityNodeInfo?,
        out: MutableList<AccessibilityNodeInfo>,
    ) {
        node ?: return
        val cls = node.className?.toString() ?: ""
        if ((cls.contains("Button") || node.isClickable) && !node.isEditable) {
            val t = node.text?.toString()
            if (!t.isNullOrBlank()) out.add(node)
        }
        for (i in 0 until node.childCount) {
            collectClickableButtons(node.getChild(i), out)
        }
    }

    private fun collectText(node: AccessibilityNodeInfo?): String {
        node ?: return ""
        val sb = StringBuilder()
        val cls = node.className?.toString() ?: ""
        if (!node.isEditable && !cls.contains("Button")) {
            val t = node.text?.toString()
            if (!t.isNullOrBlank()) sb.append(t).append('\n')
        }
        for (i in 0 until node.childCount) {
            sb.append(collectText(node.getChild(i)))
        }
        return sb.toString()
    }
}
