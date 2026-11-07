package com.freddai.shell

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Color
import android.os.SystemClock
import android.widget.TextView

/** Draws above the row without owning touch: the original mic keeps the held gesture. */
class RecordingStatusView(context: Context) : TextView(context) {
    var level = 0f
        set(value) { field = value; samples.add(value.coerceIn(0f, 1f)); if (samples.size > 32) samples.removeAt(0) }
    var sendProgress = 0f
    private var started = 0L
    var showWaveform = false
        set(value) { if (value && !field) started = SystemClock.uptimeMillis(); field = value }
    private val samples = MutableList(32) { 0f }
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG)
    override fun onDraw(canvas: Canvas) {
        if (!showWaveform) { super.onDraw(canvas); return }
        val d = resources.displayMetrics.density
        val dark = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val surface = if (dark) Color.rgb(49, 50, 57) else Color.rgb(250, 250, 252)
        val foreground = if (dark) Color.rgb(230, 230, 235) else Color.rgb(48, 48, 56)
        val green = if (dark) Color.rgb(87, 214, 140) else Color.rgb(20, 122, 69)
        val themeAccent = android.util.TypedValue()
        context.theme.resolveAttribute(android.R.attr.colorAccent, themeAccent, true)
        val accent = if (themeAccent.resourceId != 0) androidx.core.content.ContextCompat.getColor(context, themeAccent.resourceId) else if (themeAccent.type in 28..31) themeAccent.data else Color.rgb(0, 122, 255)
        val animated = android.os.Build.VERSION.SDK_INT < 26 || android.animation.ValueAnimator.areAnimatorsEnabled()
        val t = if (animated) ((SystemClock.uptimeMillis() - started) / 280f).coerceIn(0f, 1f) else 1f
        val reveal = 1 - (1 - t) * (1 - t) * (1 - t)
        val right = width.toFloat()
        val centerX = right - 24 * d
        val centerY = height - 24 * d
        val left = right - (48 + 176 * reveal) * d
        ink.color = surface; ink.style = Paint.Style.FILL
        canvas.drawRoundRect(left, centerY - 22 * d, right, centerY + 22 * d, 22 * d, 22 * d, ink)
        canvas.save()
        canvas.clipRect(left, centerY - 22 * d, right - 48 * d, centerY + 22 * d)
        ink.color = green; ink.textSize = 14 * d; ink.typeface = android.graphics.Typeface.MONOSPACE
        canvas.drawText(text.toString(), right - 180 * d, centerY + 5 * d, ink)
        ink.alpha = 255
        samples.takeLast(16).forEachIndexed { index, sample ->
            val h = (3 + 23 * sample) * d
            val x = right - 124 * d + index * 5 * d
            canvas.drawRoundRect(x, centerY - h / 2, x + 2.5f * d, centerY + h / 2, 1.25f * d, 1.25f * d, ink)
        }
        ink.alpha = 255
        canvas.restore()
        // The only red accent is the microphone, directly beneath the user's finger.
        ink.color = Color.rgb(211, 65, 76)
        canvas.drawRoundRect(centerX - 3 * d, centerY - 8 * d, centerX + 3 * d, centerY + 3 * d, 3 * d, 3 * d, ink)
        ink.style = Paint.Style.STROKE; ink.strokeWidth = 1.8f * d; ink.strokeCap = Paint.Cap.ROUND
        canvas.drawArc(centerX - 6 * d, centerY - 6 * d, centerX + 6 * d, centerY + 6 * d, 0f, 180f, false, ink)
        canvas.drawLine(centerX, centerY + 6 * d, centerX, centerY + 10 * d, ink)
        canvas.drawLine(centerX - 4 * d, centerY + 10 * d, centerX + 4 * d, centerY + 10 * d, ink)
        val armProgress = sendProgress.coerceIn(0f, 1f)
        val arrowY = centerY - 64 * d * reveal - (if (animated) 8 * d * armProgress else 0f)
        val radius = 22 * (1 + 0.18f * armProgress) * d
        ink.style = Paint.Style.FILL; ink.color = androidx.core.graphics.ColorUtils.blendARGB(surface, accent, armProgress)
        canvas.drawCircle(centerX, arrowY, radius, ink)
        ink.color = androidx.core.graphics.ColorUtils.blendARGB(foreground, Color.WHITE, armProgress); ink.style = Paint.Style.STROKE; ink.strokeWidth = 2.2f * d
        val arrow = Path().apply {
            moveTo(centerX, arrowY + 7 * d); lineTo(centerX, arrowY - 7 * d)
            moveTo(centerX - 6 * d, arrowY - d); lineTo(centerX, arrowY - 7 * d); lineTo(centerX + 6 * d, arrowY - d)
        }
        canvas.drawPath(arrow, ink)
        ink.style = Paint.Style.FILL
        if (t < 1) postInvalidateOnAnimation()
    }
}
