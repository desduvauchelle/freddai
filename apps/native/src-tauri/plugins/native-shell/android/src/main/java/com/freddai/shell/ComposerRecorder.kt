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
    private val error: (String) -> Unit, private val meter: (Float) -> Unit = {}, private val arm: (Float) -> Unit = {},
    permissionKey: String = "freddai-composer-microphone") {
    /** The control currently driving the gesture; the dashboard binds one recorder to many project mics. */
    private var anchor: Button = button
    /** Send button that follows the thumb once the user slides up; set by the owner (composer or dashboard). */
    var sendTarget: android.view.View? = null
    var cancelTarget: android.view.View? = null
    private var beginHook: (() -> Unit)? = null
    private var held = false
    private var downAt = 0L
    private var ownsTouch = false
    private var originX = 0f
    private var originY = 0f
    private var cancelArmed = false
    private var sendArmed = false
    private var enabled = false
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
    private val permission = activity.activityResultRegistry.register(permissionKey, ActivityResultContracts.RequestPermission()) { allowed ->
        if (held && permissionGeneration == generation) {
            if (allowed) start() else { finish(true); error("Microphone access is off. Enable it in Android Settings → Freddai → Permissions.") }
        }
    }
    init { bind(button) }
    /** Installs the composer gesture on [view]; [onBegin] runs when a recording actually starts from it. */
    fun bind(view: Button, onBegin: (() -> Unit)? = null) {
        view.setOnTouchListener { _, event ->
            if (!view.isEnabled) return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    ownsTouch = !held
                    if (!ownsTouch) return@setOnTouchListener true
                    anchor = view; beginHook = onBegin
                    downAt = SystemClock.elapsedRealtime()
                    originX = event.rawX; originY = event.rawY; sendArmed = false; cancelArmed = false; begin(); prepareFollow(); view.parent?.requestDisallowInterceptTouchEvent(true) }
                MotionEvent.ACTION_MOVE -> {
                    if (!ownsTouch) return@setOnTouchListener true
                    val density = activity.resources.displayMetrics.density
                    val up = (originY - event.rawY) / density
                    val left = (originX - event.rawX) / density
                    val cancel = left >= 96 && left > kotlin.math.max(0f, up)
                    val armed = up >= 64 && !cancel
                    if ((armed && !sendArmed) || (cancel && !cancelArmed)) view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
                    sendArmed = armed; cancelArmed = cancel
                    arm(if (left > kotlin.math.max(0f, up)) -(left / 96).coerceIn(0f, 1f) else (up / 64).coerceIn(0f, 1f))
                    follow(event.rawX, event.rawY, (if (left > kotlin.math.max(0f, up)) 0f else (up / 64).coerceIn(0f, 1f)))
                    follow(event.rawX, event.rawY, if (left > kotlin.math.max(0f, up)) (left / 96).coerceIn(0f, 1f) else 0f, cancelTarget)
                }
                MotionEvent.ACTION_UP -> {
                    if (ownsTouch) {
                        val density = activity.resources.displayMetrics.density
                        val up = (originY - event.rawY) / density
                        val left = (originX - event.rawX) / density
                        val cancel = left >= 96 && left > kotlin.math.max(0f, up)
                        if (cancel) finish(true)
                        else if (SystemClock.elapsedRealtime() - downAt >= 300 || up >= 64) finish(false)
                    }
                    ownsTouch = false
                    view.parent?.requestDisallowInterceptTouchEvent(false)
                }
                MotionEvent.ACTION_CANCEL, MotionEvent.ACTION_POINTER_DOWN -> finish(true)
            }
            true
        }
        androidx.core.view.ViewCompat.replaceAccessibilityAction(view,
            androidx.core.view.accessibility.AccessibilityNodeInfoCompat.AccessibilityActionCompat.ACTION_DISMISS,
            "Cancel recording") { _, _ -> finish(true); true }
        view.setOnClickListener { if (held) finish(false) else { anchor = view; beginHook = onBegin; begin() } }
    }
    fun update(allowed: Boolean, transcribing: Boolean) {
        enabled = allowed
        if (!enabled) finish(true)
        button.visibility = if (enabled) android.view.View.VISIBLE else android.view.View.GONE
        button.isEnabled = enabled
        if (!held) status(if (transcribing) "Transcribing…" else "")
    }
    private fun begin() {
        if (held || !enabled) return
        held = true; generation++; beginHook?.invoke()
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
            capture.prepare(); capture.start(); anchor.keepScreenOn = true; started = SystemClock.elapsedRealtime()
            anchor.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
            anchor.announceForAccessibility("Recording. Activate again to finish.")
            handler.post(tick)
        } catch (_: Exception) { finish(true); error("Could not start the microphone. Check Freddai's microphone permission.") }
    }
    private fun followEnabled() = android.provider.Settings.Global.getFloat(activity.contentResolver,
        android.provider.Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0f
    /** Lets the send button travel outside its parents and draw above siblings. */
    private fun prepareFollow() {
        val target = sendTarget ?: return
        target.animate().cancel()
        if (!followEnabled()) return
        var node: android.view.View? = target
        while (node != null) {
            (node as? android.view.ViewGroup)?.let { it.clipChildren = false; it.clipToPadding = false }
            node = node.parent as? android.view.View
        }
        target.bringToFront()
        target.translationZ = 24f * activity.resources.displayMetrics.density
    }
    /** Moves the send button toward the finger by eased progress; at 1 its centre sits under the finger. */
    private fun follow(rawX: Float, rawY: Float, progress: Float, target: android.view.View? = sendTarget) {
        target ?: return
        if (!followEnabled() || target.visibility != android.view.View.VISIBLE || target.width == 0) return
        val p = progress * progress * (3 - 2 * progress)
        val loc = IntArray(2)
        target.getLocationOnScreen(loc)
        // getLocationOnScreen includes the current translation and scale-neutral centre; subtract translation for the rest centre.
        val restX = loc[0] + target.width / 2f - target.translationX
        val restY = loc[1] + target.height / 2f - target.translationY
        target.translationX = (rawX - restX) * p
        target.translationY = (rawY - restY) * p
    }
    private fun releaseFollow() {
        cancelTarget?.apply { translationX = 0f; translationY = 0f }
        val target = sendTarget ?: return
        target.animate().cancel()
        if (target.translationX == 0f && target.translationY == 0f) { target.translationZ = 0f; return }
        if (!followEnabled()) { target.translationX = 0f; target.translationY = 0f; target.translationZ = 0f; return }
        target.animate().translationX(0f).translationY(0f).setDuration(200)
            .setInterpolator(android.view.animation.OvershootInterpolator(1.2f))
            .withEndAction { target.translationZ = 0f }.start()
    }
    fun send() = finish(false)
    fun cancel() = finish(true)
    fun dispose() { cancel(); permission.unregister() }
    private fun finish(cancel: Boolean) {
        if (!held) return
        held = false; generation++; handler.removeCallbacks(tick)
        anchor.keepScreenOn = false
        val capture = recorder; recorder = null
        val destination = file; file = null
        val duration = SystemClock.elapsedRealtime() - started
        var success = capture != null && duration >= 300
        try { capture?.stop() } catch (_: Exception) { success = false }
        capture?.release(); anchor.parent?.requestDisallowInterceptTouchEvent(false)
        arm(0f)
        anchor.translationY = 0f
        releaseFollow()
        meter(0f)
        status("")
        if (!cancel && success && destination != null) {
            anchor.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)
            ready(destination.absolutePath, duration)
        } else destination?.delete()
    }
}
