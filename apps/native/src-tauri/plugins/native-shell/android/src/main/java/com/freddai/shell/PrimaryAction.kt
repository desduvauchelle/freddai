package com.freddai.shell

import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.util.TypedValue
import android.widget.Button
import androidx.core.graphics.ColorUtils

/** Native theme colors, with state-aware fill and contrasting text/icons. */
internal fun Button.primaryAction() {
    val value = TypedValue()
    context.theme.resolveAttribute(androidx.appcompat.R.attr.colorPrimary, value, true)
    val primary = if (value.resourceId != 0) context.getColor(value.resourceId) else value.data
    val foreground = if (ColorUtils.calculateLuminance(primary) > 0.179) Color.BLACK else Color.WHITE
    val states = arrayOf(intArrayOf(android.R.attr.state_enabled), intArrayOf())
    val fill = ColorStateList(states, intArrayOf(primary, ColorUtils.setAlphaComponent(primary, 64)))
    val ink = ColorStateList(states, intArrayOf(foreground, ColorUtils.setAlphaComponent(foreground, 100)))
    val shape = GradientDrawable().apply { cornerRadius = 24 * resources.displayMetrics.density; color = fill }
    background = RippleDrawable(ColorStateList.valueOf(ColorUtils.setAlphaComponent(foreground, 40)), shape, null)
    setTextColor(ink)
    compoundDrawableTintList = ink
}
