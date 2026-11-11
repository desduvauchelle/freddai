import UIKit
import WebKit

/// Hosts the Tauri WKWebView, an optional native navigation bar (via the enclosing
/// UINavigationController) and an optional native composer that tracks the keyboard.
/// Every conversation (`conversation` and `commander`) uses the web layer's translucent floating header (avatar + name pill) under a transparent bar;
/// the native menu and action buttons sit on the same row.
enum ShellMode { case conversation, commander, new, project, dashboard, other }

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
  var canPin: Bool?
  var pinned: Bool?
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
  private let dashboard = DashboardView()
  private var officeExpanded = false
  private var dashboardVisible: Bool { mode == .dashboard && !officeExpanded }
  private var webHorizontal: [NSLayoutConstraint] = []
  private var workspaceConstraints: [NSLayoutConstraint] = []
  var onDashboardAction: ((DashboardActionPayload) -> Void)?
  private var mode: ShellMode = .other
  private var conversation: Bool { mode == .conversation || mode == .commander }
  private var composerVisible: Bool { mode == .conversation || mode == .commander || mode == .new }
  private var barVisible: Bool { mode != .other }
  var onBack: (() -> Void)?
  private var menuItem: UIBarButtonItem?
  private var backItem: UIBarButtonItem?
  private var floatingHeader: Bool { mode == .conversation || mode == .commander }

  private var webTopSafe: NSLayoutConstraint!
  private var webTopEdge: NSLayoutConstraint!
  private var webBottomComposer: NSLayoutConstraint!
  private var webBottomEdge: NSLayoutConstraint!

  var onSend: ((String, [AttachedFile]) -> Void)?
  var onVoiceRecorded: ((String, Int, String, [AttachedFile]) -> Void)?
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

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
  }
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
    composer.onVoiceRecorded = { [weak self] path, ms, text, files in self?.onVoiceRecorded?(path, ms, text, files) }
    composer.onVoiceError = { [weak self] message in self?.onVoiceError?(message) }
    view.addSubview(composer)
    dashboard.translatesAutoresizingMaskIntoConstraints = false
    dashboard.isHidden = true
    dashboard.onAction = { [weak self] action in self?.onDashboardAction?(action) }
    dashboard.onError = { [weak self] message in self?.onVoiceError?(message) }
    view.addSubview(dashboard)
    NSLayoutConstraint.activate([
      dashboard.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      dashboard.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      dashboard.topAnchor.constraint(equalTo: view.topAnchor),
      dashboard.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
    ])
    webHorizontal = [webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor)]
    workspaceConstraints = [webView.leadingAnchor.constraint(equalTo: dashboard.workspace.leadingAnchor),
      webView.trailingAnchor.constraint(equalTo: dashboard.workspace.trailingAnchor),
      webView.topAnchor.constraint(equalTo: dashboard.workspace.topAnchor),
      webView.bottomAnchor.constraint(equalTo: dashboard.workspace.bottomAnchor)]

    webTopSafe = webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor)
    webTopEdge = webView.topAnchor.constraint(equalTo: view.topAnchor)
    webBottomComposer = webView.bottomAnchor.constraint(equalTo: composer.topAnchor)
    webBottomEdge = webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)

    NSLayoutConstraint.activate([
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
    navigationItem.rightBarButtonItems = [actionsItem, callItem, newItem]
    let menu = UIBarButtonItem(image: UIImage(systemName: "line.3.horizontal"), style: .plain, target: self, action: #selector(menuTapped))
    menu.accessibilityLabel = "Threads"
    menu.accessibilityHint = "Opens the thread list"
    menuItem = menu
    let back = UIBarButtonItem(image: UIImage(systemName: "chevron.left"), style: .plain, target: self, action: #selector(backTapped))
    back.title = "Back"
    back.accessibilityLabel = "Back"
    backItem = back
    navigationItem.leftBarButtonItem = menu
    webView.allowsBackForwardNavigationGestures = false
  }

  private lazy var callItem: UIBarButtonItem = {
    let item = UIBarButtonItem(image: UIImage(systemName: "phone"), style: .plain, target: self, action: #selector(callTapped))
    item.accessibilityLabel = "Start call"
    return item
  }()
  @objc private func callTapped() { onThreadAction?("call") }

  @objc private func menuTapped() { onMenu?() }
  @objc private func backTapped() { onBack?() }
  @objc private func connectionTapped() { onConnectionTap?() }
  @objc private func newThreadTapped() { onNewThread?() }

  func setThreadListPresentation(sidebar: Bool, open: Bool) {
    menuItem?.image = UIImage(systemName: sidebar ? "sidebar.left" : "line.3.horizontal")
    menuItem?.accessibilityHint = open ? "Hides the thread list" : "Opens the thread list"
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
    if meta.canPin == true {
      items.append(UIAction(title: meta.pinned == true ? "Unpin thread" : "Pin thread", image: UIImage(systemName: meta.pinned == true ? "pin.slash" : "pin"), handler: send(meta.pinned == true ? "unpin" : "pin")))
    }
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
    NSLayoutConstraint.deactivate([webTopEdge, webTopSafe, webBottomEdge, webBottomComposer] + webHorizontal + workspaceConstraints)
    if dashboardVisible {
      if webView.superview !== dashboard.workspace { webView.removeFromSuperview(); dashboard.workspace.addSubview(webView) }
      NSLayoutConstraint.activate(workspaceConstraints)
    } else {
      if webView.superview !== view { webView.removeFromSuperview(); view.insertSubview(webView, at: 0) }
      NSLayoutConstraint.activate(webHorizontal)
      // Conversations: the web header is its own translucent blur, so the page starts at the very top, under the status bar and transparent bar.
      webTopEdge.isActive = !barVisible || floatingHeader
      webTopSafe.isActive = barVisible && !floatingHeader
      webBottomEdge.isActive = !composerVisible
      webBottomComposer.isActive = composerVisible
    }
    webView.scrollView.isScrollEnabled = !dashboardVisible
    dashboard.isHidden = !dashboardVisible
    composer.isHidden = !composerVisible
  }

  /// Conversations use a fully transparent bar (buttons float over the web header's blur) and hide the native title (the web pill shows it).
  private func applyBarStyle() {
    let bar = UINavigationBarAppearance()
    if floatingHeader { bar.configureWithTransparentBackground() } else { bar.configureWithDefaultBackground() }
    navigationItem.standardAppearance = bar
    navigationItem.scrollEdgeAppearance = bar
    navigationItem.titleView?.isHidden = floatingHeader
  }

  func apply(mode newMode: ShellMode, title: String?, placeholder: String?, back: Bool = false) {
    let modeChanged = mode != newMode
    if newMode != .dashboard { dashboard.cancelRecording() }
    mode = newMode
    if let title = title { if titleLabel.text != title { Motion.crossfade(titleLabel) { self.titleLabel.text = title } }; navigationItem.title = title; refreshAccessibility() }
    // New threads can begin a call before the first spoken message creates the thread.
    navigationItem.rightBarButtonItems = newMode == .conversation || newMode == .commander ? [actionsItem, callItem, newItem] : newMode == .new ? [callItem] : newMode == .dashboard ? [callItem] : []
    let left: UIBarButtonItem? = back ? backItem : (newMode == .project ? nil : menuItem)
    if navigationItem.leftBarButtonItem !== left { navigationItem.leftBarButtonItem = left }
    if let placeholder = placeholder { composer.placeholder = placeholder }
    if modeChanged {
      applyBarStyle()
      updateLayout()
      navigationController?.setNavigationBarHidden(!barVisible, animated: false)
      if !composerVisible { composer.cancelRecording(); _ = composer.resignFirstResponder() }
      view.layoutIfNeeded()
    }
  }

  func setComposerText(_ text: String, files: [AttachedFile]?) { composer.setText(text, files: files) }
  func appendComposerText(_ text: String, submit: Bool = false) { composer.appendText(text, submit: submit) }
  func setVoice(enabled: Bool, state: String?) { composer.setVoice(enabled: enabled, state: state); dashboard.setVoice(enabled) }
  func setDashboard(_ model: DashboardModel) {
    if model.expanded == true { dashboard.cancelRecording() }
    dashboard.apply(model)
    if officeExpanded != (model.expanded ?? false) { officeExpanded = model.expanded ?? false; updateLayout() }
  }

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


/// Transparent navigation bar that only captures touches on its buttons, so the web header's avatar (which overlaps the bar row) stays tappable.
final class PassthroughNavigationBar: UINavigationBar {
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    guard let hit = super.hitTest(point, with: event) else { return nil }
    var view: UIView? = hit
    while let current = view, current !== self {
      // The (hidden) title control spans the bar centre and would swallow taps meant for the web header's avatar.
      if String(describing: type(of: current)).contains("Title") { return nil }
      if current is UIControl || current.interactions.contains(where: { $0 is UIContextMenuInteraction }) { return hit }
      view = current.superview
    }
    return nil
  }
}
