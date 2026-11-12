import SwiftRs
import Tauri
import UIKit
import WebKit

struct SetModeArgs: Decodable {
  let mode: String
  var title: String?
  var placeholder: String?
  var openDrawer: Bool?
  var threadSheet: Bool?
  var back: Bool?
  var call: CallState?
}

struct SetDashboardArgs: Decodable { let model: DashboardModel }

struct SetThreadsArgs: Decodable {
  let model: ThreadsModel
}

struct SetThreadMetaArgs: Decodable {
  let meta: ThreadMeta
}

struct ThreadActionPayload: Encodable { let action: String }

struct SearchPayload: Encodable { let query: String }
struct SetFilterPayload: Encodable { let project: String; let status: String; let workspace: String? }
struct ViewPayload: Encodable { let view: String }
struct RecentPagePayload: Encodable { let action: String; var section: String? }
struct MoveProjectPayload: Encodable { let project: String; let target: String; let after: Bool }
struct ProjectPayload: Encodable { let project: String }
struct ThreadIdPayload: Encodable { let id: String }

struct SetConnectionArgs: Decodable {
  let state: String
  var message: String?
}

struct SetComposerTextArgs: Decodable {
  let text: String
  var files: [AttachedFile]?
}

struct DiscardFilesArgs: Decodable {
  let paths: [String]
}

struct PickOptionArgs: Decodable {
  let title: String
  let options: [PickerOption]
  var selected: String?
}

struct ComposerSendPayload: Encodable {
  let text: String
  let files: [AttachedFile]
}

struct SetVoiceArgs: Decodable {
  let enabled: Bool
  var state: String?
}

struct AppendComposerTextArgs: Decodable {
  let text: String
  var submit: Bool?
}

struct VoiceRecordedPayload: Encodable { let path: String; let durationMs: Int; let text: String; let files: [AttachedFile] }
struct VoiceErrorPayload: Encodable { let message: String }

struct EmptyPayload: Encodable {}

struct PresentPreviewArgs: Decodable { let url: String; let title: String }
struct PreviewStatusArgs: Decodable { let message: String; let error: Bool }

struct CallControlArgs: Decodable { let action: String; var text: String? }

class NativeShellPlugin: Plugin, UISheetPresentationControllerDelegate {
  private weak var sheetRoot: UIViewController?
  private var dashboardBackdrop: UIView?
  private var threadSheetOpen = false
  private var sheetDestinationReady = false
  private weak var shellWebView: WKWebView?

  private func attachShell(_ container: UIViewController, to root: UIViewController) {
    root.addChild(container)
    container.view.translatesAutoresizingMaskIntoConstraints = true
    container.view.frame = root.view.bounds
    container.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    root.view.addSubview(container.view)
    container.didMove(toParent: root)
  }

  private func openThreadSheet() {
    guard !threadSheetOpen, let container = container, let root = container.parent, root.presentedViewController == nil else { return }
    sheetDestinationReady = false
    sheetRoot = root
    dashboardBackdrop = root.view.snapshotView(afterScreenUpdates: false)
    dashboardBackdrop?.frame = root.view.bounds
    dashboardBackdrop?.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    if let backdrop = dashboardBackdrop { root.view.addSubview(backdrop) }
    container.willMove(toParent: nil)
    container.view.removeFromSuperview()
    container.removeFromParent()
    container.modalPresentationStyle = .pageSheet
    if let sheet = container.sheetPresentationController {
      sheet.detents = [.custom(identifier: .init("thread")) { $0.maximumDetentValue * 0.9 }]
      sheet.prefersEdgeAttachedInCompactHeight = true
      sheet.prefersGrabberVisible = true
      sheet.preferredCornerRadius = 24
      sheet.delegate = self
    }
    threadSheetOpen = true
    root.present(container, animated: true)
  }

  private func restoreShell() {
    guard threadSheetOpen, let container = container, let root = sheetRoot else { return }
    threadSheetOpen = false
    attachShell(container, to: root)
    root.view.layoutIfNeeded()
    if let backdrop = dashboardBackdrop { root.view.bringSubviewToFront(backdrop) }
    revealSheetDestination()
  }

  private func revealSheetDestination() {
    guard !threadSheetOpen, sheetDestinationReady, let backdrop = dashboardBackdrop else { return }
    // Wait for WebKit's restored dashboard frame before uncovering the native shell.
    shellWebView?.takeSnapshot(with: nil) { [weak self, weak backdrop] _, _ in
      guard let self, let backdrop, !self.threadSheetOpen, self.dashboardBackdrop === backdrop else { return }
      backdrop.removeFromSuperview()
      self.dashboardBackdrop = nil
    }
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    restoreShell()
    try? trigger("navBack", data: ProjectPayload(project: ""))
  }

  private let voiceCall = CompanionVoiceCall()
  @objc func callControl(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(CallControlArgs.self)
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { invoke.reject("Companion unavailable"); return }
      self.voiceCall.emit = { [weak self] event in try? self?.trigger("callEvent", data: event) }
      self.voiceCall.control(args.action, text: args.text) { error in
        if let error = error { invoke.reject(error) } else { invoke.resolve() }
      }
    }
  }

  private var shell: ShellViewController?
  private var container: DrawerContainerViewController?
  private var drawer: ThreadDrawerViewController?
  private var attempts = 0
  private var preview: PreviewViewController?

  @objc public override func load(webview: WKWebView) {
    DispatchQueue.main.async { [weak self] in self?.install(webview) }
  }

  /// Runs on the main queue. Retries briefly in case tao has not attached the root view controller yet.
  private func install(_ webview: WKWebView) {
    guard shell == nil else { return }
    guard let root = manager.viewController, root.isViewLoaded else {
      attempts += 1
      if attempts < 50 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in self?.install(webview) }
      }
      return
    }
    shellWebView = webview
    let shell = ShellViewController(webView: webview)
    shell.onDashboardAction = { [weak self] action in
      try? self?.trigger("dashboardAction", data: action)
    }
    shell.onSend = { [weak self] text, files in
      try? self?.trigger("composerSend", data: ComposerSendPayload(text: text, files: files))
    }
    shell.onVoiceRecorded = { [weak self] path, durationMs, text, files in
      try? self?.trigger("voiceRecorded", data: VoiceRecordedPayload(path: path, durationMs: durationMs, text: text, files: files))
    }
    shell.onVoiceError = { [weak self] message in
      try? self?.trigger("voiceError", data: VoiceErrorPayload(message: message))
    }
    shell.onConnectionTap = { [weak self] in
      try? self?.trigger("connectionTap", data: EmptyPayload())
    }
    shell.onThreadAction = { [weak self] action in
      try? self?.trigger("threadAction", data: ThreadActionPayload(action: action))
    }
    shell.onNewThread = { [weak self] in
      try? self?.trigger("newThread", data: ProjectPayload(project: ""))
      self?.drawer?.dismissKeyboard()
      self?.container?.dismissAfterSelection()
    }
    let nav = UINavigationController(navigationBarClass: PassthroughNavigationBar.self, toolbarClass: nil)
    nav.setViewControllers([shell], animated: false)
    nav.setNavigationBarHidden(true, animated: false)

    let drawer = ThreadDrawerViewController()
    let container = DrawerContainerViewController(content: nav, drawer: drawer)
    shell.onBack = { [weak self] in try? self?.trigger("navBack", data: ProjectPayload(project: "")) }
    shell.onMenu = { [weak container, weak drawer] in
      drawer?.refreshTimes()
      container?.toggleThreadList()
    }
    container.onOpenChange = { [weak drawer] open in if !open { drawer?.dismissKeyboard() } }
    container.onPresentationChange = { [weak shell, weak webview] sidebar, open in
      shell?.setThreadListPresentation(sidebar: sidebar, open: open)
      // The landscape sidebar reduces the webview width and can invert its CSS orientation.
      webview?.evaluateJavaScript("document.documentElement.dataset.companionSidebar = '\(sidebar)'", completionHandler: nil)
    }
    // Selecting, creating or paging only needs JS to change state; the drawer closes itself where appropriate.
    drawer.onDashboard = { [weak self, weak container, weak drawer] in
      drawer?.dismissKeyboard()
      try? self?.trigger("dashboard", data: ProjectPayload(project: ""))
      container?.setOpen(false, animated: true)
    }
    drawer.onSettings = { [weak self, weak container, weak drawer] in
      drawer?.dismissKeyboard()
      container?.setOpen(false, animated: true)
      try? self?.trigger("threadAction", data: ThreadActionPayload(action: "organization"))
    }
    drawer.onSelectThread = { [weak self, weak container, weak drawer] id in
      drawer?.dismissKeyboard()
      try? self?.trigger("selectThread", data: ThreadIdPayload(id: id))
      container?.dismissAfterSelection()
    }
    drawer.onNewThread = { [weak self, weak container, weak drawer] project in
      drawer?.dismissKeyboard()
      try? self?.trigger("newThread", data: ProjectPayload(project: project))
      container?.dismissAfterSelection()
    }
    drawer.onMoveProject = { [weak self] project, target, after in
      try? self?.trigger("moveProject", data: MoveProjectPayload(project: project, target: target, after: after))
    }
    drawer.onShowOlder = { [weak self] project in
      try? self?.trigger("showOlder", data: ProjectPayload(project: project))
    }
    drawer.onShowLess = { [weak self] project in
      try? self?.trigger("showLess", data: ProjectPayload(project: project))
    }
    drawer.onSetView = { [weak self] view in
      try? self?.trigger("setView", data: ViewPayload(view: view))
    }
    drawer.onRecentPage = { [weak self] action, bottom in
      try? self?.trigger("recentPage", data: RecentPagePayload(action: action, section: bottom ? "bottom" : nil))
    }
    drawer.onSearch = { [weak self] query in
      try? self?.trigger("search", data: SearchPayload(query: query))
    }
    drawer.onSetFilter = { [weak self, weak container] project, status, workspace in
      if workspace == "__manage_workspaces" { container?.dismissAfterSelection() }
      try? self?.trigger("setFilter", data: SetFilterPayload(project: project, status: status, workspace: workspace))
    }

    root.addChild(container)
    container.view.translatesAutoresizingMaskIntoConstraints = false
    root.view.addSubview(container.view)
    NSLayoutConstraint.activate([
      container.view.leadingAnchor.constraint(equalTo: root.view.leadingAnchor),
      container.view.trailingAnchor.constraint(equalTo: root.view.trailingAnchor),
      container.view.topAnchor.constraint(equalTo: root.view.topAnchor),
      container.view.bottomAnchor.constraint(equalTo: root.view.bottomAnchor),
    ])
    container.didMove(toParent: root)
    // The web view must not start scrolling before the drawer's left-edge gesture has had a chance to claim the touch.
    webview.scrollView.panGestureRecognizer.require(toFail: container.edgePanRecognizer)
    self.container = container
    self.drawer = drawer
    self.shell = shell
  }

  @objc func ping(_ invoke: Invoke) {
    DispatchQueue.main.async { [weak self] in
      invoke.resolve(["installed": self?.shell != nil, "nativeDashboardContent": true, "nativeVoiceCall": true, "newThreadSheet": true, "projectSheet": true])
    }
  }

  @objc func setMode(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetModeArgs.self)
    DispatchQueue.main.async { [weak self] in
      let mode: ShellMode = args.mode == "conversation" ? .conversation : args.mode == "commander" ? .commander : args.mode == "new" ? .new : args.mode == "project" ? .project : args.mode == "dashboard" ? .dashboard : args.mode == "callReview" ? .callReview : .other
      if args.threadSheet == true && (mode == .conversation || mode == .commander || mode == .new || mode == .project || mode == .callReview) { self?.openThreadSheet() }  // already open: openThreadSheet no-ops, so apply() below updates the sheet in place
      else if self?.threadSheetOpen == true, let container = self?.container {
        container.dismiss(animated: true) { [weak self] in self?.restoreShell() }
      }
      self?.shell?.apply(mode: mode, title: mode == .callReview ? "Review command" : args.title, placeholder: args.placeholder, back: args.back ?? false, threadSheet: args.threadSheet ?? false, call: args.call ?? .none)
      if args.threadSheet != true {
        self?.sheetDestinationReady = true
        self?.revealSheetDestination()
      }
      self?.container?.drawerEnabled = mode != .other && mode != .project && mode != .callReview && args.back != true
      if mode != .other, args.openDrawer == true {
        self?.drawer?.refreshTimes()
        self?.container?.setOpen(true, animated: true)
      }
      invoke.resolve()
    }
  }

  @objc func setConnection(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetConnectionArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.shell?.setConnection(state: args.state, message: args.message)
      self?.drawer?.setConnection(state: args.state, message: args.message)
      invoke.resolve()
    }
  }

  @objc func setThreads(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetThreadsArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.drawer?.apply(args.model)
      invoke.resolve()
    }
  }

  @objc func setDashboard(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetDashboardArgs.self)
    DispatchQueue.main.async { [weak self] in self?.shell?.setDashboard(args.model); invoke.resolve() }
  }

  @objc func setThreadMeta(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetThreadMetaArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.shell?.setThreadMeta(args.meta)
      invoke.resolve()
    }
  }

  @objc func setComposerText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetComposerTextArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.shell?.setComposerText(args.text, files: args.files)
      invoke.resolve()
    }
  }

  @objc func setVoice(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetVoiceArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.shell?.setVoice(enabled: args.enabled, state: args.state)
      invoke.resolve()
    }
  }

  @objc func appendComposerText(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(AppendComposerTextArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.shell?.appendComposerText(args.text, submit: args.submit ?? false)
      invoke.resolve()
    }
  }

  @objc func discardFiles(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(DiscardFilesArgs.self)
    DispatchQueue.global(qos: .utility).async {
      AttachmentStore.discard(args.paths)
      invoke.resolve()
    }
  }

  /// Resolves `{picked, id}` after the user chooses (or dismisses) the action sheet.
  @objc func presentPreview(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PresentPreviewArgs.self)
    DispatchQueue.main.async { [weak self] in
      guard let self else { invoke.reject("The native shell is not ready."); return }
      guard let url = URL(string: args.url), let host = url.host?.lowercased(), url.scheme?.lowercased() == "http", host == "127.0.0.1" || host == "localhost" else {
        invoke.reject("Preview URL must be http on 127.0.0.1: \(args.url)")
        return
      }
      if let preview = self.preview, preview.presentingViewController != nil {
        preview.update(url: url, title: args.title)
        invoke.resolve()
        return
      }
      guard var top = self.manager.viewController else { invoke.reject("The native shell is not ready."); return }
      while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
      let preview = PreviewViewController(url: url, title: args.title)
      preview.onDismissed = { [weak self, weak preview] in
        if self?.preview === preview { self?.preview = nil }
        try? self?.trigger("previewDismissed", data: [String: String]())
      }
      self.preview = preview
      top.present(preview, animated: true) { invoke.resolve() }
    }
  }

  @objc func previewStatus(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PreviewStatusArgs.self)
    DispatchQueue.main.async { [weak self] in
      self?.preview?.setStatus(message: args.message, error: args.error)
      invoke.resolve()
    }
  }

  @objc func pickOption(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PickOptionArgs.self)
    DispatchQueue.main.async { [weak self] in
      guard let shell = self?.shell else { invoke.reject("The native shell is not ready."); return }
      shell.presentPicker(title: args.title, options: args.options, selected: args.selected) { id in
        invoke.resolve(["picked": id != nil, "id": id ?? ""])
      }
    }
  }
}

@_cdecl("init_plugin_native_shell")
func initPlugin() -> Plugin {
  return NativeShellPlugin()
}
