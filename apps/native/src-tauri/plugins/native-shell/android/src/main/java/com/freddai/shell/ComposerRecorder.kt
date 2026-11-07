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
    private val error: (String) -> Unit, private val meter: (Float) -> Unit = {}, private val arm: (Float) -> Unit = {}) {
    private var held = false
    private var downAt = 0L
    private var ownsTouch = false
    private var originX = 0f
    private var originY = 0f
    private var sendArmed = false
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
            val seconds = (SystemClock.elapsedRealtime() - started) / 1000
            status("%d:%02d".format(seconds / 60, seconds % 60))
            meter((recorder?.maxAmplitude?.toFloat() ?: 0f) / 32767f)
            handler.postDelayed(this, 80)
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
                MotionEvent.ACTION_DOWN -> {
                    ownsTouch = !held
                    if (!ownsTouch) return@setOnTouchListener true
                    downAt = SystemClock.elapsedRealtime()
                    originX = event.rawX; originY = event.rawY; sendArmed = false; begin(); button.parent?.requestDisallowInterceptTouchEvent(true) }
                MotionEvent.ACTION_MOVE -> {
                    if (!ownsTouch) return@setOnTouchListener true
                    val density = activity.resources.displayMetrics.density
                    val armed = originY - event.rawY >= 64 * density && kotlin.math.abs(originX - event.rawX) <= 96 * density
                    if (armed && !sendArmed) button.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    sendArmed = armed
                    arm(if (kotlin.math.abs(originX - event.rawX) <= 96 * density) ((originY - event.rawY) / (64 * density)).coerceIn(0f, 1f) else 0f)
                }
                MotionEvent.ACTION_UP -> {
                    if (ownsTouch && (SystemClock.elapsedRealtime() - downAt >= 300 || sendArmed)) finish(false)
                    ownsTouch = false
                    button.parent?.requestDisallowInterceptTouchEvent(false)
                }
                MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> finish(true)
            }
            true
        }
        androidx.core.view.ViewCompat.replaceAccessibilityAction(button,
            androidx.core.view.accessibility.AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_DISMISS,
            "Cancel recording") { _, _ -> finish(true); true }
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
            capture.setOutputFile(destination.absolutePath); capture.setMaxDuration(600000); capture.setMaxFileSize(9L * 1024 * 1024)
            capture.setOnInfoListener { _, what, _ -> if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) finish(false) }
            capture.setOnErrorListener { _, _, _ -> finish(true); error("Microphone recording was interrupted. Hold to try again.") }
            capture.prepare(); capture.start(); button.keepScreenOn = true; started = SystemClock.elapsedRealtime()
            button.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            button.announceForAccessibility("Recording. Activate again to finish.")
            handler.post(tick)
        } catch (_: Exception) { finish(true); error("Could not start the microphone. Check Freddai's microphone permission.") }
    }
    fun send() = finish(false)
    fun cancel() = finish(true)
    fun dispose() { cancel(); permission.unregister() }
    private fun finish(cancel: Boolean) {
        if (!held) return
        held = false; generation++; handler.removeCallbacks(tick)
        button.keepScreenOn = false
        val capture = recorder; recorder = null
        val destination = file; file = null
        val duration = SystemClock.elapsedRealtime() - started
        var success = capture != null && duration >= 300
        try { capture?.stop() } catch (_: Exception) { success = false }
        capture?.release(); button.parent?.requestDisallowInterceptTouchEvent(false)
        arm(0f)
        button.translationY = 0f
        meter(0f)
        status("")
        if (!cancel && success && destination != null) {
            button.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            ready(destination.absolutePath, duration)
        } else destination?.delete()
    }
}
