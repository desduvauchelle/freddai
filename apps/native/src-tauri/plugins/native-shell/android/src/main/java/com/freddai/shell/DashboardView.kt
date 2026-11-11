package com.freddai.shell

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.HapticFeedbackConstants
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONObject
import org.json.JSONArray
import java.io.File
import java.util.UUID

/** Native dashboard controls; gestures and the recorder never wait for a WebView round trip. */
class DashboardView(private val activity: AppCompatActivity,
    private val emit: (JSONObject) -> Unit, private val error: (String) -> Unit) : FrameLayout(activity) {
    val workspace = FrameLayout(activity)
    private val openSummaries = mutableSetOf<String>()
    private val scroll = ScrollView(activity).apply { isFillViewport = true }
    private val column = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var renderedColumns = 1
    private var model = JSONObject()
    private var voiceReady = false
    private var active: JSONObject? = null
    private var activeButton: Button? = null
    private var awaitingTranscript = false
    // Same recording UI as the thread composer, pinned below the scroll container so cards never clip it.
    private val recordingStatus = RecordingStatusView(activity).apply { textSize = 13f; gravity = android.view.Gravity.BOTTOM or android.view.Gravity.RIGHT; setPadding(0, 0, dp(56), dp(14)); visibility = View.GONE }
    private val recordingTarget = TextView(activity).apply {
        textSize = 14f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; visibility = View.GONE
        setPadding(dp(14), 0, dp(14), 0); gravity = android.view.Gravity.CENTER_VERTICAL
        val dark = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
        setTextColor(if (dark) android.graphics.Color.rgb(230, 230, 235) else android.graphics.Color.rgb(48, 48, 56))
        background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(if (dark) android.graphics.Color.rgb(49, 50, 57) else android.graphics.Color.rgb(250, 250, 252)) }
    }
    private val recordingCancel: Button = button("Cancel recording") { recorder.cancel() }.apply { text = "×"; visibility = View.GONE }
    private val recordingSend: Button = button("Send recording") { recorder.send() }.apply { text = "↑"; visibility = View.GONE }
    private val cancelColors = recordingCancel.textColors
    private val recorder: ComposerRecorder = ComposerRecorder(activity, Button(activity), { status ->
        val showing = status.isNotEmpty() && status != "Transcribing…"
        recordingStatus.showWaveform = showing; recordingStatus.text = status; recordingStatus.invalidate()
        val visibility = if (showing) View.VISIBLE else View.GONE
        recordingStatus.visibility = visibility; recordingCancel.visibility = visibility; recordingSend.visibility = visibility; recordingTarget.visibility = visibility
        if (status.isEmpty() && active != null) { active = null; activeButton = null; post { if (active == null) render() } }
    }, { path, _ ->
        // Send mode: the JS side transcribes and starts a new task, leaving the dashboard in place.
        active?.let { emit(action("voice", it).put("path", path).put("send", true)) } ?: lastProject?.let { emit(action("voice", it).put("path", path).put("send", true)) }
    }, { message -> error(message) }, { level -> recordingStatus.level = level; recordingStatus.invalidate() }, { progress ->
        val sendAmount = progress.coerceIn(0f, 1f)
        val cancelAmount = (-progress).coerceIn(0f, 1f)
        val accent = android.graphics.Color.rgb(0, 122, 255)
        recordingSend.setTextColor(androidx.core.graphics.ColorUtils.blendARGB(primaryColor, android.graphics.Color.WHITE, sendAmount))
        recordingSend.background = android.graphics.drawable.GradientDrawable().apply { cornerRadius = dp(22).toFloat(); setColor(androidx.core.graphics.ColorUtils.blendARGB(if (isDark) android.graphics.Color.rgb(49, 50, 57) else android.graphics.Color.rgb(250, 250, 252), accent, sendAmount)) }
        recordingSend.scaleX = 1 + sendAmount; recordingSend.scaleY = 1 + sendAmount
        recordingCancel.scaleX = 1 + 0.5f * cancelAmount; recordingCancel.scaleY = 1 + 0.5f * cancelAmount
        recordingCancel.setTextColor(androidx.core.graphics.ColorUtils.blendARGB(cancelColors.defaultColor, android.graphics.Color.RED, cancelAmount))
        recordingStatus.drawSendCue = false; recordingStatus.sendProgress = sendAmount; recordingStatus.invalidate()
    }, "freddai-dashboard-microphone")
    private var lastProject: JSONObject? = null
    init {
        scroll.setOnScrollChangeListener { _, _, _, _, _ -> if (activeButton != null) positionRecordingControls() }
        recorder.sendTarget = recordingSend
        recorder.cancelTarget = recordingCancel
        clipChildren = false; clipToPadding = false
        column.setPadding(dp(16), dp(16), dp(16), dp(24))
        scroll.addView(column, FrameLayout.LayoutParams(-1, -2))
        addView(scroll, FrameLayout.LayoutParams(-1, -1))
        addView(recordingStatus, FrameLayout.LayoutParams(dp(224), dp(48), android.view.Gravity.BOTTOM or android.view.Gravity.RIGHT))
        addView(recordingTarget, FrameLayout.LayoutParams(dp(160), dp(44), android.view.Gravity.BOTTOM or android.view.Gravity.RIGHT).apply { bottomMargin = dp(52); rightMargin = dp(64) })
        addView(recordingCancel, FrameLayout.LayoutParams(dp(44), dp(44), android.view.Gravity.BOTTOM or android.view.Gravity.RIGHT).apply { rightMargin = dp(180); bottomMargin = dp(2) })
        addView(recordingSend, FrameLayout.LayoutParams(dp(44), dp(44), android.view.Gravity.BOTTOM or android.view.Gravity.RIGHT).apply { rightMargin = dp(2); bottomMargin = dp(66) })
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
    private val isDark get() = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
    private val primaryColor get() = if (isDark) android.graphics.Color.rgb(240, 240, 244) else android.graphics.Color.rgb(28, 28, 32)
    private val secondaryColor get() = if (isDark) android.graphics.Color.argb(166, 235, 235, 245) else android.graphics.Color.argb(166, 60, 60, 67)
    private fun rippleBackground(): android.graphics.drawable.Drawable? {
        val v = android.util.TypedValue(); activity.theme.resolveAttribute(android.R.attr.selectableItemBackground, v, true)
        return ContextCompat.getDrawable(activity, v.resourceId)
    }
    private fun iconButton() = Button(activity, null, android.R.attr.borderlessButtonStyle).apply {
        isAllCaps = false; minWidth = 0; minimumWidth = 0; minimumHeight = dp(48); setPadding(0, 0, 0, 0); gravity = android.view.Gravity.CENTER
    }
    private fun button(label: String, action: () -> Unit) = Button(activity, null, android.R.attr.borderlessButtonStyle).apply {
        text = label; contentDescription = label; isAllCaps = false; minimumHeight = dp(48)
        setOnClickListener { action() }
    }
    fun apply(next: JSONObject) {
        model = next; awaitingTranscript = model.optBoolean("busy")
        val projects = model.optJSONArray("projects") ?: JSONArray()
        if (!model.optBoolean("connected") || active?.let { current ->
            (0 until projects.length()).none { projects.getJSONObject(it).optString("id") == current.optString("id") && projects.getJSONObject(it).optBoolean("canStart") }
        } == true) finish(true)
        if (active == null) render()
    }
    fun setVoice(enabled: Boolean) { voiceReady = enabled; recorder.update(enabled, false); if (active == null) render() }
    fun cancelRecording() = finish(true)
    fun dispose() { recorder.dispose() }
    override fun onDetachedFromWindow() { finish(true); super.onDetachedFromWindow() }
    private fun action(name: String, project: JSONObject? = null) = JSONObject().put("action", name)
        .put("project", project?.optString("id") ?: "").put("assistant", project?.optString("assistant") ?: "")
    private fun columns(): Int {
        val widthDp = width / resources.displayMetrics.density
        val landscape = resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
        return if (resources.configuration.fontScale >= 1.5f) 1 else if (widthDp >= 900 || landscape && widthDp >= 680) 3 else if (widthDp >= 680) 2 else 1
    }
    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (active == null && columns() != renderedColumns) post { if (active == null) render() }
        if (activeButton != null) post { positionRecordingControls() }
    }
    private fun render() {
        renderedColumns = columns()
        column.removeAllViews()
        (workspace.parent as? android.view.ViewGroup)?.removeView(workspace)
        if (!model.isNull("workspace")) {
            val name = model.optString("workspace")
            column.addView(button(name) { emit(action("workspace")) }.apply {
                contentDescription = "Workspace: $name"
                isEnabled = !model.optBoolean("busy") && !awaitingTranscript
            })
        }
        column.addView(workspace, LinearLayout.LayoutParams(-1, dp(model.optInt("workspaceHeight", 240))))
        if (model.optString("message").isNotEmpty()) column.addView(TextView(activity).apply { text = model.optString("message") })
        val header = LinearLayout(activity).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        header.addView(TextView(activity).apply { text = "Your projects"; textSize = 23f }, LinearLayout.LayoutParams(0, -2, 1f))
        val defaults = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL; gravity = android.view.Gravity.CENTER_VERTICAL; contentDescription = "Dashboard task defaults" }
        fun picker(label: String, value: String, event: String) {
            val control = button(value) { emit(action(event)) }.apply {
                contentDescription = "$label: $value"; textSize = 12f
                minimumHeight = dp(44); minWidth = 0; minimumWidth = 0; maxWidth = dp(180)
                setPadding(dp(9), 0, dp(9), 0); setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END
                val chevron = ContextCompat.getDrawable(activity, android.R.drawable.arrow_down_float)?.mutate()?.apply { setBounds(0, 0, dp(12), dp(12)); setTint(secondaryColor) }
                setCompoundDrawables(null, null, chevron, null); compoundDrawablePadding = dp(6)
                background = android.graphics.drawable.InsetDrawable(android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(6).toFloat(); setColor(if (isDark) android.graphics.Color.rgb(36, 36, 40) else android.graphics.Color.rgb(250, 250, 252))
                    setStroke(dp(1), android.graphics.Color.argb(50, 128, 128, 128))
                }, 0, dp(6), 0, dp(6))
                isEnabled = model.optBoolean("connected") && !model.optBoolean("busy") && !awaitingTranscript
            }
            defaults.addView(control, LinearLayout.LayoutParams(if (width / resources.displayMetrics.density >= 620) -2 else 0, dp(44), if (width / resources.displayMetrics.density >= 620) 0f else 1f).apply { leftMargin = dp(6) })
        }
        picker("Provider", model.optString("agent", "Project defaults"), "agent")
        if (model.optBoolean("hasControls")) {
            picker("Model", model.optString("model", "Model default"), "dashboard-model")
            picker("Difficulty", model.optString("difficulty", "Difficulty default"), "dashboard-effort")
        }
        if (width / resources.displayMetrics.density >= 620) header.addView(defaults)
        column.addView(header)
        if (width / resources.displayMetrics.density < 620) column.addView(defaults)
        if (model.optBoolean("busy") || awaitingTranscript) column.addView(TextView(activity).apply { text = "Transcribing…" })
        else if (!model.optBoolean("connected")) column.addView(TextView(activity).apply { text = "Connect to your Mac to start tasks." })
        val projects = model.optJSONArray("projects") ?: JSONArray()
        if (projects.length() == 0) column.addView(TextView(activity).apply { text = "Your projects will appear here." })
        val groups = model.optJSONArray("projectGroups") ?: JSONArray().put(JSONObject().put("projects", JSONArray().apply { for (i in 0 until projects.length()) put(projects.getJSONObject(i).getString("id")) }))
        for (groupIndex in 0 until groups.length()) {
            val group = groups.getJSONObject(groupIndex)
            val ids = group.optJSONArray("projects") ?: JSONArray()
            val groupedProjects = (0 until ids.length()).mapNotNull { index ->
                (0 until projects.length()).map { projects.getJSONObject(it) }.firstOrNull { it.optString("id") == ids.optString(index) }
            }
            if (groupedProjects.isEmpty()) continue
            if (!group.isNull("name")) column.addView(TextView(activity).apply {
                text = group.getString("name").uppercase(); textSize = 13f; typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.NORMAL)
                letterSpacing = 0.04f; setTextColor(secondaryColor); setPadding(0, dp(24), 0, dp(8))
                androidx.core.view.ViewCompat.setAccessibilityHeading(this, true)
            })
            var gridRow: LinearLayout? = null
            for (i in groupedProjects.indices) {
                if (i % renderedColumns == 0) {
                    gridRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
                    column.addView(gridRow, LinearLayout.LayoutParams(-1, -2).apply { if (i > 0) topMargin = dp(12) })
                }
                val project = groupedProjects[i]
                val card = LinearLayout(activity).apply {
                    orientation = LinearLayout.VERTICAL; setPadding(dp(14), dp(10), dp(14), dp(10))
                    background = android.graphics.drawable.GradientDrawable().apply {
                        cornerRadius = dp(12).toFloat(); setColor(if (isDark) 0x0AFFFFFF else 0x0A000000); setStroke(dp(1).coerceAtLeast(1), if (isDark) 0x14FFFFFF else 0x14000000)
                    }
                    // Top-aligned: the row stretches to the tallest card, but content stays at the top.
                    layoutParams = LinearLayout.LayoutParams(0, -1, 1f).apply { if (i % renderedColumns != 0) marginStart = dp(12) }
                }
                val enabled = project.optBoolean("canStart") && !awaitingTranscript
                val actions = LinearLayout(activity).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
                card.addView(actions, LinearLayout.LayoutParams(-1, dp(48)))
                val projectColor = runCatching { android.graphics.Color.parseColor(project.optString("color")) }.getOrNull() ?: secondaryColor
                val titleRow = LinearLayout(activity).apply {
                    gravity = android.view.Gravity.CENTER_VERTICAL; isClickable = true; minimumHeight = dp(48)
                    contentDescription = "Open ${project.getString("name")}"
                    setOnClickListener { emit(action("open", project)) }
                    val statusDot = FrameLayout(activity).apply { clipChildren = false; clipToPadding = false }
                    statusDot.background = android.graphics.drawable.GradientDrawable().apply { shape = android.graphics.drawable.GradientDrawable.OVAL; setColor(projectColor) }
                    addView(statusDot, LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(8) })
                    addView(TextView(activity).apply {
                        text = project.getString("name"); textSize = 15f; typeface = android.graphics.Typeface.create("sans-serif-medium", android.graphics.Typeface.BOLD)
                        setTextColor(primaryColor); setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                }
                actions.addView(titleRow, LinearLayout.LayoutParams(0, -1, 1f))
                actions.addView(iconButton().apply {
                    text = "+"; textSize = 20f; setTextColor(secondaryColor); isEnabled = enabled; alpha = if (enabled) 1f else 0.4f
                    contentDescription = "New thread in ${project.getString("name")}"
                    setOnClickListener { emit(action("new", project)) }
                }, LinearLayout.LayoutParams(dp(48), dp(48)))
                val mic = iconButton().apply {
                    val icon = ContextCompat.getDrawable(activity, android.R.drawable.ic_btn_speak_now)?.mutate()?.apply {
                        setBounds(0, 0, dp(18), dp(18)); setTint(secondaryColor)
                    }
                    setCompoundDrawables(icon, null, null, null)
                    isEnabled = enabled && voiceReady; alpha = if (isEnabled) 1f else 0.4f
                    contentDescription = "Dictate task in ${project.getString("name")}. Hold and release to send. Tap to record until Send or Cancel."
                }
                // Same hold / slide-up-to-send / slide-left-to-cancel / tap-to-record gesture as the composer.
                recorder.bind(mic) { begin(project, mic) }
                actions.addView(mic, LinearLayout.LayoutParams(dp(48), dp(48))); gridRow?.addView(card)
                val recent = project.optJSONArray("recent") ?: JSONArray()
                for (t in 0 until minOf(recent.length(), 3)) {
                    val thread = recent.getJSONObject(t)
                    val status = thread.optString("status")
                    val unread = thread.optBoolean("unread")
                    val row = LinearLayout(activity).apply {
                        gravity = android.view.Gravity.CENTER_VERTICAL
                        isClickable = true; isFocusable = true; background = rippleBackground()
                        contentDescription = listOf(thread.optString("title"), threadStatusLabel(status, unread)).filter { it.isNotEmpty() }.joinToString(", ")
                        setOnClickListener { emit(action("thread", project).put("thread", thread.optString("id"))) }
                    }
                    row.addView(TextView(activity).apply {
                        text = thread.optString("title"); textSize = 14.5f; setTextColor(primaryColor); letterSpacing = 0f
                        setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END; gravity = android.view.Gravity.CENTER_VERTICAL
                        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                    }, LinearLayout.LayoutParams(0, -1, 1f))
                    row.addView(threadStatusIndicator(activity, status, unread), LinearLayout.LayoutParams(dp(20), -1))
                    card.addView(row, LinearLayout.LayoutParams(-1, dp(36)))
                }
                if (recent.length() == 0) card.addView(TextView(activity).apply {
                    text = "No threads yet"; textSize = 14f; setTextColor(secondaryColor); alpha = 0.7f; gravity = android.view.Gravity.CENTER_VERTICAL
                }, LinearLayout.LayoutParams(-1, dp(36)))
                if (i == groupedProjects.size - 1) repeat((renderedColumns - groupedProjects.size % renderedColumns) % renderedColumns) { gridRow?.addView(Space(activity), LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = dp(12) }) }
            }
        }
        val summaries = model.optJSONArray("summaries") ?: JSONArray()
        if (summaries.length() > 0) column.addView(TextView(activity).apply { text = "Daily summaries"; textSize = 18f })
        for (index in 0 until summaries.length()) {
            val summary = summaries.getJSONObject(index); val date = summary.getString("date")
            val expanded = date in openSummaries || index == 0 && "closed:$date" !in openSummaries
            val row = LinearLayout(activity)
            row.addView(button("${if (expanded) "▾" else "▸"} ${summary.getString("label")}") {
                if (expanded) { openSummaries.remove(date); openSummaries.add("closed:$date") }
                else { openSummaries.add(date); openSummaries.remove("closed:$date") }
                render()
            }, LinearLayout.LayoutParams(0, -2, 1f))
            if (!summary.isNull("action")) row.addView(button(summary.getString("action")) {
                emit(JSONObject().put("action", "summary").put("project", date))
            }.apply { isEnabled = model.optBoolean("connected") && !summary.optBoolean("busy") })
            column.addView(row)
            if (expanded) column.addView(TextView(activity).apply { text = summary.optString("text"); textSize = 14f })
        }

        if (model.optBoolean("schedules")) column.addView(button("Schedules") { emit(action("schedules")) })
        if (!voiceReady) column.addView(TextView(activity).apply { text = "Enable voice dictation and prepare its model on your Mac to use the microphone."; textSize = 13f })
    }
    private fun positionRecordingControls() {
        val anchor = activeButton ?: return
        val location = IntArray(2); val origin = IntArray(2)
        anchor.getLocationInWindow(location); getLocationInWindow(origin)
        val capsuleWidth = minOf(dp(224), width)
        val right = (location[0] - origin[0] + anchor.width / 2 + dp(24)).coerceIn(capsuleWidth, width)
        val bottom = (location[1] - origin[1] - dp(8)).coerceIn(dp(132), height)
        fun place(view: View, w: Int, h: Int, x: Int, y: Int) {
            view.layoutParams = FrameLayout.LayoutParams(w, h, android.view.Gravity.TOP or android.view.Gravity.LEFT).apply {
                leftMargin = x; topMargin = y
            }
        }
        place(recordingStatus, capsuleWidth, dp(48), right - capsuleWidth, bottom - dp(48))
        place(recordingCancel, dp(44), dp(44), right - capsuleWidth, bottom - dp(46))
        place(recordingSend, dp(44), dp(44), right - dp(46), bottom - dp(112))
        place(recordingTarget, minOf(dp(160), capsuleWidth - dp(48)), dp(44), right - capsuleWidth, bottom - dp(96))
    }
    private fun begin(project: JSONObject, button: Button) {
        active = project; lastProject = project; activeButton = button
        positionRecordingControls()
        recordingTarget.text = "To ${project.optString("name")}"
        recordingTarget.contentDescription = "Recording to ${project.optString("name")}"
        fun disableOthers(view: View) {
            if (view is Button && view !== button) view.isEnabled = false
            if (view is android.view.ViewGroup) for (i in 0 until view.childCount) disableOthers(view.getChildAt(i))
        }
        disableOthers(column)
    }
    private fun finish(cancel: Boolean) { if (cancel) recorder.cancel() else recorder.send() }
}
