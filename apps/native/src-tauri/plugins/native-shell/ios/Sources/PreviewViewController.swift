import UIKit
import WebKit

/// Full-screen preview of a web app served by the in-app loopback proxy (see docs/preview-tunnel.md).
/// Only loopback hosts load inside the view; every other link opens in the system browser.
final class PreviewViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
  /// Called once when the user closes the preview (button or interactive dismissal), not on programmatic teardown.
  var onDismissed: (() -> Void)?

  private let webView: WKWebView
  private let bar = UIView()
  private let closeButton = UIButton(type: .system)
  private let backButton = UIButton(type: .system)
  private let forwardButton = UIButton(type: .system)
  private let reloadButton = UIButton(type: .system)
  private let titleLabel = UILabel()
  private let progress = UIProgressView(progressViewStyle: .bar)
  private let banner = UILabel()
  private let bannerWrap = UIView()
  private var observations: [NSKeyValueObservation] = []
  private var currentTitle: String
  private var pendingURL: URL?
  private var notified = false

  init(url: URL, title: String) {
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.websiteDataStore = .default()
    config.preferences.javaScriptEnabled = true
    webView = WKWebView(frame: .zero, configuration: config)
    currentTitle = title
    pendingURL = url
    super.init(nibName: nil, bundle: nil)
    modalPresentationStyle = .fullScreen
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  /// Replaces the page and title of an already open preview.
  func update(url: URL, title: String) {
    currentTitle = title
    titleLabel.text = title
    setStatus(message: "", error: false)
    if isViewLoaded { webView.load(URLRequest(url: url)) } else { pendingURL = url }
  }

  func setStatus(message: String, error: Bool) {
    let hidden = message.isEmpty
    banner.text = message
    bannerWrap.backgroundColor = error
      ? UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.42, green: 0.12, blue: 0.12, alpha: 1) : UIColor(red: 0.99, green: 0.89, blue: 0.88, alpha: 1) }
      : UIColor.secondarySystemBackground
    banner.textColor = error
      ? UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 1, green: 0.82, blue: 0.80, alpha: 1) : UIColor(red: 0.62, green: 0.1, blue: 0.1, alpha: 1) }
      : UIColor.label.withAlphaComponent(0.72)
    banner.accessibilityTraits = error ? .staticText : .updatesFrequently
    bannerWrap.isHidden = hidden
    if !hidden { UIAccessibility.post(notification: .announcement, argument: message) }
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    #if DEBUG
    if #available(iOS 16.4, *) { webView.isInspectable = true }
    #endif
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.allowsBackForwardNavigationGestures = true
    webView.translatesAutoresizingMaskIntoConstraints = false

    bar.backgroundColor = .systemBackground
    bar.translatesAutoresizingMaskIntoConstraints = false
    let separator = UIView()
    separator.backgroundColor = UIColor.separator
    separator.translatesAutoresizingMaskIntoConstraints = false

    configure(closeButton, symbol: "xmark", label: "Close preview", action: #selector(closeTapped))
    configure(backButton, symbol: "chevron.left", label: "Back", action: #selector(backTapped))
    configure(forwardButton, symbol: "chevron.right", label: "Forward", action: #selector(forwardTapped))
    configure(reloadButton, symbol: "arrow.clockwise", label: "Reload", action: #selector(reloadTapped))
    titleLabel.text = currentTitle
    titleLabel.font = .systemFont(ofSize: 15, weight: .semibold)
    titleLabel.textColor = .label
    titleLabel.textAlignment = .center
    titleLabel.lineBreakMode = .byTruncatingMiddle
    titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    let nav = UIStackView(arrangedSubviews: [backButton, forwardButton])
    nav.spacing = 0
    let row = UIStackView(arrangedSubviews: [closeButton, nav, titleLabel, reloadButton])
    row.alignment = .center
    row.spacing = 4
    row.translatesAutoresizingMaskIntoConstraints = false
    bar.addSubview(row)
    bar.addSubview(separator)

    progress.translatesAutoresizingMaskIntoConstraints = false
    progress.trackTintColor = .clear
    progress.progressTintColor = UIColor.label.withAlphaComponent(0.5)
    progress.isHidden = true

    banner.numberOfLines = 0
    banner.font = .systemFont(ofSize: 13, weight: .medium)
    banner.translatesAutoresizingMaskIntoConstraints = false
    banner.accessibilityIdentifier = "preview-banner"
    bannerWrap.translatesAutoresizingMaskIntoConstraints = false
    bannerWrap.addSubview(banner)
    bannerWrap.isHidden = true

    view.addSubview(webView)
    view.addSubview(bar)
    view.addSubview(bannerWrap)
    view.addSubview(progress)
    let guide = view.safeAreaLayoutGuide
    NSLayoutConstraint.activate([
      bar.topAnchor.constraint(equalTo: view.topAnchor),
      bar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      row.topAnchor.constraint(equalTo: guide.topAnchor),
      row.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 4),
      row.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -4),
      row.heightAnchor.constraint(equalToConstant: 44),
      bar.bottomAnchor.constraint(equalTo: row.bottomAnchor),
      separator.leadingAnchor.constraint(equalTo: bar.leadingAnchor),
      separator.trailingAnchor.constraint(equalTo: bar.trailingAnchor),
      separator.bottomAnchor.constraint(equalTo: bar.bottomAnchor),
      separator.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),
      progress.topAnchor.constraint(equalTo: bar.bottomAnchor),
      progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      bannerWrap.topAnchor.constraint(equalTo: bar.bottomAnchor),
      bannerWrap.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      bannerWrap.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      banner.topAnchor.constraint(equalTo: bannerWrap.topAnchor, constant: 8),
      banner.bottomAnchor.constraint(equalTo: bannerWrap.bottomAnchor, constant: -8),
      banner.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 12),
      banner.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -12),
      webView.topAnchor.constraint(equalTo: bannerWrap.bottomAnchor),
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])

    observations = [
      webView.observe(\.estimatedProgress, options: [.new]) { [weak self] web, _ in
        guard let self else { return }
        self.progress.isHidden = !web.isLoading
        self.progress.setProgress(Float(web.estimatedProgress), animated: true)
      },
      webView.observe(\.isLoading, options: [.new]) { [weak self] web, _ in self?.progress.isHidden = !web.isLoading },
      webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] web, _ in self?.backButton.isEnabled = web.canGoBack },
      webView.observe(\.canGoForward, options: [.initial, .new]) { [weak self] web, _ in self?.forwardButton.isEnabled = web.canGoForward },
    ]
    if let url = pendingURL { pendingURL = nil; webView.load(URLRequest(url: url)) }
  }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    // Interactive or system dismissal (not a replacement): the Rust side must tear the tunnel down.
    if isBeingDismissed || presentingViewController == nil { notifyDismissed() }
  }

  private func notifyDismissed() {
    guard !notified else { return }
    notified = true
    webView.stopLoading()
    onDismissed?()
  }

  /// Dismiss without telling the host (used when it asked for the close).
  func dismissSilently(completion: (() -> Void)? = nil) {
    notified = true
    webView.stopLoading()
    dismiss(animated: true, completion: completion)
  }

  private func configure(_ button: UIButton, symbol: String, label: String, action: Selector) {
    let cfg = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
    button.setImage(UIImage(systemName: symbol, withConfiguration: cfg), for: .normal)
    button.tintColor = .label
    button.accessibilityLabel = label
    button.addTarget(self, action: action, for: .touchUpInside)
    button.widthAnchor.constraint(equalToConstant: 44).isActive = true
    button.heightAnchor.constraint(equalToConstant: 44).isActive = true
  }

  @objc private func closeTapped() {
    notifyDismissed()
    dismiss(animated: true)
  }
  @objc private func backTapped() { webView.goBack() }
  @objc private func forwardTapped() { webView.goForward() }
  @objc private func reloadTapped() {
    setStatus(message: "", error: false)
    if webView.url != nil { webView.reload() } else if let url = URL(string: "about:blank") { webView.load(URLRequest(url: url)) }
  }

  // MARK: Navigation

  private static func isLoopback(_ url: URL) -> Bool {
    guard let host = url.host?.lowercased() else { return false }
    return host == "127.0.0.1" || host == "localhost" || host == "::1"
  }

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = action.request.url else { decisionHandler(.allow); return }
    let scheme = url.scheme?.lowercased() ?? ""
    if ["about", "blob", "data", "ws", "wss"].contains(scheme) { decisionHandler(.allow); return }
    if (scheme == "http" || scheme == "https"), Self.isLoopback(url) { decisionHandler(.allow); return }
    if action.targetFrame?.isMainFrame ?? true {
      // External link or app scheme (mailto:, tel:, https://other.example): hand to the system.
      UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }
    decisionHandler(.cancel)
  }

  // target=_blank / window.open: stay in this web view when it is a loopback page.
  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if action.targetFrame == nil, let url = action.request.url {
      if Self.isLoopback(url) { webView.load(action.request) } else { UIApplication.shared.open(url, options: [:], completionHandler: nil) }
    }
    return nil
  }

  func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { setStatus(message: "", error: false) }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { report(error) }
  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { report(error) }

  func webView(_ webView: WKWebView, webViewWebContentProcessDidTerminate: WKWebView) {
    setStatus(message: "Preview page process ended unexpectedly. Tap reload.", error: true)
  }

  private func report(_ error: Error) {
    let ns = error as NSError
    // A navigation cancelled by a policy decision or a superseding load is not a failure.
    if ns.domain == NSURLErrorDomain, ns.code == NSURLErrorCancelled { return }
    if ns.domain == "WebKitErrorDomain", ns.code == 102 { return }
    setStatus(message: "Preview failed to load: \(ns.localizedDescription) (\(ns.domain) \(ns.code))", error: true)
  }
}
