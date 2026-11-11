package com.freddai.shell

import android.content.Context
import android.view.View
import android.view.Gravity
import android.widget.TextView

internal fun threadStatusLabel(status: String, unread: Boolean): String =
    when (status) { "sending" -> "Sending…"; "queued" -> "Queued"; "running" -> "Running"; "starting" -> "Starting"; "waiting" -> "Needs you"; "interrupted" -> "Interrupted"; "failed", "error" -> "Failed"; else -> if (unread) "Unread reply" else "" }

internal fun threadStatusIndicator(host: Context, status: String, unread: Boolean): TextView {
    val spoken = threadStatusLabel(status, unread)
    val dot = TextView(host).apply {
            text = if (spoken.isEmpty()) "" else "●"; textSize = 12f; gravity = Gravity.CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            setTextColor(when (status) { "running", "starting", "sending" -> 0xffafb3bc.toInt(); "queued" -> 0xffff9500.toInt(); "waiting", "interrupted" -> 0xffff9500.toInt(); "failed", "error" -> 0xffff3b30.toInt(); else -> 0xff007aff.toInt() })
        }
        if (status == "running" || status == "starting" || status == "sending") dot.addOnAttachStateChangeListener(object : View.OnAttachStateChangeListener {
            private var pulse: android.animation.ObjectAnimator? = null
            override fun onViewAttachedToWindow(view: View) {
                if (android.provider.Settings.Global.getFloat(host.contentResolver, android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f) return
                pulse = android.animation.ObjectAnimator.ofFloat(view, "alpha", 1f, 0.4f).apply { duration = 900; repeatCount = android.animation.ValueAnimator.INFINITE; repeatMode = android.animation.ValueAnimator.REVERSE; start() }
            }
            override fun onViewDetachedFromWindow(view: View) { pulse?.cancel(); pulse = null }
        })
    return dot
}
