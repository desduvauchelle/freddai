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
    private lateinit var drawer: DrawerLayout
    private lateinit var navigation: LinearLayout
    private lateinit var composer: LinearLayout
    private lateinit var modelButton: ImageButton
    private lateinit var accessButton: ImageButton
    private lateinit var editor: EditText
    private lateinit var title: TextView
    private lateinit var connection: Button
    private lateinit var list: LinearLayout
    private lateinit var search: EditText
    private lateinit var chips: LinearLayout
    private var model = JSONObject()
    private var meta = JSONObject()
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
            val content = column()
            navigation = LinearLayout(host).apply { gravity = Gravity.CENTER_VERTICAL }
            navigation.addView(button("Threads") { drawer.openDrawer(Gravity.START) }.apply { text = "☰"; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) })
            title = TextView(host).apply { textSize = 16f; maxLines = 2; text = oldTitle }
            navigation.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
            connection = button("Mac") { event("connectionTap") }
            navigation.addView(connection)
            navigation.addView(button("More") { showActions() }.apply { text = "⋮"; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) })
            content.addView(navigation)
            content.addView(webView, LinearLayout.LayoutParams(-1, 0, 1f))
            composer = column()
            chips = LinearLayout(host)
            composer.addView(HorizontalScrollView(host).apply { addView(chips) })
            val row = LinearLayout(host).apply { gravity = Gravity.BOTTOM }
            row.addView(button("Attach") { picker().launch(arrayOf("*/*")) }.apply { text = "+"; textSize = 24f; layoutParams = LinearLayout.LayoutParams(dp(48), dp(48)) })
            editor = EditText(host).apply {
                hint = oldHint; setText(draft); minLines = 1; maxLines = 6
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            }
            composer.addView(editor, LinearLayout.LayoutParams(-1, -2))
            row.addView(button("Send") {
                val text = editor.text.toString()
                if (text.isBlank() && files.isEmpty()) return@button
                event("composerSend", JSONObject().put("text", text).put("files", JSONArray(files)))
                editor.setText(""); files.clear(); renderChips()
            })
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
            composer.addView(row); content.addView(composer)
            renderSettings()
            drawer.addView(content, DrawerLayout.LayoutParams(-1, -1))
            val sidebar = column().apply { val color = android.util.TypedValue()
                host.theme.resolveAttribute(android.R.attr.colorBackground, color, true)
                setBackgroundColor(color.data) }
            search = EditText(host).apply { hint = "Search threads"; setSingleLine(true) }
            search.addTextChangedListener(object : TextWatcher {
                override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
                override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                    if (!updatingSearch) event("search", JSONObject().put("query", s.toString()))
                }
                override fun afterTextChanged(s: Editable?) {}
            })
            sidebar.addView(search)
            val filters = LinearLayout(host)
            filters.addView(button("Project") { filter("projectOptions", "project") })
            filters.addView(button("Status") { filter("statusOptions", "status") })
            sidebar.addView(filters)
            sidebar.addView(button("New thread") { event("newThread", JSONObject().put("project", "")); closeDrawer() })
            list = column(); sidebar.addView(ScrollView(host).apply { addView(list) }, LinearLayout.LayoutParams(-1, 0, 1f))
            drawer.addView(sidebar, DrawerLayout.LayoutParams(dp(320), -1, Gravity.START))
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
            picker() // Register before the first attachment request.
            renderThreads(); renderChips()
            applyMode(); installed = true
        }
    }
    private fun closeDrawer() {
        (host.getSystemService(Activity.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
            .hideSoftInputFromWindow(search.windowToken, 0)
        drawer.closeDrawer(Gravity.START)
    }
    private fun applyMode() {
        val visible = mode != "other"
        navigation.visibility = if (visible) View.VISIBLE else View.GONE
        composer.visibility = if (visible) View.VISIBLE else View.GONE
        drawer.setDrawerLockMode(if (visible) DrawerLayout.LOCK_MODE_UNLOCKED else DrawerLayout.LOCK_MODE_LOCKED_CLOSED)
        back?.isEnabled = visible
    }
    @Command fun ping(invoke: Invoke) { host.runOnUiThread { ensureShell(); invoke.resolve(JSObject().put("installed", installed && drawer.isAttachedToWindow)) } }
    @Command fun setMode(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs(); mode = args.optString("mode", "other")
        title.text = args.optString("title", "Freddai"); editor.hint = args.optString("placeholder", "Message")
        applyMode()
        if (mode != "other" && args.optBoolean("openDrawer")) drawer.openDrawer(Gravity.START)
    }
    @Command fun setConnection(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs(); val state = args.optString("state")
        connection.text = when (state) { "ok" -> "Mac ●"; "down" -> "Mac ○"; else -> "Mac …" }
        connection.contentDescription = if (args.isNull("message")) "Mac connection: $state" else args.getString("message")
    }
    private fun renderSettings() {
        if (!::modelButton.isInitialized) return
        for ((button, key) in listOf(modelButton to "model", accessButton to "access")) {
            button.visibility = if (meta.isNull(key) || !meta.has(key)) View.GONE else View.VISIBLE
            button.isEnabled = !meta.optBoolean("controlsDisabled", false)
            button.contentDescription = (if (key == "model") "Model: " else "Permissions: ") + meta.optString(key)
        }
    }
    @Command fun setThreadMeta(invoke: Invoke) = ui(invoke) { meta = invoke.getArgs().getJSONObject("meta"); renderSettings() }
    @Command fun setThreads(invoke: Invoke) = ui(invoke) {
        model = invoke.getArgs().getJSONObject("model")
        val query = model.optJSONObject("filters")?.optString("query") ?: ""
        if (search.text.toString() != query) { updatingSearch = true; search.setText(query); updatingSearch = false }
        renderThreads()
    }
    private fun renderThreads() {
        list.removeAllViews()
        val groups = model.optJSONArray("groups") ?: JSONArray()
        for (i in 0 until groups.length()) {
            val group = groups.getJSONObject(i); val project = group.getString("project")
            list.addView(TextView(host).apply { text = group.getString("label"); textSize = 18f; setPadding(dp(12), dp(16), dp(12), dp(4)) })
            if (group.optBoolean("canStart")) list.addView(button("New thread in ${group.getString("label")}") { event("newThread", JSONObject().put("project", project)); closeDrawer() })
            val threads = group.getJSONArray("threads")
            for (j in 0 until threads.length()) {
                val thread = threads.getJSONObject(j); val id = thread.getString("id")
                list.addView(button("${if (thread.optBoolean("unread")) "● " else ""}${thread.getString("title")} · ${thread.optString("status")}") {
                    event("selectThread", JSONObject().put("id", id)); closeDrawer()
                }.apply { isSelected = id == model.optString("selectedId"); gravity = Gravity.START or Gravity.CENTER_VERTICAL })
            }
            if (group.optInt("olderRemaining") > 0) list.addView(button(group.getString("olderLabel")) { event("showOlder", JSONObject().put("project", project)) })
        }
    }
    private fun filter(optionsKey: String, field: String) {
        val options = model.optJSONArray(optionsKey) ?: return
        AlertDialog.Builder(host).setTitle(if (field == "project") "Project" else "Status")
            .setItems(Array(options.length()) { options.getJSONObject(it).getString("label") }) { _, index ->
                val current = JSONObject((model.optJSONObject("filters") ?: JSONObject()).toString())
                current.put(field, options.getJSONObject(index).getString("id")); event("setFilter", current)
            }.show()
    }
    private fun showActions() {
        val options = mutableListOf("New thread" to "new")
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
    private fun renderChips() {
        chips.removeAllViews()
        files.toList().forEach { file -> chips.addView(button("${file.optString("name")} ×") {
            files.remove(file); discard(file.optString("path")); renderChips()
        }) }
    }
    private fun discard(path: String) {
        val file = File(path).canonicalFile
        if (file.parentFile == attachments.canonicalFile) file.delete()
    }
    @Command fun setComposerText(invoke: Invoke) = ui(invoke) {
        val args = invoke.getArgs(); editor.setText(args.optString("text")); editor.setSelection(editor.length())
        args.optJSONArray("files")?.let { next -> files.clear(); for (i in 0 until next.length()) files.add(next.getJSONObject(i)); renderChips() }
    }
    @Command fun setVoice(invoke: Invoke) = ui(invoke) { /* Voice dictation is iOS-only for now. */ }
    @Command fun appendComposerText(invoke: Invoke) = ui(invoke) {
        val current = editor.text.toString(); val add = invoke.getArgs().optString("text")
        editor.setText(if (current.isBlank()) add else current.trimEnd() + " " + add); editor.setSelection(editor.length())
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
    @Command fun readCredential(invoke: Invoke) {
        try { invoke.resolve(JSObject().apply { put("value", store.read() ?: JSONObject.NULL) }) }
        catch (_: Exception) { invoke.reject("Cannot read Android pairing credentials") }
    }
    @Command fun writeCredential(invoke: Invoke) {
        try { store.write(invoke.getArgs().getString("value")); invoke.resolve() }
        catch (_: Exception) { invoke.reject("Cannot save Android pairing credentials") }
    }
}
