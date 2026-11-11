package com.freddai.shell

import android.app.Activity
import android.view.View
import android.view.ViewGroup
import android.view.Gravity
import android.view.WindowManager
import android.webkit.WebView
import android.widget.*
import android.text.Editable
import android.text.TextWatcher
import android.text.InputType
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.drawerlayout.widget.DrawerLayout
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.JSObject
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

@TauriPlugin
class NativeShellPlugin(private var host: Activity) : Plugin(host) {
    private lateinit var dashboard: DashboardView
    private lateinit var contentWebView: WebView
    private lateinit var contentRoot: LinearLayout
    private var dashboardModel = JSONObject()
    private var voiceEnabled = false
    private var voiceBusy = false
    private var composerRecorder: ComposerRecorder? = null
    private lateinit var voiceStatus: RecordingStatusView
    private lateinit var mainPanel: LinearLayout
    private lateinit var drawerSurface: FrameLayout
    private lateinit var sidebarView: LinearLayout
    private var persistentSidebar = false
    private var cameraPicker: androidx.activity.result.ActivityResultLauncher<android.net.Uri>? = null
    private var cameraFile: File? = null
    private lateinit var drawer: DrawerLayout
    private lateinit var navigation: LinearLayout
    private lateinit var composer: LinearLayout
    private lateinit var modelButton: ImageButton
    private lateinit var accessButton: ImageButton
    private lateinit var editor: EditText
    private lateinit var subtitle: TextView
    private lateinit var title: TextView
    private lateinit var connection: Button
    private lateinit var list: LinearLayout
    private lateinit var search: EditText
    private lateinit var viewFilter: Button
    private lateinit var chips: LinearLayout
    private val collapsedProjects = mutableSetOf<String>()
    private var model = JSONObject()
    private var meta = JSONObject()
    private var threadSheet: com.google.android.material.bottomsheet.BottomSheetDialog? = null
    private var sheetParent: ViewGroup? = null
    private var sheetIndex = 0
    private var sheetParams: ViewGroup.LayoutParams? = null
    private var sheetBackdrop: View? = null
    private var sheetDestinationReady = false
    private var backNav = false
    private lateinit var menuButton: Button

    private fun openThreadSheet() {
        if (threadSheet != null) return
        val parent = drawer.parent as? ViewGroup ?: return
        sheetDestinationReady = false
        sheetParent = parent; sheetIndex = parent.indexOfChild(drawer); sheetParams = drawer.layoutParams
        val bitmap = android.graphics.Bitmap.createBitmap(drawer.width.coerceAtLeast(1), drawer.height.coerceAtLeast(1), android.graphics.Bitmap.Config.ARGB_8888)
        drawer.draw(android.graphics.Canvas(bitmap))
        val backdrop = ImageView(host).apply { setImageBitmap(bitmap); scaleType = ImageView.ScaleType.FIT_XY }
        parent.addView(backdrop, sheetIndex, sheetParams); sheetBackdrop = backdrop
        parent.removeView(drawer)
        // System back never dismisses the sheet natively: JS decides (list <-> conversation <-> close) and drives the next set_mode.
        val dialog = object : com.google.android.material.bottomsheet.BottomSheetDialog(host) {
            @Deprecated("Routed to JS") override fun onBackPressed() { event("navBack") }
        }
        dialog.onBackPressedDispatcher.addCallback(object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() { event("navBack") }
        })
        threadSheet = dialog
        dialog.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        dialog.setContentView(drawer)
        dialog.behavior.apply {
            skipCollapsed = true
            isFitToContents = false
            expandedOffset = (parent.height * 0.1f).toInt()
            state = com.google.android.material.bottomsheet.BottomSheetBehavior.STATE_EXPANDED
        }
        var cancelledByUser = false
        dialog.setOnCancelListener { cancelledByUser = true }
        dialog.setOnDismissListener {
            (drawer.parent as? ViewGroup)?.removeView(drawer)
            parent.addView(drawer, sheetIndex.coerceAtMost(parent.childCount), sheetParams)
            sheetBackdrop?.bringToFront()
            threadSheet = null; sheetParent = null
            if (cancelledByUser) event("navBack")
            revealSheetDestination()
        }
        dialog.show()
        dialog.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)?.layoutParams?.height = ViewGroup.LayoutParams.MATCH_PARENT
    }

    private fun revealSheetDestination() {
        if (threadSheet != null || !sheetDestinationReady) return
        val backdrop = sheetBackdrop ?: return
        contentWebView.postVisualStateCallback(0, object : WebView.VisualStateCallback() {
            override fun onComplete(requestId: Long) {
                if (threadSheet == null && sheetBackdrop === backdrop) {
                    (backdrop.parent as? ViewGroup)?.removeView(backdrop)
                    sheetBackdrop = null
                }
            }
        })
    }

    private var mode = "other"
    @Volatile private var installed = false
    private var installAttempts = 0
    private var updatingSearch = false
    private val files = mutableListOf<JSONObject>()
    private val attachments get() = File(host.cacheDir, "freddai-attachments").apply { mkdirs() }
    private val store by lazy { CredentialStore(host.applicationContext) }
    private var back: OnBackPressedCallback? = null
    private var filePicker: androidx.activity.result.ActivityResultLauncher<Array<String>>? = null
    private fun picker(): androidx.activity.result.ActivityResultLauncher<Array<String>> {
        filePicker?.let { return it }
        return (host as AppCompatActivity).activityResultRegistry.register("freddai-attachments", ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            // Content providers may read from the network: never copy on the UI thread.
            Thread {
                val added = mutableListOf<JSONObject>()
                var failed = false
                for (uri in uris) {
                    var target: File? = null
                    try {
                        var name = "Attachment"
                        host.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                            if (it.moveToFirst()) name = it.getString(0) ?: name
                        }
                        val destination = File(attachments, UUID.randomUUID().toString())
                        target = destination
                        var count = 0L
                        host.contentResolver.openInputStream(uri)!!.use { input -> destination.outputStream().use { output ->
                            val buffer = ByteArray(8192)
                            while (true) {
                                val n = input.read(buffer); if (n < 0) break
                                count += n; require(count <= 25L * 1024 * 1024)
                                output.write(buffer, 0, n)
                            }
                        } }
                        added.add(JSONObject().put("path", destination.absolutePath).put("name", name)
                            .put("mime", host.contentResolver.getType(uri) ?: "application/octet-stream").put("bytes", count))
                    } catch (_: Exception) { target?.delete(); failed = true }
                }
                host.runOnUiThread {
                    for (file in added) {
                        if (files.size >= 20 || files.sumOf { it.optLong("bytes") } + file.optLong("bytes") > 100L * 1024 * 1024) {
                            discard(file.getString("path")); failed = true
                        } else files.add(file)
                    }
                    renderChips()
                    if (failed) AlertDialog.Builder(host).setMessage("Some files could not be attached. Use up to 20 files, 25 MB each and 100 MB per message.").setPositiveButton("OK", null).show()
                }
            }.start()
        }.also { filePicker = it }
    }
    // Tauri retains plugin instances when Android recreates its Activity. Bind the new
    // content root and replace the shell's views while retaining the draft and models.
    private var watchedRoot: ViewGroup? = null
    private val rootListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ ->
        watchedRoot?.post { ensureShell() }
    }
    override fun onResume(activity: AppCompatActivity) {
        if (host !== activity) {
            if (::dashboard.isInitialized) dashboard.dispose()
            composerRecorder?.dispose(); composerRecorder = null
            cameraPicker?.unregister(); cameraPicker = null
            host = activity
            filePicker?.unregister(); filePicker = null
            back?.remove(); back = null
            installed = false
        }
        val root = activity.findViewById<ViewGroup>(android.R.id.content)
        if (root !== watchedRoot) {
            watchedRoot?.removeOnLayoutChangeListener(rootListener)
            watchedRoot = root
            root.addOnLayoutChangeListener(rootListener)
        }
        root.post { ensureShell() }
    }
    override fun onPause(activity: AppCompatActivity) {
        if (::dashboard.isInitialized) dashboard.cancelRecording()
        composerRecorder?.cancel()
    }
    private fun ensureShell() {
        if (installed && drawer.isAttachedToWindow) return
        fun find(view: View): WebView? {
            if (view is WebView) return view
            if (view is ViewGroup) for (i in 0 until view.childCount) find(view.getChildAt(i))?.let { return it }
            return null
        }
        watchedRoot?.let { find(it) }?.let { load(it) }
    }
    private fun dp(value: Int) = (value * host.resources.displayMetrics.density).toInt()
    private fun column() = LinearLayout(host).apply { orientation = LinearLayout.VERTICAL }
    private fun button(label: String, action: () -> Unit) = Button(host, null, android.R.attr.borderlessButtonStyle).apply {
        text = label; contentDescription = label; isAllCaps = false; minWidth = dp(48); minimumWidth = dp(48); minimumHeight = dp(48)
        setOnClickListener { action() }
    }
    private fun event(name: String, data: JSONObject = JSONObject()) = trigger(name, JSObject(data.toString()))
    private fun ui(invoke: Invoke, action: () -> Unit) = host.runOnUiThread {
        try { action(); invoke.resolve() } catch (_: Exception) { invoke.reject("Native shell operation failed") }
    }
    override fun load(webView: WebView) {
        host.runOnUiThread {
            if (installed && drawer.isAttachedToWindow) return@runOnUiThread
            val parent = webView.parent as? ViewGroup
            if (parent == null) {
                if (++installAttempts < 50) webView.postDelayed({ load(webView) }, 100)
                return@runOnUiThread
            }
            val draft = if (::editor.isInitialized) editor.text.toString() else ""
            val oldHint = if (::editor.isInitialized) editor.hint else "Message"
            val oldTitle = if (::title.isInitialized) title.text else "Freddai"
            back?.remove()
            val index = parent.indexOfChild(webView)
            val params = webView.layoutParams
            parent.removeView(webView)
            drawer = DrawerLayout(host)
            val content = column(); contentRoot = content
            mainPanel = LinearLayout(host)
            persistentSidebar = false
            // Reparent only after DrawerLayout finishes iterating its children.
            content.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> content.post {
                if (contentRoot === content) { resizeDashboardWeb(); updateSidebar() }
            } }
            navigation = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL }
            menuButton = button("Threads") {
                composerRecorder?.cancel(); if (::dashboard.isInitialized) dashboard.cancelRecording()
                if (backNav) { event("navBack"); return@button }
                if (persistentSidebar) sidebarView.visibility = if (sidebarView.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                else drawer.openDrawer(Gravity.START)
            }.apply { text = "☰"; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) }
            navigation.addView(menuButton)
            title = TextView(host).apply { textSize = 16f; maxLines = 2; text = oldTitle }
            val heading = column()
            heading.addView(title)
            subtitle = TextView(host).apply { textSize = 12f; maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
            heading.addView(subtitle)
            navigation.addView(heading, LinearLayout.LayoutParams(0, -2, 1f))
            connection = button("Mac") { event("connectionTap") }
            navigation.addView(connection)
            navigation.addView(button("Start call") { event("threadAction", JSONObject().put("action", "call")) }.apply { tag = "start-call"; text = "☎"; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) })
            navigation.addView(button("More") { showActions() }.apply { text = "⋮"; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) })
            content.addView(navigation)
            contentWebView = webView
            content.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
            if (::dashboard.isInitialized) dashboard.dispose()
            dashboard = DashboardView(host as AppCompatActivity, { event("dashboardAction", it) }, { event("voiceError", JSONObject().put("message", it)) })
            dashboard.apply(dashboardModel); dashboard.setVoice(voiceEnabled)
            content.addView(dashboard, LinearLayout.LayoutParams(-1, 0, 0.62f))
            composer = column()
            chips = LinearLayout(host)
            composer.addView(HorizontalScrollView(host).apply { addView(chips) })
            val row = LinearLayout(host).apply { gravity = Gravity.BOTTOM }
            row.addView(button("Attach") { showAttachments() }.apply { text = "+"; textSize = 24f; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) })
            editor = EditText(host).apply {
                hint = oldHint; setText(draft); minLines = 1; maxLines = 6
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            }
            composer.addView(editor, LinearLayout.LayoutParams(-1, -2))
            row.addView(button("Send") { sendComposer() }.apply { primaryAction() })
            voiceStatus = RecordingStatusView(host).apply { textSize = 13f; gravity = Gravity.BOTTOM or Gravity.RIGHT; setPadding(0, 0, dp(56), dp(14)); visibility = View.GONE }
            val transcriptionStatus = TextView(host).apply {
                textSize = 14f; text = "Transcribing…"; visibility = View.GONE
                gravity = Gravity.CENTER_VERTICAL or Gravity.LEFT
                typeface = android.graphics.Typeface.MONOSPACE
                val dark = resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES
                setTextColor(if (dark) android.graphics.Color.rgb(87, 214, 140) else android.graphics.Color.rgb(20, 122, 69))
                setPadding(dp(20), 0, dp(48), 0)
                background = android.graphics.drawable.GradientDrawable().apply {
                    cornerRadius = dp(22).toFloat(); setColor(if (dark) android.graphics.Color.rgb(49, 50, 57) else android.graphics.Color.rgb(250, 250, 252))
                }
                contentDescription = "Transcribing"
            }
            composer.clipChildren = false
            composer.clipToPadding = false
            content.clipChildren = false
            val microphone = button("Dictate") {}.apply { primaryAction(); text = ""; setCompoundDrawablesWithIntrinsicBounds(android.R.drawable.ic_btn_speak_now, 0, 0, 0); contentDescription = "Dictate message. Hold and release to send. Tap to record until Send or Cancel." }
            composerRecorder?.dispose()
            val recordingRow = FrameLayout(host).apply { clipChildren = false; clipToPadding = false }
            val recordingCancel = button("Cancel recording") { composerRecorder?.cancel() }.apply { text = "×"; visibility = View.GONE }
            val recordingSend = button("Send recording") { composerRecorder?.send() }.apply { primaryAction(); text = "↑"; visibility = View.GONE }
            val cancelColors = recordingCancel.textColors
            composerRecorder = ComposerRecorder(host as AppCompatActivity, microphone, { status ->
                voiceStatus.showWaveform = status.isNotEmpty() && status != "Transcribing…"
                recordingCancel.visibility = if (voiceStatus.showWaveform) View.VISIBLE else View.GONE
                recordingSend.visibility = recordingCancel.visibility
                recordingRow.layoutParams = LinearLayout.LayoutParams(-1, dp(if (voiceStatus.showWaveform) 112 else 48))
                voiceStatus.text = status; voiceStatus.invalidate(); voiceStatus.visibility = if (voiceStatus.showWaveform) View.VISIBLE else View.GONE
                val transcribing = status == "Transcribing…"
                val wasTranscribing = transcriptionStatus.visibility == View.VISIBLE
                transcriptionStatus.animate().cancel()
                if (transcribing) {
                    transcriptionStatus.alpha = 1f; transcriptionStatus.translationY = 0f
                    transcriptionStatus.visibility = View.VISIBLE
                } else if (wasTranscribing && status.isEmpty()) {
                    val motion = android.os.Build.VERSION.SDK_INT < 26 || android.animation.ValueAnimator.areAnimatorsEnabled()
                    transcriptionStatus.animate().alpha(0f).translationY(if (motion) -dp(22).toFloat() else 0f).setDuration(if (motion) 250L else 0L).withEndAction {
                        transcriptionStatus.visibility = View.GONE
                        transcriptionStatus.translationY = 0f
                    }.start()
                } else transcriptionStatus.visibility = View.GONE
            }, { path, duration ->
                val capturedText = editor.text.toString()
                val capturedFiles = JSONArray(files)
                editor.setText(""); files.clear(); renderChips()
                event("voiceRecorded", JSONObject().put("path", path).put("durationMs", duration).put("text", capturedText).put("files", capturedFiles))
            }, { message ->
                event("voiceError", JSONObject().put("message", message))
            }, { level -> voiceStatus.level = level; voiceStatus.invalidate() }, { progress ->
                val sendAmount = progress.coerceIn(0f, 1f)
                val cancelAmount = (-progress).coerceIn(0f, 1f)
                recordingSend.scaleX = 1 + sendAmount; recordingSend.scaleY = 1 + sendAmount
                recordingCancel.scaleX = 1 + 0.5f * cancelAmount; recordingCancel.scaleY = 1 + 0.5f * cancelAmount
                recordingCancel.setTextColor(androidx.core.graphics.ColorUtils.blendARGB(cancelColors.defaultColor, android.graphics.Color.RED, cancelAmount))
                voiceStatus.sendProgress = sendAmount; voiceStatus.invalidate()
            })
            composerRecorder?.sendTarget = recordingSend
            composerRecorder?.update(voiceEnabled, voiceBusy)
            row.addView(microphone, LinearLayout.LayoutParams(dp(48), dp(48)))
            fun setting(label: String, icon: Int, action: String) = ImageButton(host).apply {
                contentDescription = label; setImageResource(icon)
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
                setOnClickListener { event("threadAction", JSONObject().put("action", action)) }
            }
            modelButton = setting("Model", android.R.drawable.ic_menu_manage, "model")
            accessButton = setting("Permissions", android.R.drawable.ic_lock_lock, "permissions")
            row.addView(modelButton, 1); row.addView(accessButton, 2)
            row.addView(Space(host), 3, LinearLayout.LayoutParams(0, 1, 1f))
            recordingRow.addView(row, FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM))
            recordingRow.addView(voiceStatus, FrameLayout.LayoutParams(-1, dp(128), Gravity.BOTTOM))
            recordingRow.addView(recordingCancel, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.RIGHT).apply { rightMargin = dp(180); bottomMargin = dp(2) })
            recordingRow.addView(recordingSend, FrameLayout.LayoutParams(dp(44), dp(44), Gravity.BOTTOM or Gravity.RIGHT).apply { rightMargin = dp(2); bottomMargin = dp(66) })
            composer.addView(recordingRow, LinearLayout.LayoutParams(-1, dp(48)))
            recordingRow.addView(transcriptionStatus, 0, FrameLayout.LayoutParams(dp(224), dp(44), Gravity.BOTTOM or Gravity.RIGHT).apply { bottomMargin = dp(2) })
            content.addView(composer)
            renderSettings()
            mainPanel.addView(content, LinearLayout.LayoutParams(0, -1, 1f))
            drawer.addView(mainPanel, DrawerLayout.LayoutParams(-1, -1))
            val sidebar = column().apply { val color = android.util.TypedValue()
                host.theme.resolveAttribute(android.R.attr.colorBackground, color, true)
                setBackgroundColor(color.data) }
            sidebarView = sidebar
            search = EditText(host).apply { hint = "Search threads"; setSingleLine(true) }
            search.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (!updatingSearch) event("search", JSONObject().put("query", s.toString()))
                }
                override fun afterTextChanged(s: Editable?) {}
            })
            val navigation = LinearLayout(host)
            navigation.addView(button("Settings") { closeDrawer(); event("threadAction", JSONObject().put("action", "organization")) }, LinearLayout.LayoutParams(0, dp(48), 1f))
            navigation.addView(button("Dashboard") { event("dashboard"); closeDrawer() }, LinearLayout.LayoutParams(0, dp(48), 1f))
            sidebar.addView(navigation)
            sidebar.addView(search)
            val filters = LinearLayout(host)
            viewFilter = button("Projects") {
                AlertDialog.Builder(host).setTitle("Thread view")
                    .setSingleChoiceItems(arrayOf("Projects", "Recent"), if (currentView() == "recent") 1 else 0) { dialog, index ->
                        setView(if (index == 1) "recent" else "projects"); dialog.dismiss()
                    }.show()
            }
            filters.addView(viewFilter)
            filters.addView(button("Workspace") { filter("workspaceOptions", "workspace") })
            filters.addView(button("Project") { filter("projectOptions", "project") })
            filters.addView(button("Status") { filter("statusOptions", "status") })
            sidebar.addView(filters)
            sidebar.addView(button("＋ Project") { composerRecorder?.cancel(); event("newThread", JSONObject().put("project", "freddai:add-project")); closeDrawer() })
            sidebar.addView(button("New thread") { composerRecorder?.cancel(); event("newThread", JSONObject().put("project", "")); closeDrawer() })
            list = column(); sidebar.addView(ScrollView(host).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))
            // Keep the direct drawer child stable: ViewDragHelper retains it while settling.
            drawerSurface = FrameLayout(host).apply { addView(sidebar, FrameLayout.LayoutParams(-1, -1)) }
            drawer.addView(drawerSurface, DrawerLayout.LayoutParams(dp(320), -1, Gravity.START))
            parent.addView(drawer, index, params)
            ViewCompat.setOnApplyWindowInsetsListener(drawer) { _, insets ->
                val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
                val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
                content.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
                sidebar.setPadding(bars.left, bars.top, 0, maxOf(bars.bottom, keyboard.bottom))
                WindowInsetsCompat.CONSUMED
            }
            ViewCompat.requestApplyInsets(drawer)
            host.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            back = object : OnBackPressedCallback(false) {
                override fun handleOnBackPressed() { if (drawer.isDrawerOpen(Gravity.START)) closeDrawer() else if (mode == "new") host.moveTaskToBack(true) else event("navBack") }
            }.also { callback -> val activity = host as AppCompatActivity; activity.onBackPressedDispatcher.addCallback(activity, callback) }
            registerCamera()
            picker() // Register before the first attachment request.
            renderThreads(); renderChips()
            applyMode(); installed = true
        }
    }
    private fun closeDrawer() {
        (host.getSystemService(Activity.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
            .hideSoftInputFromWindow(search.windowToken, 0)
        if (!persistentSidebar) drawer.closeDrawer(Gravity.START)
    }
    private fun resizeDashboardWeb() {
        if (!::contentWebView.isInitialized || !::dashboard.isInitialized) return
        val embedded = mode == "dashboard" && !dashboardModel.optBoolean("expanded")
        val target: ViewGroup = if (embedded) dashboard.workspace else contentRoot
        if (contentWebView.parent !== target) {
            (contentWebView.parent as? ViewGroup)?.removeView(contentWebView)
            if (embedded) target.addView(contentWebView, FrameLayout.LayoutParams(-1, -1))
            else contentRoot.addView(contentWebView, 1, LinearLayout.LayoutParams(-1, 0, 1f))
        }
        if (embedded && contentWebView.layoutParams.height != -1) contentWebView.layoutParams = FrameLayout.LayoutParams(-1, -1)
    }
    private fun updateSidebar() {
        if (!::sidebarView.isInitialized || !drawer.isAttachedToWindow) return
        val density = host.resources.displayMetrics.density
        val wide = mode != "other" && host.resources.configuration.smallestScreenWidthDp >= 600 && drawer.width / density >= 900 && drawer.width > drawer.height
        if (wide == persistentSidebar) return
        drawer.closeDrawer(Gravity.START, false)
        (sidebarView.parent as? ViewGroup)?.removeView(sidebarView)
        persistentSidebar = wide
        sidebarView.visibility = View.VISIBLE
        if (wide) mainPanel.addView(sidebarView, 0, LinearLayout.LayoutParams(dp(320), -1))
        else drawerSurface.addView(sidebarView, FrameLayout.LayoutParams(-1, -1))
        drawer.setDrawerLockMode(if (wide || mode == "other") DrawerLayout.LOCK_MODE_LOCKED_CLOSED else DrawerLayout.LOCK_MODE_UNLOCKED)
    }
    private fun applyMode() {
        val visible = mode != "other"
        if (mode != "conversation" && mode != "new") composerRecorder?.cancel()
        if (mode != "dashboard" || dashboardModel.optBoolean("expanded")) dashboard.cancelRecording()
        dashboard.visibility = if (mode == "dashboard" && !dashboardModel.optBoolean("expanded")) View.VISIBLE else View.GONE
        resizeDashboardWeb()
        navigation.findViewWithTag<View>("start-call")?.visibility = if (mode == "conversation" || mode == "new" || mode == "dashboard") View.VISIBLE else View.GONE
        navigation.visibility = if (visible) View.VISIBLE else View.GONE
        composer.visibility = if (mode == "conversation" || mode == "new") View.VISIBLE else View.GONE
        if (::menuButton.isInitialized) {
            menuButton.visibility = if (mode == "project") View.GONE else View.VISIBLE
            menuButton.text = if (backNav) "←" else "☰"
            menuButton.contentDescription = if (backNav) "Back" else "Threads"
        }
        drawer.setDrawerLockMode(if (visible && !persistentSidebar && mode != "project" && !backNav) DrawerLayout.LOCK_MODE_UNLOCKED else DrawerLayout.LOCK_MODE_LOCKED_CLOSED)
        back?.isEnabled = visible
        updateSidebar()
    }
    @Command fun ping(invoke: Invoke) { host.runOnUiThread { ensureShell(); invoke.resolve(JSObject().put("installed", installed && drawer.isAttachedToWindow).put("nativeDashboardContent", true).put("threadSheet", true).put("newThreadSheet", true).put("projectSheet", true)) } }
    @Command fun setMode(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs()
        if (args.optString("mode", "other") !in listOf("new", "conversation", "commander")) composerRecorder?.cancel()
        // Commander is a conversation with its own web header; Android has no transparent-bar variant, so it uses the plain conversation chrome.
        val nextMode = args.optString("mode", "other")
        val wantsSheet = args.optBoolean("threadSheet") && nextMode in listOf("new", "conversation", "commander", "project")
        if (wantsSheet) openThreadSheet()
        backNav = args.optBoolean("back", false)
        mode = args.optString("mode", "other").let { if (it == "commander") "conversation" else it }
        title.text = args.optString("title", "Freddai"); editor.hint = args.optString("placeholder", "Message")
        applyMode()
        if (!wantsSheet) {
            sheetDestinationReady = true
            threadSheet?.dismiss()
            revealSheetDestination()
        }
        if (mode != "other" && mode != "project" && args.optBoolean("openDrawer")) {
            if (persistentSidebar) sidebarView.visibility = View.VISIBLE else drawer.openDrawer(Gravity.START)
        }
    }
    @Command fun setConnection(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs(); val state = args.optString("state")
        connection.text = when (state) { "ok" -> "Mac ●"; "down" -> "Mac ○"; else -> "Mac …" }
        connection.contentDescription = if (args.isNull("message")) "Mac connection: $state" else args.getString("message")
    }
    private fun renderSettings() {
        if (!::modelButton.isInitialized) return
        val state = when (meta.optString("runState")) { "running" -> "Running"; "waiting" -> "Needs you"; "failed" -> "Failed"; else -> "" }
        subtitle.text = listOf(state, meta.optString("project")).filter { it.isNotBlank() }.joinToString(" · ")
        subtitle.visibility = if (subtitle.text.isEmpty()) View.GONE else View.VISIBLE
        for ((button, key) in listOf(modelButton to "model", accessButton to "access")) {
            button.visibility = if (meta.isNull(key) || !meta.has(key)) View.GONE else View.VISIBLE
            button.isEnabled = !meta.optBoolean("controlsDisabled", false)
            button.contentDescription = (if (key == "model") "Model: " else "Permissions: ") + meta.optString(key)
        }
    }
    @Command fun setDashboard(invoke: Invoke) = ui(invoke) {
        dashboardModel = invoke.getArgs().getJSONObject("model"); dashboard.apply(dashboardModel); applyMode()
    }
    @Command fun setThreadMeta(invoke: Invoke) = ui(invoke) { meta = invoke.getArgs().getJSONObject("meta"); renderSettings() }
    @Command fun setThreads(invoke: Invoke) = ui(invoke) {
        model = invoke.getArgs().getJSONObject("model")
        val query = model.optJSONObject("filters")?.optString("query") ?: ""
        if (search.text.toString() != query) { updatingSearch = true; search.setText(query); updatingSearch = false }
        renderThreads()
    }
    private var pendingView: String? = null
    private fun currentView() = pendingView ?: model.optString("view", "projects")
    private fun renderViewToggle() {
        viewFilter.text = if (currentView() == "recent") "Recent" else "Projects"
        viewFilter.contentDescription = "Thread view: ${viewFilter.text}"
    }
    private fun setView(view: String) {
        if (currentView() == view) return
        pendingView = view; renderViewToggle(); renderThreads(); event("setView", JSONObject().put("view", view))
    }
    private fun renderRecent(key: String = "recent", bottom: Boolean = false) {
        val recent = model.optJSONObject(key) ?: JSONObject()
        val threads = recent.optJSONArray("threads") ?: JSONArray()
        val page = { action: String -> event("recentPage", JSONObject().put("action", action).apply { if (bottom) put("section", "bottom") }) }
        if (bottom) {
            if (threads.length() == 0) return
            list.addView(TextView(host).apply {
                text = "Recent"; textSize = 18f; setTypeface(typeface, android.graphics.Typeface.BOLD)
                alpha = 0.7f; setPadding(dp(12), dp(24), dp(12), dp(4)); isFocusable = true
                accessibilityDelegate = object : View.AccessibilityDelegate() {
                    override fun onInitializeAccessibilityNodeInfo(host: View, info: android.view.accessibility.AccessibilityNodeInfo) { super.onInitializeAccessibilityNodeInfo(host, info); info.isHeading = true }
                }
            })
        } else if (threads.length() == 0) {
            list.addView(TextView(host).apply { text = "No recent threads"; gravity = Gravity.CENTER; setPadding(dp(12), dp(24), dp(12), dp(24)) })
        }
        for (i in 0 until threads.length()) { val thread = threads.getJSONObject(i); addThreadRow(thread, thread.optString("projectLabel")) }
        if (recent.optInt("remaining") > 0) list.addView(button("Show more") { page("more") })
        if (recent.optBoolean("expanded")) list.addView(button("Show less") { page("less") })
    }
    private fun addThreadRow(thread: JSONObject, tag: String? = null) {
        val id = thread.getString("id")
                val status = thread.optString("status")
        val spoken = threadStatusLabel(status, thread.optBoolean("unread"))
        val row = LinearLayout(host).apply {
            gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(48); isClickable = true; isFocusable = true
            contentDescription = listOf(if (thread.optBoolean("pinned")) "Pinned" else "", thread.getString("title"), tag ?: "", spoken, if (thread.optBoolean("scheduled")) "Scheduled task" else "").filter { it.isNotEmpty() }.joinToString(", ")
            alpha = if (thread.optBoolean("faded")) 0.65f else 1f
            isSelected = id == model.optString("selectedId")
            val highlight = android.util.TypedValue(); host.theme.resolveAttribute(if (isSelected) android.R.attr.colorControlHighlight else android.R.attr.selectableItemBackground, highlight, true)
            if (isSelected) setBackgroundColor(highlight.data) else setBackgroundResource(highlight.resourceId)
            setOnClickListener { composerRecorder?.cancel(); event("selectThread", JSONObject().put("id", id)); closeDrawer() }
        }
        val dot = threadStatusIndicator(host, status, thread.optBoolean("unread"))
        row.addView(dot, LinearLayout.LayoutParams(dp(20), dp(48)))
        val titles = column().apply { importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO }
        titles.addView(TextView(host).apply {
            text = (if (thread.optBoolean("pinned")) "📌 " else "") + thread.getString("title"); textSize = 16f; setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END
            if (thread.optBoolean("unread")) setTypeface(typeface, android.graphics.Typeface.BOLD)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        if (!tag.isNullOrEmpty()) titles.addView(TextView(host).apply {
            text = tag; textSize = 12f; setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END
            runCatching { android.graphics.Color.parseColor(thread.optString("projectColor")) }.getOrNull()?.let { setTextColor(it) }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
        row.addView(titles, LinearLayout.LayoutParams(0, -2, 1f))
        if (thread.optBoolean("scheduled")) row.addView(android.widget.ImageView(host).apply {
            setImageResource(android.R.drawable.ic_menu_recent_history)
            imageTintList = android.content.res.ColorStateList.valueOf(0xff8e8e93.toInt())
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginStart = dp(8); marginEnd = dp(8) })
        list.addView(row, LinearLayout.LayoutParams(-1, -2))
    }
    private fun renderThreads() {
        list.removeAllViews()
        if (pendingView != null && pendingView == model.optString("view", "projects")) pendingView = null
        renderViewToggle()
        if (currentView() == "recent") { renderRecent() } else {
            renderGroups()
            renderRecent("recentSection", bottom = true)
        }
        renderProductUsage()
    }
    private fun renderProductUsage() {
        val usage = model.optJSONArray("productUsage") ?: JSONArray()
        if (usage.length() == 0) return
        val dark = (host.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        val surface = if (dark) 0xC018181C.toInt() else 0xC0F5F5F7.toInt()
        val footer = LinearLayout(host).apply {
            orientation = LinearLayout.VERTICAL
            background = android.graphics.drawable.GradientDrawable(
                android.graphics.drawable.GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(android.graphics.Color.TRANSPARENT, surface)
            )
        }
        list.addView(footer)
        val heading = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(12), 0, dp(12), 0) }
        heading.addView(TextView(host).apply { text = "Usage"; textSize = 12f }, LinearLayout.LayoutParams(0, -2, 1f))
        heading.addView(button("Details ›") {
            val details = (0 until usage.length()).joinToString("\n\n────────\n\n") { usage.getJSONObject(it).optString("details") }
            AlertDialog.Builder(host).setTitle("Product usage").setMessage(details).setPositiveButton("Done", null).show()
        }.apply { textSize = 12f; minHeight = dp(28); minimumHeight = dp(28); setPadding(dp(8), 0, dp(8), 0) })
        footer.addView(heading)
        val secondary = if (dark) android.graphics.Color.rgb(185, 185, 193) else android.graphics.Color.rgb(88, 88, 96)
        for (i in 0 until usage.length() step 2) {
            val row = LinearLayout(host).apply { setPadding(dp(12), 0, dp(12), dp(4)) }
            for (j in i until minOf(i + 2, usage.length())) {
                val product = usage.getJSONObject(j)
                val card = LinearLayout(host).apply {
                    orientation = LinearLayout.VERTICAL
                    contentDescription = product.optString("product") + ", " + product.optString("name") + ", " + product.optString("capacity") + ", " + product.optString("reset")
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
                }
                fun str(key: String): String? = if (product.isNull(key)) null else product.optString(key).takeIf { it.isNotEmpty() && it != "null" }
                val session = str("session"); val weekly = str("weekly"); val status = str("status")
                val legacy = session == null && weekly == null && status == null
                val suffix = if (product.optBoolean("stale")) " · last known" else ""
                if (!legacy) card.contentDescription = listOfNotNull(
                    product.optString("product"), product.optString("name"), status,
                    session?.let { "5 hour, $it" }, weekly?.let { "Week, $it" }
                ).joinToString(", ")
                if (!legacy) {
                    card.addView(TextView(host).apply {
                        text = product.optString("product") + " · " + product.optString("name"); textSize = 12f
                        setTextColor(secondary); setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
                    })
                    if (status != null) {
                        card.addView(TextView(host).apply {
                            text = status + suffix; textSize = 12f; setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END
                            setTextColor(if (status.contains("sign-in expired", ignoreCase = true)) android.graphics.Color.rgb(222, 150, 36) else secondary)
                        })
                    } else {
                        for ((caption, value, key) in listOf(Triple("5h", session, "sessionRemaining"), Triple("Week", weekly, "weeklyRemaining"))) {
                            if (value == null) continue
                            val remaining = if (product.isNull(key)) null else product.optDouble(key)
                            val line = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL }
                            line.addView(TextView(host).apply { text = caption; textSize = 12f; setTextColor(secondary); setTypeface(null, android.graphics.Typeface.BOLD) })
                            line.addView(TextView(host).apply {
                                text = value + suffix; textSize = 12f; gravity = Gravity.END
                                setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.END
                            }, LinearLayout.LayoutParams(0, -2, 1f).apply { marginStart = dp(6) })
                            card.addView(line)
                            card.addView(ProgressBar(host, null, android.R.attr.progressBarStyleHorizontal).apply {
                                max = 100; progress = (100 - (remaining ?: 100.0)).coerceIn(0.0, 100.0).toInt()
                                progressTintList = android.content.res.ColorStateList.valueOf(if (remaining != null && remaining < 20) android.graphics.Color.rgb(222, 150, 36) else secondary)
                            }, LinearLayout.LayoutParams(-1, dp(2)).apply { topMargin = dp(2); bottomMargin = dp(3) })
                        }
                    }
                } else {
                    val top = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL }
                    card.addView(TextView(host).apply {
                        text = product.optString("product") + " · " + product.optString("name"); textSize = 12f
                        setTextColor(secondary); setSingleLine(true); ellipsize = android.text.TextUtils.TruncateAt.MIDDLE
                    })
                    top.addView(TextView(host).apply {
                        text = product.optString("capacity"); textSize = 12f
                        setTypeface(null, android.graphics.Typeface.BOLD)
                        if (product.isNull("remaining")) setTextColor(secondary)
                    })
                    top.addView(TextView(host).apply {
                        text = if (product.isNull("remaining")) "" else if (product.optBoolean("stale")) "Last known" else product.optString("reset").replace("Resets in ", "Reset ")
                        textSize = 12f; setTextColor(secondary); gravity = Gravity.END
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                    card.addView(top)
                    card.addView(ProgressBar(host, null, android.R.attr.progressBarStyleHorizontal).apply {
                        max = 100; progress = product.optDouble("remaining", 0.0).toInt()
                        progressTintList = android.content.res.ColorStateList.valueOf(if (!product.isNull("remaining") && progress < 20) android.graphics.Color.rgb(222, 150, 36) else secondary)
                    }, LinearLayout.LayoutParams(-1, dp(2)).apply { topMargin = dp(3); bottomMargin = dp(3) })
                }
                row.addView(card, LinearLayout.LayoutParams(0, -2, 1f).apply { if (j > i) leftMargin = dp(8) })
            }
            if (i + 1 == usage.length()) row.addView(View(host), LinearLayout.LayoutParams(0, -2, 1f).apply { leftMargin = dp(8) })
            footer.addView(row)
        }
    }

    private fun renderGroups() {
        val groups = model.optJSONArray("groups") ?: JSONArray()
        for (i in 0 until groups.length()) {
            val group = groups.getJSONObject(i); val project = group.getString("project")
            val collapsed = project in collapsedProjects
            val projectRow = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL }
            val commander = group.optString("kind") == "commander"
            projectRow.addView(button("${if (commander) "★" else if (collapsed) "▸" else "▾"} ${group.getString("label")}") {
                // Commander-in-Chief is listed first and opens its screen instead of collapsing.
                if (commander) { composerRecorder?.cancel(); event("selectThread", JSONObject().put("id", "commander:open")); closeDrawer(); return@button }
                if (!collapsedProjects.add(project)) collapsedProjects.remove(project)
                val scrollY = list.parent.let { it as? android.widget.ScrollView }?.scrollY ?: 0
                renderThreads()
                (list.parent as? android.widget.ScrollView)?.post { (list.parent as? android.widget.ScrollView)?.scrollTo(0, scrollY) }
            }.apply { contentDescription = "${group.getString("label")}, ${if (collapsed) "collapsed" else "expanded"}"; runCatching { android.graphics.Color.parseColor(group.optString("color")) }.getOrNull()?.let { setTextColor(it) }; textSize = 18f; gravity = Gravity.START or Gravity.CENTER_VERTICAL; setPadding(dp(12), dp(16), dp(12), dp(4)) }, LinearLayout.LayoutParams(0, -2, 1f))
            if (group.optBoolean("canStart")) projectRow.addView(button("+") { composerRecorder?.cancel(); event("newThread", JSONObject().put("project", project)); closeDrawer() }.apply { contentDescription = "New thread in ${group.getString("label")}" }, LinearLayout.LayoutParams(dp(48), dp(48)))
            if (model.optBoolean("canReorderProjects") && project.isNotEmpty()) {
                val handle = button("≡") {}.apply {
                    contentDescription = "Drag to reorder ${group.getString("label")}"
                    setOnLongClickListener {
                        startDragAndDrop(android.content.ClipData.newPlainText("Freddai project", project), android.view.View.DragShadowBuilder(this), project, 0)
                    }
                }
                projectRow.addView(handle, 0, LinearLayout.LayoutParams(dp(44), dp(48)))
                projectRow.setOnDragListener { view, drag ->
                    val source = drag.localState as? String
                    val valid = model.optBoolean("canReorderProjects") && source != null && source != project && (0 until groups.length()).any { groups.getJSONObject(it).optString("project") == source }
                    when (drag.action) {
                        android.view.DragEvent.ACTION_DRAG_STARTED -> valid
                        android.view.DragEvent.ACTION_DRAG_ENTERED -> { if (valid) view.alpha = 0.5f; valid }
                        android.view.DragEvent.ACTION_DRAG_EXITED, android.view.DragEvent.ACTION_DRAG_ENDED -> { view.alpha = 1f; true }
                        android.view.DragEvent.ACTION_DROP -> {
                            view.alpha = 1f
                            if (valid) event("moveProject", JSONObject().put("project", source).put("target", project).put("after", drag.y > view.height / 2f))
                            valid
                        }
                        else -> valid
                    }
                }
            }
            list.addView(projectRow)
            if (collapsed) continue
            val threads = group.getJSONArray("threads")
            for (j in 0 until threads.length()) {
                addThreadRow(threads.getJSONObject(j))
            }
            val olderRemaining = group.optInt("olderRemaining") > 0
            val olderExpanded = group.optBoolean("olderExpanded")
            if (olderRemaining || olderExpanded) list.addView(LinearLayout(host).apply {
                orientation = LinearLayout.HORIZONTAL
                if (olderRemaining) addView(button(group.getString("olderLabel")) { event("showOlder", JSONObject().put("project", project)) })
                if (olderExpanded) addView(button("Show less") { event("showLess", JSONObject().put("project", project)) })
            })
        }
    }
    private fun filter(optionsKey: String, field: String) {
        val options = model.optJSONArray(optionsKey) ?: return
        AlertDialog.Builder(host).setTitle(if (field == "workspace") "Workspace" else if (field == "project") "Project" else "Status")
            .setItems(Array(options.length()) { options.getJSONObject(it).getString("label") }) { _, index ->
                val current = JSONObject((model.optJSONObject("filters") ?: JSONObject()).toString())
                if (field != "workspace") current.remove("workspace")
                current.put(field, options.getJSONObject(index).getString("id")); event("setFilter", current)
                if (current.optString("workspace") == "__manage_workspaces") closeDrawer()
            }.show()
    }
    private fun showActions() {
        val options = mutableListOf("New thread" to "new")
        if (meta.optBoolean("canPin")) options.add(if (meta.optBoolean("pinned")) "Unpin thread" to "unpin" else "Pin thread" to "pin")
        options.add("Start call" to "call")
        listOf("canStop" to ("Stop" to "stop"), "canReview" to ("Review" to "review"), "canArchive" to ("Archive" to "archive"), "canDelete" to ("Delete" to "delete")).forEach { (flag, option) -> if (meta.optBoolean(flag)) options.add(option) }
        AlertDialog.Builder(host).setTitle(meta.optString("project", "Thread"))
            .setItems(options.map { it.first }.toTypedArray()) { _, index ->
                val action = options[index].second
                if (action == "new") event("newThread", JSONObject().put("project", ""))
                else if (action == "delete") AlertDialog.Builder(host).setTitle("Delete thread?")
                    .setMessage("Move this thread to Deleted on your Mac? This also stops active work.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Move to Deleted") { _, _ -> event("threadAction", JSONObject().put("action", action)) }.show()
                else event("threadAction", JSONObject().put("action", action))
            }.show()
    }
    private fun sendComposer() {
        val text = editor.text.toString()
        if (text.isBlank() && files.isEmpty()) return
        event("composerSend", JSONObject().put("text", text).put("files", JSONArray(files)))
        editor.setText(""); files.clear(); renderChips()
    }
    private fun registerCamera() {
        if (cameraPicker != null) return
        cameraPicker = (host as AppCompatActivity).activityResultRegistry.register("freddai-camera", ActivityResultContracts.TakePicture()) { success ->
            val photo = cameraFile; cameraFile = null
            if (success && photo != null && photo.exists() && photo.length() > 0 && photo.length() <= 25L * 1024 * 1024 && files.size < 20 && files.sumOf { it.optLong("bytes") } + photo.length() <= 100L * 1024 * 1024) {
                files.add(JSONObject().put("path", photo.absolutePath).put("name", "Photo ${System.currentTimeMillis()}.jpg").put("mime", "image/jpeg").put("bytes", photo.length()))
                renderChips()
            } else {
                photo?.delete()
                if (success) AlertDialog.Builder(host).setMessage("The photo could not be attached. Use up to 20 files, 25 MB each and 100 MB per message.").setPositiveButton("OK", null).show()
            }
        }
    }
    private fun showAttachments() {
        val choices = mutableListOf("Photos", "Files")
        val camera = android.content.Intent(android.provider.MediaStore.ACTION_IMAGE_CAPTURE).resolveActivity(host.packageManager) != null
        if (camera) choices.add("Camera")
        AlertDialog.Builder(host).setTitle("Attach").setItems(choices.toTypedArray()) { _, index ->
            when (choices[index]) {
                "Photos" -> picker().launch(arrayOf("image/*", "video/*"))
                "Files" -> picker().launch(arrayOf("*/*"))
                else -> {
                    val photo = File(attachments, "${UUID.randomUUID()}.jpg"); cameraFile = photo
                    try {
                        registerCamera()
                        cameraPicker?.launch(androidx.core.content.FileProvider.getUriForFile(host, host.packageName + ".fileprovider", photo))
                    } catch (_: Exception) {
                        photo.delete(); cameraFile = null
                        AlertDialog.Builder(host).setMessage("The camera could not be opened.").setPositiveButton("OK", null).show()
                    }
                }
            }
        }.show()
    }
    private fun renderChips() {
        chips.removeAllViews()
        files.toList().forEach { file ->
            val chip = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL }
            if (file.optString("mime").startsWith("image/")) {
                val image = ImageView(host).apply { scaleType = ImageView.ScaleType.CENTER_CROP; contentDescription = file.optString("name") }
                chip.addView(image, LinearLayout.LayoutParams(dp(56), dp(56)))
                Thread {
                    val path = file.optString("path")
                    val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    android.graphics.BitmapFactory.decodeFile(path, bounds)
                    var sample = 1
                    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 336) sample *= 2
                    val bitmap = android.graphics.BitmapFactory.decodeFile(path, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
                    host.runOnUiThread { image.setImageBitmap(bitmap) }
                }.start()
            }
            chip.addView(button("${file.optString("name")} ×") {
                files.remove(file); discard(file.optString("path")); renderChips()
            }.apply { contentDescription = "Remove ${file.optString("name")}"; maxWidth = dp(200) })
            chips.addView(chip)
        }
    }
    private fun discard(path: String) {
        val file = File(path).canonicalFile
        if (file.parentFile == attachments.canonicalFile) file.delete()
    }
    @Command fun setComposerText(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs(); editor.setText(args.optString("text")); editor.setSelection(editor.length())
        args.optJSONArray("files")?.let { next -> files.clear(); for (i in 0 until next.length()) {
            val file = next.getJSONObject(i); val path = File(file.optString("path")).canonicalFile
            if (path.parentFile == attachments.canonicalFile && path.isFile) files.add(file)
        }; renderChips() }
    }
    @Command fun setVoice(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs(); voiceEnabled = args.optBoolean("enabled")
        if (!args.isNull("state")) voiceBusy = args.optString("state") == "transcribing"
        dashboard.setVoice(voiceEnabled); composerRecorder?.update(voiceEnabled, voiceBusy)
    }
    @Command fun appendComposerText(invoke: Invoke) = ui(invoke) {
        val current = editor.text.toString(); val add = invoke.getArgs().optString("text")
        editor.setText(if (current.isBlank()) add else current.trimEnd() + " " + add); editor.setSelection(editor.length())
        if (invoke.getArgs().optBoolean("submit")) sendComposer()
    }
    @Command fun discardFiles(invoke: Invoke) = ui(invoke) {
        val paths = invoke.getArgs().getJSONArray("paths"); for (i in 0 until paths.length()) discard(paths.getString(i))
    }
    @Command fun pickOption(invoke: Invoke) {
        host.runOnUiThread {
            val args = invoke.getArgs(); val options = args.getJSONArray("options")
            val enabled = (0 until options.length()).map { options.getJSONObject(it) }.filter { !it.optBoolean("disabled") }
            var resolved = false
            val dialog = AlertDialog.Builder(host).setTitle(args.getString("title"))
                .setItems(enabled.map { (if (it.optString("id") == args.optString("selected")) "✓ " else "") + it.getString("label") + (it.optString("detail").takeIf { d -> d.isNotBlank() }?.let { d -> "\n$d" } ?: "") }.toTypedArray()) { _, index ->
                    resolved = true; invoke.resolve(JSObject().apply { put("picked", true); put("id", enabled[index].getString("id")) })
                }.create()
            dialog.setOnDismissListener { if (!resolved) invoke.resolve(JSObject().apply { put("picked", false) }) }
            dialog.show()
        }
    }
    // Only the Rust plugin handle invokes these; no WebView command grants access.
    private var preview: PreviewDialog? = null
    @Command fun presentPreview(invoke: Invoke) {
        val args = invoke.getArgs()
        val url = args.optString("url"); val title = args.optString("title")
        val uri = android.net.Uri.parse(url)
        if (uri.scheme != "http" || uri.host !in listOf("127.0.0.1", "localhost")) { invoke.reject("Preview URL must be http on 127.0.0.1: $url"); return }
        host.runOnUiThread {
            try {
                val open = preview
                if (open != null && open.isShowing) { open.update(url, title); invoke.resolve(); return@runOnUiThread }
                lateinit var dialog: PreviewDialog
                dialog = PreviewDialog(host, url, title) {
                    if (preview === dialog) preview = null
                    trigger("previewDismissed", JSObject())
                }
                preview = dialog
                dialog.show()
                invoke.resolve()
            } catch (e: Exception) { invoke.reject("Could not present preview: ${e.message}") }
        }
    }
    @Command fun previewStatus(invoke: Invoke) {
        val args = invoke.getArgs()
        host.runOnUiThread { preview?.setStatus(args.optString("message"), args.optBoolean("error")); invoke.resolve() }
    }
    @Command fun readCredential(invoke: Invoke) {
        try { invoke.resolve(JSObject().apply { put("value", store.read() ?: JSONObject.NULL) }) }
        catch (_: Exception) { invoke.reject("Cannot read Android pairing credentials") }
    }
    @Command fun writeCredential(invoke: Invoke) {
        try { store.write(invoke.getArgs().getString("value")); invoke.resolve() }
        catch (_: Exception) { invoke.reject("Cannot save Android pairing credentials") }
    }
}
