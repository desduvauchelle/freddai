import UIKit
import WebKit

/// Hosts the Tauri WKWebView, an optional native navigation bar (via the enclosing
/// UINavigationController) and an optional native composer that tracks the keyboard.
enum ShellMode { case conversation, new, dashboard, other }

struct PickerOption: Decodable {
  let id: String
  let label: String
  var detail: String?
  var disabled: Bool?
}

/// Per-thread header metadata pushed from JS (`set_thread_meta`).
struct ThreadMeta: Decodable {
  var model: String?
  var access: String?
  var controlsDisabled: Bool?
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

final class ShellViewController: UIViewController, UITextViewDelegate, UIPopoverPresentationControllerDelegate {
  private let webView: WKWebView
  private let composer = ComposerView()
  private var mode: ShellMode = .other
  private var conversation: Bool { mode == .conversation }
  private var composerVisible: Bool { mode == .conversation || mode == .new }
  private var barVisible: Bool { mode != .other }

  private var webTopSafe: NSLayoutConstraint!
  private var webTopEdge: NSLayoutConstraint!
  private var webBottomComposer: NSLayoutConstraint!
  private var webBottomEdge: NSLayoutConstraint!

  var onSend: ((String, [AttachedFile]) -> Void)?
  var onVoiceRecorded: ((String, Int) -> Void)?
  var onVoiceError: ((String) -> Void)?
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
  private var pickerCompletion: ((String?) -> Void)?

  init(webView: WKWebView) {
    self.webView = webView
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = ComposerView.threadBackground

    webView.removeFromSuperview()
    webView.translatesAutoresizingMaskIntoConstraints = false
    webView.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(webView)

    composer.translatesAutoresizingMaskIntoConstraints = false
    composer.isHidden = true
    composer.presenter = self
    composer.onSetting = { [weak self] action in self?.onThreadAction?(action) }
    composer.onSend = { [weak self] text, files in self?.onSend?(text, files) }
    composer.onVoiceRecorded = { [weak self] path, ms in self?.onVoiceRecorded?(path, ms) }
    composer.onVoiceError = { [weak self] message in self?.onVoiceError?(message) }
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
    // the thread background extends to the screen edge behind them.
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

  func setThreadListPresentation(sidebar: Bool, open: Bool) {
    navigationItem.leftBarButtonItem?.image = UIImage(systemName: sidebar ? "sidebar.left" : "line.3.horizontal")
    navigationItem.leftBarButtonItem?.accessibilityHint = open ? "Hides the thread list" : "Opens the thread list"
  }

  /// Left-aligned thread title and connection/state/project subtitle, without a header avatar.
  private func makeTitleView() -> UIView {
    let container = NavTitleView()
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
    let row = UIStackView(arrangedSubviews: [lines])
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
    let tint: UIColor = state == "ok" ? .systemGreen : state == "down" ? .systemRed : .systemGray
    if connectionGlyph.tintColor != tint { Motion.crossfade(connectionGlyph) { self.connectionGlyph.tintColor = tint } }
    refreshAccessibility()
  }

  func setThreadMeta(_ new: ThreadMeta) {
    meta = new
    composer.setSettings(model: new.model, access: new.access, disabled: new.controlsDisabled ?? false)
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
    if subtitleLabel.attributedText?.string != text.string || subtitleLabel.attributedText != text { Motion.crossfade(subtitleLabel) { self.subtitleLabel.attributedText = text } }
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
    // 'conversation' and 'new': the web content starts below the native navigation bar and above the native composer.
    webTopEdge.isActive = !barVisible
    webTopSafe.isActive = barVisible
    webBottomEdge.isActive = !composerVisible
    webBottomComposer.isActive = composerVisible
    composer.isHidden = !composerVisible
  }

  func apply(mode newMode: ShellMode, title: String?, placeholder: String?) {
    let modeChanged = mode != newMode
    mode = newMode
    if let title = title { if titleLabel.text != title { Motion.crossfade(titleLabel) { self.titleLabel.text = title } }; navigationItem.title = title; refreshAccessibility() }
    // The New thread home has no thread actions, and its own compose button would be a no-op.
    navigationItem.rightBarButtonItems = newMode == .conversation ? [actionsItem, newItem] : []
    if let placeholder = placeholder { composer.placeholder = placeholder }
    if modeChanged {
      updateLayout()
      navigationController?.setNavigationBarHidden(!barVisible, animated: false)
      if !composerVisible { _ = composer.resignFirstResponder() }
      view.layoutIfNeeded()
    }
  }

  func setComposerText(_ text: String, files: [AttachedFile]?) { composer.setText(text, files: files) }
  func appendComposerText(_ text: String, submit: Bool = false) { composer.appendText(text, submit: submit) }
  func setVoice(enabled: Bool, state: String?) { composer.setVoice(enabled: enabled, state: state) }

  /// Native action sheet used by the web pills (project, coding agent, model, effort, permissions).
  func presentPicker(title: String, options: [PickerOption], selected: String?, completion: @escaping (String?) -> Void) {
    guard presentedViewController == nil else { completion(nil); return }
    pickerCompletion = completion
    let current = options.first { $0.id == selected }?.label
    let sheet = UIAlertController(title: title, message: current.map { "Current: \($0)" }, preferredStyle: .actionSheet)
    for option in options {
      let label = option.detail.map { "\(option.label) (\($0))" } ?? option.label
      let action = UIAlertAction(title: label, style: .default) { [weak self] _ in self?.finishPicker(option.id) }
      action.isEnabled = !(option.disabled ?? false)
      sheet.addAction(action)
    }
    sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.finishPicker(nil) })
    sheet.presentationController?.delegate = self
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = view
      popover.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
      popover.permittedArrowDirections = []
      popover.delegate = self
    }
    present(sheet, animated: true)
  }

  private func finishPicker(_ id: String?) {
    let completion = pickerCompletion
    pickerCompletion = nil
    completion?(id)
  }

  // iPad popovers hide the Cancel action and dismiss when tapped outside. Resolve the JS request too.
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finishPicker(nil) }
  func popoverPresentationControllerDidDismissPopover(_ popoverPresentationController: UIPopoverPresentationController) { finishPicker(nil) }
}
