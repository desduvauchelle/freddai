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
    private val emit: (JSONObject) -> Unit, private val error: (String) -> Unit) : ScrollView(activity) {
    val workspace = FrameLayout(activity)
    private val openSummaries = mutableSetOf<String>()
    private val column = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
    private var renderedColumns = 1
    private var model = JSONObject()
    private var voiceReady = false
    private var active: JSONObject? = null
    private var mic: Button? = null
    private var recorder: MediaRecorder? = null
    private var recordingFile: File? = null
    private var started = 0L
    private var generation = 0
    private var permissionGeneration = -1
    private var awaitingTranscript = false
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            if (recorder == null) return
            mic?.contentDescription = "Recording ${(SystemClock.elapsedRealtime() - started) / 1000} seconds. Release to transcribe."
            handler.postDelayed(this, 250)
        }
    }
    private val permission = activity.activityResultRegistry.register("freddai-dashboard-microphone", ActivityResultContracts.RequestPermission()) { granted ->
        if (permissionGeneration == generation && active != null) {
            if (granted) startRecorder() else { finish(true); error("Microphone access is off. Enable it in Android Settings → Freddai → Permissions.") }
        }
    }
    init {
        isFillViewport = true
        column.setPadding(dp(16), dp(12), dp(16), dp(24))
        addView(column, LayoutParams(-1, -2))
    }
    private fun dp(n: Int) = (n * resources.displayMetrics.density).toInt()
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
    fun setVoice(enabled: Boolean) { voiceReady = enabled; if (!enabled) finish(true); if (active == null) render() }
    fun cancelRecording() = finish(true)
    fun dispose() { finish(true); permission.unregister() }
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
    }
    private fun render() {
        renderedColumns = columns()
        column.removeAllViews()
        (workspace.parent as? android.view.ViewGroup)?.removeView(workspace)
        column.addView(workspace, LinearLayout.LayoutParams(-1, dp(240)))
        if (model.optString("message").isNotEmpty()) column.addView(TextView(activity).apply { text = model.optString("message") })
        val header = LinearLayout(activity).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
        header.addView(TextView(activity).apply { text = "Your projects"; textSize = 23f }, LinearLayout.LayoutParams(0, -2, 1f))
        header.addView(button(model.optString("agent", "Project defaults")) { emit(action("agent")) }
            .apply { contentDescription = "Coding agent: ${model.optString("agent")}"; isEnabled = model.optBoolean("connected") && !model.optBoolean("busy") && !awaitingTranscript }, LinearLayout.LayoutParams(0, -2, 1f))
        column.addView(header)
        if (model.optBoolean("busy") || awaitingTranscript) column.addView(TextView(activity).apply { text = "Transcribing…" })
        else if (!model.optBoolean("connected")) column.addView(TextView(activity).apply { text = "Connect to your Mac to start tasks." })
        val projects = model.optJSONArray("projects") ?: JSONArray()
        if (projects.length() == 0) column.addView(TextView(activity).apply { text = "Your projects will appear here." })
        var gridRow: LinearLayout? = null
        for (i in 0 until projects.length()) {
            if (i % renderedColumns == 0) {
                gridRow = LinearLayout(activity).apply { orientation = LinearLayout.HORIZONTAL }
                column.addView(gridRow)
            }
            val project = projects.getJSONObject(i)
            val card = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(12), dp(12), dp(12))
                val color = android.util.TypedValue(); activity.theme.resolveAttribute(android.R.attr.colorControlHighlight, color, true)
                background = android.graphics.drawable.GradientDrawable().apply { setColor(color.data); cornerRadius = dp(14).toFloat() }
                layoutParams = LinearLayout.LayoutParams(0, -2, 1f).apply { topMargin = dp(12); if (i % renderedColumns != 0) marginStart = dp(12) }
            }
            val enabled = project.optBoolean("canStart") && !awaitingTranscript
            val actions = LinearLayout(activity).apply { gravity = android.view.Gravity.CENTER_VERTICAL }
            card.addView(actions)
            actions.addView(button(project.getString("name")) { emit(action("open", project)) }, LinearLayout.LayoutParams(0, -2, 1f))
            card.addView(TextView(activity).apply { text = project.getString("activity"); textSize = 13f })
            actions.addView(button("+") { emit(action("new", project)) }.apply { isEnabled = enabled; contentDescription = "New thread in ${project.getString("name")}" }, LinearLayout.LayoutParams(dp(48), dp(48)))
            if (project.optString("model").isNotEmpty()) card.addView(button(project.getString("model")) { emit(action("model", project)) }.apply { isEnabled = enabled; contentDescription = "Model for ${project.getString("name")}: ${project.getString("model")}" })
            val mic = button("") {}.apply {
                setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_btn_speak_now, 0, 0, 0)
                isEnabled = enabled && voiceReady
                contentDescription = "Dictate task in ${project.getString("name")}. Hold to record, release to transcribe. Move away to cancel."
            }
            mic.setOnTouchListener { _, event ->
                if (!mic.isEnabled) return@setOnTouchListener false
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> { begin(project, mic); mic.parent?.requestDisallowInterceptTouchEvent(true); true }
                    MotionEvent.ACTION_MOVE -> { if (event.x < -dp(32) || event.y < -dp(32) || event.x > mic.width + dp(32) || event.y > mic.height + dp(32)) finish(true); true }
                    MotionEvent.ACTION_UP -> { finish(false); parent?.requestDisallowInterceptTouchEvent(false); true }
                    MotionEvent.ACTION_POINTER_DOWN -> { finish(true); true }
                    MotionEvent.ACTION_CANCEL -> { finish(true); parent?.requestDisallowInterceptTouchEvent(false); true }
                    else -> true
                }
            }
            // Accessibility and keyboard activation provide an explicit start/finish alternative to holding.
            mic.setOnClickListener { if (active == null) begin(project, mic) else finish(false) }
            actions.addView(mic, LinearLayout.LayoutParams(dp(48), dp(48))); gridRow?.addView(card)
            if (i == projects.length() - 1) repeat((renderedColumns - projects.length() % renderedColumns) % renderedColumns) { gridRow?.addView(Space(activity), LinearLayout.LayoutParams(0, 1, 1f)) }
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
    private fun begin(project: JSONObject, button: Button) {
        if (active != null || !voiceReady || !project.optBoolean("canStart") || awaitingTranscript) return
        active = project; mic = button; generation++
        fun disableOthers(view: View) {
            if (view is Button && view !== button) view.isEnabled = false
            if (view is android.view.ViewGroup) for (i in 0 until view.childCount) disableOthers(view.getChildAt(i))
        }
        disableOthers(column)
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startRecorder()
        else { permissionGeneration = generation; permission.launch(Manifest.permission.RECORD_AUDIO) }
    }
    @Suppress("DEPRECATION")
    private fun startRecorder() {
        if (active == null) return
        try {
            val root = File(activity.cacheDir, "freddai-attachments").apply { mkdirs() }
            val file = File(root, "${UUID.randomUUID()}.m4a"); recordingFile = file
            val capture = MediaRecorder(); recorder = capture
            capture.setAudioSource(MediaRecorder.AudioSource.MIC)
            capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            capture.setAudioSamplingRate(16000); capture.setAudioChannels(1); capture.setAudioEncodingBitRate(32000)
            capture.setOutputFile(file.absolutePath); capture.setMaxDuration(120000); capture.setMaxFileSize(9L * 1024 * 1024)
            capture.setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) finish(false) }
            capture.setOnErrorListener { _, _, _ -> finish(true); error("Microphone recording was interrupted. Hold to try again.") }
            capture.prepare(); capture.start(); started = SystemClock.elapsedRealtime()
            mic?.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            mic?.announceForAccessibility("Recording. Activate again to finish.")
            handler.post(tick)
        } catch (_: Exception) { finish(true); error("Could not start the microphone. Check Freddai's microphone permission.") }
    }
    private fun finish(cancel: Boolean) {
        val project = active ?: return
        active = null; generation++; handler.removeCallbacks(tick)
        val capture = recorder; recorder = null
        val file = recordingFile; recordingFile = null
        var success = capture != null && SystemClock.elapsedRealtime() - started >= 300
        try { capture?.stop() } catch (_: Exception) { success = false }
        capture?.release()
        parent?.requestDisallowInterceptTouchEvent(false)
        if (!cancel && success && file != null) {
            awaitingTranscript = true; mic?.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            emit(action("voice", project).put("path", file.absolutePath))
        } else file?.delete()
        render()
    }
}
