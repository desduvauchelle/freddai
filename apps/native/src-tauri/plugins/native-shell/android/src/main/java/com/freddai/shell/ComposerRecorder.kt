package com.freddai.shell

import android.Manifest
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.HapticFeedbackConstants
import android.view.MotionEvent
import android.widget.Button
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import java.io.File
import java.util.UUID

/** Gesture-owned recording: permission completion cannot revive a released/cancelled hold. */
class ComposerRecorder(private val activity: AppCompatActivity, private val button: Button,
    private val status: (String) -> Unit, private val ready: (String, Long) -> Unit,
    private val error: (String) -> Unit) {
    private var held = false
    private var enabled = false
    private var busy = false
    private var generation = 0
    private var permissionGeneration = -1
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var started = 0L
    private val handler = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            if (recorder == null) return
            status("Recording ${(SystemClock.elapsedRealtime() - started) / 1000}s · release to send")
            handler.postDelayed(this, 250)
        }
    }
    private val permission = activity.activityResultRegistry.register("freddai-composer-microphone", ActivityResultContracts.RequestPermission()) { allowed ->
        if (held && permissionGeneration == generation) {
            if (allowed) start() else { finish(true); error("Microphone access is off. Enable it in Android Settings → Freddai → Permissions.") }
        }
    }
    init {
        button.setOnTouchListener { _, event ->
            if (!button.isEnabled) return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { begin(); button.parent?.requestDisallowInterceptTouchEvent(true) }
                MotionEvent.ACTION_MOVE -> {
                    val margin = 32 * activity.resources.displayMetrics.density
                    if (event.x < -margin || event.y < -margin || event.x > button.width + margin || event.y > button.height + margin) finish(true)
                }
                MotionEvent.ACTION_UP -> finish(false)
                MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> finish(true)
            }
            true
        }
        button.setOnClickListener { if (held) finish(false) else begin() }
    }
    fun update(allowed: Boolean, transcribing: Boolean) {
        enabled = allowed; busy = transcribing
        if (!enabled || busy) finish(true)
        button.visibility = if (enabled) android.view.View.VISIBLE else android.view.View.GONE
        button.isEnabled = enabled && !busy
        if (!held) status(if (busy) "Transcribing…" else "")
    }
    private fun begin() {
        if (held || !enabled || busy) return
        held = true; generation++
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
        else { permissionGeneration = generation; permission.launch(Manifest.permission.RECORD_AUDIO) }
    }
    @Suppress("DEPRECATION")
    private fun start() {
        if (!held) return
        try {
            val destination = File(File(activity.cacheDir, "freddai-attachments").apply { mkdirs() }, "${UUID.randomUUID()}.m4a")
            file = destination
            val capture = MediaRecorder(); recorder = capture
            capture.setAudioSource(MediaRecorder.AudioSource.MIC)
            capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            capture.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            capture.setAudioSamplingRate(16000); capture.setAudioChannels(1); capture.setAudioEncodingBitRate(32000)
            capture.setOutputFile(destination.absolutePath); capture.setMaxDuration(120000); capture.setMaxFileSize(9L * 1024 * 1024)
            capture.setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) finish(false) }
            capture.setOnErrorListener { _, _, _ -> finish(true); error("Microphone recording was interrupted. Hold to try again.") }
            capture.prepare(); capture.start(); started = SystemClock.elapsedRealtime()
            button.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            button.announceForAccessibility("Recording. Activate again to finish.")
            handler.post(tick)
        } catch (_: Exception) { finish(true); error("Could not start the microphone. Check Freddai's microphone permission.") }
    }
    fun cancel() = finish(true)
    fun dispose() { cancel(); permission.unregister() }
    private fun finish(cancel: Boolean) {
        if (!held) return
        held = false; generation++; handler.removeCallbacks(tick)
        val capture = recorder; recorder = null
        val destination = file; file = null
        val duration = SystemClock.elapsedRealtime() - started
        var success = capture != null && duration >= 300
        try { capture?.stop() } catch (_: Exception) { success = false }
        capture?.release(); button.parent?.requestDisallowInterceptTouchEvent(false)
        status("")
        if (!cancel && success && destination != null) {
            button.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            ready(destination.absolutePath, duration)
        } else destination?.delete()
    }
}
