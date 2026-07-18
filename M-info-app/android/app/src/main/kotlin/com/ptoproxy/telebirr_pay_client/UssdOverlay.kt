package com.ptoproxy.telebirr_pay_client

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Build
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/**
 * Full-screen opaque cover shown while an interactive USSD withdrawal runs, so
 * the operator never sees the Telebirr menu dialogs flashing. The
 * [UssdAccessibilityService] keeps driving the dialogs underneath because
 * accessibility works on the window hierarchy regardless of what is drawn on
 * top; the overlay is [FLAG_NOT_FOCUSABLE] so it never steals focus from the
 * USSD dialog.
 *
 * Best-effort: if the "Display over other apps" permission is not granted the
 * withdrawal still runs (just visibly).
 */
object UssdOverlay {
    private var view: View? = null
    private var windowManager: WindowManager? = null

    fun canDraw(context: Context): Boolean = Settings.canDrawOverlays(context)

    @Synchronized
    fun show(context: Context) {
        if (view != null) return
        if (!canDraw(context)) return
        val wm = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
            ?: return

        val root = FrameLayout(context).apply {
            setBackgroundColor(Color.parseColor("#0B1220"))
            isClickable = true
            addView(
                LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    gravity = Gravity.CENTER
                    addView(ProgressBar(context))
                    addView(
                        TextView(context).apply {
                            text = "Processing withdrawal…"
                            setTextColor(Color.WHITE)
                            textSize = 16f
                            setPadding(0, 32, 0, 0)
                            gravity = Gravity.CENTER
                        },
                    )
                    addView(
                        TextView(context).apply {
                            text = "Please keep the screen on"
                            setTextColor(Color.parseColor("#9AA4B2"))
                            textSize = 12f
                            setPadding(0, 12, 0, 0)
                            gravity = Gravity.CENTER
                        },
                    )
                },
                FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    FrameLayout.LayoutParams.WRAP_CONTENT,
                    Gravity.CENTER,
                ),
            )
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            // NOT_FOCUSABLE: never steal focus from the USSD dialog so the
            // accessibility service can keep typing into it.
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON,
            PixelFormat.OPAQUE,
        )

        try {
            wm.addView(root, params)
            view = root
            windowManager = wm
        } catch (_: Throwable) {
            view = null
            windowManager = null
        }
    }

    @Synchronized
    fun hide() {
        val v = view
        val wm = windowManager
        view = null
        windowManager = null
        if (v != null && wm != null) {
            try {
                wm.removeView(v)
            } catch (_: Throwable) {
                // already removed
            }
        }
    }
}
