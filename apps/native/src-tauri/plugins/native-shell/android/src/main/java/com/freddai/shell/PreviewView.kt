package com.freddai.shell

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Full-screen preview of a web app served by the in-app loopback proxy (see docs/preview-tunnel.md).
 * Only loopback hosts load inside the web view; every other link opens in the system browser.
 * [onDismissed] fires once when the user closes it (close button, or back with no web history).
 */
class PreviewDialog(private val activity: Activity, url: String, title: String, private val onDismissed: () -> Unit) :
    Dialog(activity, android.R.style.Theme_DeviceDefault_NoActionBar) {
    private val dark get() = context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    private val surfaceColor get() = if (dark) Color.rgb(18, 18, 20) else Color.WHITE
    private val primary get() = if (dark) Color.rgb(240, 240, 244) else Color.rgb(28, 28, 32)
    private val secondary get() = if (dark) Color.argb(166, 235, 235, 245) else Color.argb(166, 60, 60, 67)
    private fun dp(v: Int) = (v * context.resources.displayMetrics.density).toInt()

    private lateinit var web: WebView
    private lateinit var back: ImageButton
    private lateinit var forward: ImageButton
    private lateinit var titleView: TextView
    private lateinit var banner: TextView
    private lateinit var progress: ProgressBar
    private var notified = false
    private var initialUrl = url
    private var currentTitle = title

    private fun isLoopback(uri: Uri) = uri.host?.lowercase() in listOf("127.0.0.1", "localhost", "[::1]", "::1")

    private fun icon(resId: Int, label: String, action: () -> Unit) = ImageButton(context).apply {
        setImageResource(resId); contentDescription = label; setBackgroundColor(Color.TRANSPARENT); setColorFilter(primary)
        minimumWidth = dp(48); minimumHeight = dp(48)
        layoutParams = LinearLayout.LayoutParams(dp(48), dp(48))
        setOnClickListener { action() }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
        window?.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(surfaceColor))
        window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        val root = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(surfaceColor) }
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        val close = icon(android.R.drawable.ic_menu_close_clear_cancel, "Close preview") { dismiss() }
        back = icon(android.R.drawable.ic_media_previous, "Back") { if (web.canGoBack()) web.goBack() }
        forward = icon(android.R.drawable.ic_media_next, "Forward") { if (web.canGoForward()) web.goForward() }
        val reload = icon(android.R.drawable.ic_popup_sync, "Reload") { setStatus("", false); web.reload() }
        titleView = TextView(context).apply {
            text = currentTitle; textSize = 15f; setTextColor(primary); gravity = Gravity.CENTER; maxLines = 1
            ellipsize = android.text.TextUtils.TruncateAt.MIDDLE; typeface = android.graphics.Typeface.DEFAULT_BOLD
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val bar = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setBackgroundColor(surfaceColor)
            setPadding(dp(4), 0, dp(4), 0)
            addView(close); addView(back); addView(forward); addView(titleView); addView(reload)
        }
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)))
        root.addView(View(context).apply { setBackgroundColor(if (dark) 0x22FFFFFF else 0x22000000) }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        progress = ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply { max = 100; visibility = View.GONE }
        root.addView(progress, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)))
        banner = TextView(context).apply { textSize = 13f; setPadding(dp(12), dp(8), dp(12), dp(8)); visibility = View.GONE; contentDescription = "preview-banner"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        root.addView(banner, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        web = WebView(context).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            settings.setSupportMultipleWindows(false)
            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView, newProgress: Int) {
                    this@PreviewDialog.progress.progress = newProgress; this@PreviewDialog.progress.visibility = if (newProgress in 0..99) View.VISIBLE else View.GONE
                }
            }
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val uri = request.url
                    if (uri.scheme in listOf("http", "https") && isLoopback(uri)) return false
                    if (uri.scheme in listOf("about", "blob", "data", "ws", "wss")) return false
                    if (request.isForMainFrame) {
                        try { activity.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                        catch (e: Exception) { setStatus("Could not open ${uri.host ?: uri}: ${e.message}", true) }
                    }
                    return true
                }
                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) { setStatus("", false) }
                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) { updateNav() }
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) setStatus("Preview failed to load: ${error.description} (code ${error.errorCode})", true)
                }
                override fun onReceivedSslError(view: WebView, handler: android.webkit.SslErrorHandler, error: android.net.http.SslError) {
                    handler.cancel(); setStatus("Preview failed to load: TLS error ${error.primaryError}", true)
                }
                override fun onRenderProcessGone(view: WebView, detail: android.webkit.RenderProcessGoneDetail): Boolean {
                    setStatus("Preview page process ended unexpectedly. Tap reload.", true); return true
                }
            }
        }
        root.addView(web, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
        setOnDismissListener { notifyDismissed() }
        updateNav()
        web.loadUrl(initialUrl)
    }

    private fun updateNav() {
        back.isEnabled = web.canGoBack(); back.alpha = if (web.canGoBack()) 1f else 0.35f
        forward.isEnabled = web.canGoForward(); forward.alpha = if (web.canGoForward()) 1f else 0.35f
    }

    private fun notifyDismissed() {
        if (notified) return
        notified = true
        web.stopLoading(); web.destroy()
        onDismissed()
    }

    @Deprecated("Dialog back handling")
    override fun onBackPressed() { if (web.canGoBack()) web.goBack() else dismiss() }

    fun update(url: String, title: String) {
        currentTitle = title; titleView.text = title; setStatus("", false); web.loadUrl(url)
    }

    fun setStatus(message: String, error: Boolean) {
        if (message.isEmpty()) { banner.visibility = View.GONE; banner.text = ""; return }
        banner.text = message
        banner.setBackgroundColor(if (error) (if (dark) Color.rgb(107, 31, 31) else Color.rgb(252, 227, 224)) else (if (dark) 0x14FFFFFF else 0x0F000000))
        banner.setTextColor(if (error) (if (dark) Color.rgb(255, 209, 204) else Color.rgb(158, 26, 26)) else secondary)
        banner.visibility = View.VISIBLE
    }
}
