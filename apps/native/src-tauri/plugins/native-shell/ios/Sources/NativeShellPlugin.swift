import SwiftRs
import Tauri
import UIKit
import WebKit

struct SetModeArgs: Decodable {
  let mode: String
  var title: String?
  var placeholder: String?
  var openDrawer: Bool?
}

struct SetThreadsArgs: Decodable {
  let model: ThreadsModel
}

struct SetThreadMetaArgs: Decodable {
  let meta: ThreadMeta
}

struct ThreadActionPayload: Encodable { let action: String }

struct SearchPayload: Encodable { let query: String }
struct SetFilterPayload: Encodable { let project: String; let status: String }
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

struct VoiceRecordedPayload: Encodable { let path: String; let durationMs: Int }
struct VoiceErrorPayload: Encodable { let message: String }

struct EmptyPayload: Encodable {}

class NativeShellPlugin: Plugin {
  private var shell: ShellViewController?
  private var container: DrawerContainerViewController?
  private var drawer: ThreadDrawerViewController?
  private var attempts = 0

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
    let shell = ShellViewController(webView: webview)
    shell.onSend = { [weak self] text, files in
      try? self?.trigger("composerSend", data: ComposerSendPayload(text: text, files: files))
    }
    shell.onVoiceRecorded = { [weak self] path, durationMs in
      try? self?.trigger("voiceRecorded", data: VoiceRecordedPayload(path: path, durationMs: durationMs))
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
    let nav = UINavigationController(rootViewController: shell)
    nav.setNavigationBarHidden(true, animated: false)

    let drawer = ThreadDrawerViewController()
    let container = DrawerContainerViewController(content: nav, drawer: drawer)
    shell.onMenu = { [weak container, weak drawer] in
      drawer?.refreshTimes()
      container?.toggleThreadList()
    }
    container.onOpenChange = { [weak drawer] open in if !open { drawer?.dismissKeyboard() } }
    container.onPresentationChange = { [weak shell] sidebar, open in
      shell?.setThreadListPresentation(sidebar: sidebar, open: open)
    }
    // Selecting, creating or paging only needs JS to change state; the drawer closes itself where appropriate.
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
    drawer.onShowOlder = { [weak self] project in
      try? self?.trigger("showOlder", data: ProjectPayload(project: project))
    }
    drawer.onSearch = { [weak self] query in
      try? self?.trigger("search", data: SearchPayload(query: query))
    }
    drawer.onSetFilter = { [weak self] project, status in
      try? self?.trigger("setFilter", data: SetFilterPayload(project: project, status: status))
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
      invoke.resolve(["installed": self?.shell != nil])
    }
  }

  @objc func setMode(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetModeArgs.self)
    DispatchQueue.main.async { [weak self] in
      let mode: ShellMode = args.mode == "conversation" ? .conversation : args.mode == "new" ? .new : .other
      self?.shell?.apply(mode: mode, title: args.title, placeholder: args.placeholder)
      self?.container?.drawerEnabled = mode != .other
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
