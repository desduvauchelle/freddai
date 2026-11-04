import UIKit
import WebKit

/// Hosts the Tauri WKWebView, an optional native navigation bar (via the enclosing
/// UINavigationController) and an optional native composer that tracks the keyboard.
enum ShellMode { case conversation, new, other }

/// Per-thread header metadata pushed from JS (`set_thread_meta`).
struct ThreadMeta: Decodable {
  var project: String = ""
  var runState: String = ""   // "running" | "waiting" | "failed" | ""
  var canStop: Bool = false
  var canReview: Bool = false
  var canArchive: Bool = false
  var canDelete: Bool = false
}

/// Title view that claims the available bar width so its content can left-align and truncate.
final class NavTitleView: UIView {
  override var intrinsicContentSize: CGSize { CGSize(width: 10_000, height: 40) }
}

final class ShellViewController: UIViewController, UITextViewDelegate {
  private let webView: WKWebView
  private let composer = ComposerView()
  private var mode: ShellMode = .other
  private var conversation: Bool { mode == .conversation }
  private var barVisible: Bool { mode != .other }

  private var webTopSafe: NSLayoutConstraint!
  private var webTopEdge: NSLayoutConstraint!
  private var webBottomComposer: NSLayoutConstraint!
  private var webBottomEdge: NSLayoutConstraint!

  var onSend: ((String) -> Void)?
  var onMenu: (() -> Void)?
  var onConnectionTap: (() -> Void)?
  var onNewThread: (() -> Void)?
  var onThreadAction: ((String) -> Void)?

  private let titleLabel = UILabel()
  private let subtitleLabel = UILabel()
  private let connectionGlyph = UIImageView(image: UIImage(systemName: "desktopcomputer"))
  private let actionsItem = UIBarButtonItem()
  private let newItem = UIBarButtonItem()
  private var meta = ThreadMeta()

  init(webView: WKWebView) {
    self.webView = webView
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(webView)

    composer.translatesAutoresizingMaskIntoConstraints = false
    composer.isHidden = true
    composer.onSend = { [weak self] text in self?.onSend?(text) }
    view.addSubview(composer)

    webTopSafe = webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
    webTopEdge = webView.topAnchor.constraint(equalTo: view.topAnchor)
    webBottomComposer = webView.bottomAnchor.constraint(equalTo: composer.topAnchor)
    webBottomEdge = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)

    NSLayoutConstraint.activate([
      webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      composer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      composer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
    ])
    // The field sits above the keyboard (or the home indicator when it is hidden);
    // the material extends to the screen edge behind them.
    composer.bindKeyboard(to: view.keyboardLayoutGuide)
    updateLayout()

    let bar = UINavigationBarAppearance()
    bar.configureWithDefaultBackground()
    navigationItem.standardAppearance = bar
    navigationItem.scrollEdgeAppearance = bar
    navigationItem.largeTitleDisplayMode = .never
    navigationItem.titleView = makeTitleView()
    newItem.image = UIImage(systemName: "square.and.pencil")
    newItem.style = .plain
    newItem.target = self
    newItem.action = #selector(newThreadTapped)
    newItem.accessibilityLabel = "New thread"
    actionsItem.image = UIImage(systemName: "ellipsis.circle")
    actionsItem.style = .plain
    actionsItem.accessibilityLabel = "Thread actions"
    rebuildActions()
    navigationItem.rightBarButtonItems = [actionsItem, newItem]
    let menu = UIBarButtonItem(image: UIImage(systemName: "line.3.horizontal"), style: .plain, target: self, action: #selector(menuTapped))
    menu.accessibilityLabel = "Threads"
    menu.accessibilityHint = "Opens the thread list"
    navigationItem.leftBarButtonItem = menu
    webView.allowsBackForwardNavigationGestures = false
  }

  @objc private func menuTapped() { onMenu?() }
  @objc private func connectionTapped() { onConnectionTap?() }
  @objc private func newThreadTapped() { onNewThread?() }

  /// Mascot as a circular avatar (square, aspect-fill, clipped, hairline border).
  static func avatarView(size: CGFloat) -> UIImageView {
    let view = UIImageView(image: mascot())
    view.contentMode = .scaleAspectFill
    view.clipsToBounds = true
    view.layer.cornerRadius = size / 2
    view.layer.borderWidth = 0.5
    view.layer.borderColor = UIColor.separator.cgColor
    view.translatesAutoresizingMaskIntoConstraints = false
    view.widthAnchor.constraint(equalToConstant: size).isActive = true
    view.heightAnchor.constraint(equalToConstant: size).isActive = true
    view.isAccessibilityElement = false
    return view
  }

  static func mascot() -> UIImage? {
    let scale = UIScreen.main.scale
    let encoded = scale >= 3 ? MascotImage.x3 : MascotImage.x2
    guard let data = Data(base64Encoded: encoded) else { return nil }
    return UIImage(data: data, scale: scale >= 3 ? 3 : 2)
  }

  /// Mascot avatar, then a left-aligned two-line stack: thread title, and [connection glyph] [state ·] project.
  private func makeTitleView() -> UIView {
    let container = NavTitleView()
    let icon = ShellViewController.avatarView(size: 28)
    titleLabel.font = .preferredFont(forTextStyle: .headline)
    titleLabel.textColor = .label
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    subtitleLabel.font = .preferredFont(forTextStyle: .caption1)
    subtitleLabel.textColor = .secondaryLabel
    subtitleLabel.lineBreakMode = .byTruncatingTail
    subtitleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    connectionGlyph.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .regular)
    connectionGlyph.tintColor = .systemGray
    connectionGlyph.contentMode = .scaleAspectFit
    connectionGlyph.setContentHuggingPriority(.required, for: .horizontal)
    connectionGlyph.setContentCompressionResistancePriority(.required, for: .horizontal)
    let sub = UIStackView(arrangedSubviews: [connectionGlyph, subtitleLabel])
    sub.axis = .horizontal
    sub.alignment = .center
    sub.spacing = 4
    let lines = UIStackView(arrangedSubviews: [titleLabel, sub])
    lines.axis = .vertical
    lines.alignment = .leading
    lines.spacing = 0
    let row = UIStackView(arrangedSubviews: [icon, lines])
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 8
    row.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(row)
    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: container.leadingAnchor),
      row.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor),
      row.centerYAnchor.constraint(equalTo: container.centerYAnchor),
    ])
    container.isAccessibilityElement = true
    container.accessibilityTraits = .button
    container.accessibilityHint = "Shows Mac connection details"
    container.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(connectionTapped)))
    return container
  }

  private var connectionState = "connecting"
  private var connectionMessage: String?

  /// state: "ok" (green), "down" (red), anything else (gray, still connecting).
  func setConnection(state: String, message: String?) {
    connectionState = state
    connectionMessage = message
    switch state {
    case "ok": connectionGlyph.tintColor = .systemGreen
    case "down": connectionGlyph.tintColor = .systemRed
    default: connectionGlyph.tintColor = .systemGray
    }
    refreshAccessibility()
  }

  func setThreadMeta(_ new: ThreadMeta) {
    meta = new
    refreshSubtitle()
    rebuildActions()
  }

  private func refreshSubtitle() {
    let text = NSMutableAttributedString()
    let word: (String, UIColor)? = {
      switch meta.runState {
      case "running": return ("Running", .systemBlue)
      case "waiting": return ("Needs you", .systemOrange)
      case "failed": return ("Failed", .systemRed)
      default: return nil
      }
    }()
    if let (label, color) = word {
      text.append(NSAttributedString(string: label, attributes: [.foregroundColor: color]))
      if !meta.project.isEmpty { text.append(NSAttributedString(string: " · ", attributes: [.foregroundColor: UIColor.secondaryLabel])) }
    }
    text.append(NSAttributedString(string: meta.project, attributes: [.foregroundColor: UIColor.secondaryLabel]))
    subtitleLabel.attributedText = text
    refreshAccessibility()
  }

  private func refreshAccessibility() {
    guard let container = navigationItem.titleView else { return }
    let state = connectionState == "ok" ? "Mac connected" : connectionState == "down" ? (connectionMessage ?? "Mac disconnected") : "Connecting to Mac"
    container.accessibilityLabel = [titleLabel.text, subtitleLabel.attributedText?.string, state].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
  }

  private func rebuildActions() {
    var items: [UIMenuElement] = []
    let send: (String) -> UIActionHandler = { action in { [weak self] _ in self?.onThreadAction?(action) } }
    if meta.canStop { items.append(UIAction(title: "Stop", image: UIImage(systemName: "stop.circle"), handler: send("stop"))) }
    if meta.canReview { items.append(UIAction(title: "Review decision…", image: UIImage(systemName: "checkmark.shield"), handler: send("review"))) }
    items.append(UIAction(title: "Archive", image: UIImage(systemName: "archivebox"), attributes: meta.canArchive ? [] : [.disabled], handler: send("archive")))
    let delete = UIAction(title: "Delete…", image: UIImage(systemName: "trash"), attributes: meta.canDelete ? [.destructive] : [.destructive, .disabled]) { [weak self] _ in self?.confirmDelete() }
    items.append(UIMenu(options: .displayInline, children: [delete]))
    actionsItem.menu = UIMenu(children: items)
  }

  private func confirmDelete() {
    let alert = UIAlertController(title: "Delete thread?", message: "Move “\(titleLabel.text ?? "this thread")” to Deleted on your Mac. Deleting an active thread also stops its work. You can restore it from Deleted on your Mac.", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
    alert.addAction(UIAlertAction(title: "Move to Deleted", style: .destructive) { [weak self] _ in self?.onThreadAction?("delete") })
    present(alert, animated: true)
  }

  private func updateLayout() {
    // 'other' mode: the web UI draws under the status bar and handles env(safe-area-inset-*) itself, as before.
    // 'conversation' and 'new': the web content starts below the native navigation bar; only conversation has the native composer.
    webTopEdge.isActive = !barVisible
    webTopSafe.isActive = barVisible
    webBottomEdge.isActive = !conversation
    webBottomComposer.isActive = conversation
    composer.isHidden = !conversation
  }

  func apply(mode newMode: ShellMode, title: String?, placeholder: String?) {
    let modeChanged = mode != newMode
    mode = newMode
    if let title = title { titleLabel.text = title; navigationItem.title = title; refreshAccessibility() }
    navigationItem.rightBarButtonItems = newMode == .conversation ? [actionsItem, newItem] : [newItem]
    if let placeholder = placeholder { composer.placeholder = placeholder }
    if modeChanged {
      updateLayout()
      navigationController?.setNavigationBarHidden(!barVisible, animated: false)
      if !conversation { _ = composer.resignFirstResponder() }
      view.layoutIfNeeded()
    }
  }

  func setComposerText(_ text: String) { composer.setText(text) }
}

/// Material-backed bar with an auto-growing text field and a send button.
final class ComposerView: UIVisualEffectView, UITextViewDelegate {
  private let field = UIView()
  private let textView = UITextView()
  private let placeholderLabel = UILabel()
  private let sendButton = UIButton(type: .system)
  private var heightConstraint: NSLayoutConstraint!
  private let maxLines: CGFloat = 6

  var onSend: ((String) -> Void)?

  var placeholder: String {
    get { placeholderLabel.text ?? "" }
    set { placeholderLabel.text = newValue }
  }

  init() {
    super.init(effect: UIBlurEffect(style: .systemChromeMaterial))
    setup()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  private func setup() {
    let separator = UIView()
    separator.backgroundColor = .separator
    separator.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(separator)

    field.translatesAutoresizingMaskIntoConstraints = false
    field.backgroundColor = .secondarySystemFill
    field.layer.cornerRadius = 19
    field.layer.cornerCurve = .continuous
    contentView.addSubview(field)

    textView.translatesAutoresizingMaskIntoConstraints = false
    textView.font = .preferredFont(forTextStyle: .body)
    textView.adjustsFontForContentSizeCategory = true
    textView.backgroundColor = .clear
    textView.textContainerInset = UIEdgeInsets(top: 8, left: 6, bottom: 8, right: 6)
    textView.isScrollEnabled = false
    textView.returnKeyType = .default
    textView.delegate = self
    field.addSubview(textView)

    placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
    placeholderLabel.font = textView.font
    placeholderLabel.adjustsFontForContentSizeCategory = true
    placeholderLabel.textColor = .placeholderText
    placeholderLabel.text = "Message"
    placeholderLabel.isUserInteractionEnabled = false
    field.addSubview(placeholderLabel)

    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: "arrow.up.circle.fill")
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 30)
    config.contentInsets = .zero
    sendButton.configuration = config
    sendButton.translatesAutoresizingMaskIntoConstraints = false
    sendButton.accessibilityLabel = "Send"
    sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
    contentView.addSubview(sendButton)

    heightConstraint = textView.heightAnchor.constraint(equalToConstant: 36)
    NSLayoutConstraint.activate([
      separator.topAnchor.constraint(equalTo: contentView.topAnchor),
      separator.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
      separator.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
      separator.heightAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale),

      field.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 8),
      field.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
      field.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -8),

      textView.topAnchor.constraint(equalTo: field.topAnchor),
      textView.bottomAnchor.constraint(equalTo: field.bottomAnchor),
      textView.leadingAnchor.constraint(equalTo: field.leadingAnchor, constant: 8),
      textView.trailingAnchor.constraint(equalTo: field.trailingAnchor, constant: -8),
      heightConstraint,

      placeholderLabel.leadingAnchor.constraint(equalTo: textView.leadingAnchor, constant: 11),
      placeholderLabel.trailingAnchor.constraint(lessThanOrEqualTo: textView.trailingAnchor, constant: -6),
      placeholderLabel.centerYAnchor.constraint(equalTo: field.topAnchor, constant: 18),

      sendButton.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -10),
      sendButton.bottomAnchor.constraint(equalTo: field.bottomAnchor, constant: -1),
      sendButton.widthAnchor.constraint(equalToConstant: 36),
      sendButton.heightAnchor.constraint(equalToConstant: 36),
    ])
    refresh()
  }

  func bindKeyboard(to guide: UILayoutGuide) {
    field.bottomAnchor.constraint(equalTo: guide.topAnchor, constant: -8).isActive = true
  }

  private var lastWidth: CGFloat = 0
  override func layoutSubviews() {
    super.layoutSubviews()
    if textView.bounds.width != lastWidth { lastWidth = textView.bounds.width; refresh() }
  }

  @objc private func send() {
    let text = textView.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    textView.text = ""
    refresh()
    onSend?(text)
  }

  func setText(_ text: String) {
    textView.text = text
    refresh()
  }

  override func resignFirstResponder() -> Bool { textView.resignFirstResponder() }

  func textViewDidChange(_ textView: UITextView) { refresh() }

  private func refresh() {
    placeholderLabel.isHidden = !textView.text.isEmpty
    sendButton.isEnabled = !textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let lineHeight = (textView.font?.lineHeight ?? 17)
    let insets = textView.textContainerInset.top + textView.textContainerInset.bottom
    let minHeight = ceil(lineHeight + insets)
    let maxHeight = ceil(lineHeight * maxLines + insets)
    let fitting = textView.sizeThatFits(CGSize(width: max(textView.bounds.width, 200), height: .greatestFiniteMagnitude)).height
    heightConstraint.constant = min(max(fitting, minHeight), maxHeight)
    textView.isScrollEnabled = fitting > maxHeight
  }
}
