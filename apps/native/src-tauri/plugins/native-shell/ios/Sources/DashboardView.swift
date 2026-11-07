import UIKit
import AVFoundation

struct DashboardModel: Decodable {
  struct Project: Decodable {
    let id: String; let name: String; let color: String; let assistant: String
    let activity: String; let model: String; let canStart: Bool
  }
  struct Summary: Decodable {
    let date: String; let label: String; let text: String; let action: String?; let busy: Bool
  }
  /// Commander-in-Chief cluster shown above the project cards.
  struct Commander: Decodable {
    let id: String; let name: String
    let needsYou: Int; let running: Int; let doneToday: Int
  }
  var commander: Commander?
  var summaries: [Summary]?
  var schedules: Bool?
  var message: String?
  var expanded: Bool?
  let connected: Bool; let busy: Bool; let agent: String; let projects: [Project]
}
struct DashboardActionPayload: Encodable {
  let action: String
  var project: String = ""
  var assistant: String = ""
  var path: String? = nil
}

/// One native scroll surface; only the virtual workspace is embedded web content.
final class DashboardView: UIScrollView {
  var onAction: ((DashboardActionPayload) -> Void)?
  var onError: ((String) -> Void)?
  private let stack = UIStackView()
  let workspace = UIView()
  private var openSummaries: Set<String> = []
  private var model: DashboardModel?
  private var renderedColumns = 0
  private var voiceReady = false
  private let recorder = VoiceRecorder()
  private var active: DashboardModel.Project?
  private weak var mic: UIButton?
  private var pressing = false
  private var generation = 0
  private var awaitingTranscript = false
  private let feedback = UIImpactFeedbackGenerator(style: .medium)
  private var observers: [NSObjectProtocol] = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    accessibilityIdentifier = "dashboard-scroll"
    workspace.accessibilityIdentifier = "dashboard-workspace"
    workspace.heightAnchor.constraint(equalToConstant: 240).isActive = true
    alwaysBounceVertical = true
    delaysContentTouches = false
    stack.axis = .vertical; stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: contentLayoutGuide.leadingAnchor, constant: 16),
      stack.trailingAnchor.constraint(equalTo: contentLayoutGuide.trailingAnchor, constant: -16),
      stack.topAnchor.constraint(equalTo: contentLayoutGuide.topAnchor, constant: 12),
      stack.bottomAnchor.constraint(equalTo: contentLayoutGuide.bottomAnchor, constant: -24),
      stack.widthAnchor.constraint(equalTo: frameLayoutGuide.widthAnchor, constant: -32),
    ])
    recorder.onTick = { [weak self] seconds in self?.mic?.accessibilityValue = "Recording \(Int(seconds)) seconds" }
    recorder.onLimit = { [weak self] in self?.finish(cancel: false) }
    for name in [UIApplication.willResignActiveNotification, AVAudioSession.interruptionNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.cancelRecording() })
    }
  }
  override func touchesShouldCancel(in view: UIView) -> Bool {
    // Let vertical drags that begin on a plain button scroll the dashboard.
    // Active microphone holds explicitly disable the pan recognizer instead.
    view is UIControl || super.touchesShouldCancel(in: view)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }
  deinit { observers.forEach(NotificationCenter.default.removeObserver); recorder.cancel() }

  private var columns: Int {
    if traitCollection.preferredContentSizeCategory.isAccessibilityCategory { return 1 }
    let landscape = (window?.bounds.width ?? 0) > (window?.bounds.height ?? 0)
    return bounds.width >= 900 || (landscape && bounds.width >= 680) ? 3 : bounds.width >= 680 ? 2 : 1
  }
  override func layoutSubviews() {
    super.layoutSubviews()
    if !isHidden && active == nil && columns != renderedColumns { render() }
  }

  func apply(_ model: DashboardModel) {
    self.model = model
    awaitingTranscript = model.busy
    if !model.connected || (active != nil && !model.projects.contains(where: { $0.id == active?.id && $0.canStart })) { cancelRecording() }
    // Snapshot refreshes must never replace the button tracking the user's finger.
    if active == nil { render() }
  }
  func setVoice(_ enabled: Bool) {
    voiceReady = enabled
    if !enabled { cancelRecording() }
    if active == nil { render() }
  }
  func cancelRecording() { finish(cancel: true) }

  private func button(_ title: String?, symbol: String? = nil, action: @escaping () -> Void) -> UIButton {
    var config = UIButton.Configuration.plain(); config.title = title; config.baseForegroundColor = .label; config.titleLineBreakMode = .byWordWrapping
    config.image = symbol.flatMap { UIImage(systemName: $0) }; config.imagePadding = 8
    let button = UIButton(configuration: config)
    button.titleLabel?.adjustsFontForContentSizeCategory = true
    button.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true
    button.addAction(UIAction { _ in action() }, for: .touchUpInside)
    return button
  }
  private func render() {
    renderedColumns = columns
    stack.arrangedSubviews.forEach { $0.removeFromSuperview() }
    guard let model = model else { return }
    let heading = UILabel(); heading.text = "Your projects"; heading.font = .preferredFont(forTextStyle: .title2); heading.adjustsFontForContentSizeCategory = true
    stack.addArrangedSubview(workspace)
    if let commander = model.commander { stack.addArrangedSubview(commanderCluster(commander, model: model)) }
    if let message = model.message, !message.isEmpty {
      let status = UILabel(); status.text = message; status.numberOfLines = 0
      status.font = .preferredFont(forTextStyle: .subheadline); status.textColor = .systemRed
      stack.addArrangedSubview(status)
    }
    let header = UIStackView(arrangedSubviews: [heading]); header.alignment = .center; header.spacing = 8
    stack.addArrangedSubview(header)
    heading.setContentHuggingPriority(.defaultLow, for: .horizontal)
    let agent = button(model.agent, symbol: "chevron.down") { [weak self] in self?.onAction?(DashboardActionPayload(action: "agent")) }
    agent.accessibilityIdentifier = "dashboard-agent"
    agent.isEnabled = model.connected && !model.busy && !awaitingTranscript
    agent.configuration?.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 11)
    agent.titleLabel?.font = .preferredFont(forTextStyle: .caption1)
    agent.accessibilityLabel = "Coding agent: " + model.agent
    header.addArrangedSubview(agent)
    if !model.connected || model.projects.isEmpty || model.busy || awaitingTranscript {
      let status = UILabel(); status.numberOfLines = 0; status.font = .preferredFont(forTextStyle: .body)
      status.text = model.busy || awaitingTranscript ? "Transcribing…" : !model.connected ? "Connect to your Mac to start tasks." : "Your projects will appear here."
      stack.addArrangedSubview(status)
    }
    var gridRow: UIStackView?
    for (index, project) in model.projects.enumerated() {
      if index % renderedColumns == 0 {
        let row = UIStackView(); row.axis = .horizontal; row.spacing = 12; row.distribution = .fillEqually
        stack.addArrangedSubview(row); gridRow = row
      }
      let card = UIStackView(); card.axis = .vertical; card.spacing = 8
      card.isLayoutMarginsRelativeArrangement = true; card.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 14, leading: 14, bottom: 14, trailing: 14)
      card.backgroundColor = .secondarySystemBackground; card.layer.cornerRadius = 14
      let emit: (String) -> Void = { [weak self] action in self?.onAction?(DashboardActionPayload(action: action, project: project.id, assistant: project.assistant)) }
      let title = button(project.name, symbol: "folder") { emit("open") }
      title.configuration?.background.backgroundColor = .clear
      title.contentHorizontalAlignment = .leading
      let titleRow = UIStackView(arrangedSubviews: [title]); titleRow.alignment = .center; titleRow.spacing = 2
      title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      card.addArrangedSubview(titleRow)
      let activity = UILabel(); activity.text = project.activity; activity.numberOfLines = 0
      activity.font = .preferredFont(forTextStyle: .caption1); activity.textColor = .secondaryLabel; activity.adjustsFontForContentSizeCategory = true
      card.addArrangedSubview(activity)
      let create = button(nil, symbol: "plus") { emit("new") }
      create.accessibilityIdentifier = "dashboard-new-\(project.id)"; create.isEnabled = project.canStart && !awaitingTranscript
      create.accessibilityLabel = "New thread in " + project.name
      create.widthAnchor.constraint(equalToConstant: 44).isActive = true
      titleRow.addArrangedSubview(create)
      if !project.model.isEmpty {
        let modelButton = button(project.model, symbol: "slider.horizontal.3") { emit("model") }
        modelButton.accessibilityLabel = "Model for \(project.name): \(project.model)"; modelButton.isEnabled = create.isEnabled
        modelButton.contentHorizontalAlignment = .leading
        modelButton.configuration?.baseForegroundColor = .secondaryLabel
        modelButton.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0)
        card.addArrangedSubview(modelButton)
      }
      let mic = button(nil, symbol: "mic") {}
      mic.accessibilityLabel = "Dictate task in \(project.name)"
      mic.accessibilityHint = "Hold to record, release to transcribe into a draft. Move away to cancel."
      mic.accessibilityIdentifier = "dashboard-mic-\(project.id)"
      mic.isEnabled = create.isEnabled && voiceReady
      let hold = UILongPressGestureRecognizer(target: self, action: #selector(holdMic(_:)))
      hold.minimumPressDuration = 0.08; hold.allowableMovement = 40
      mic.addGestureRecognizer(hold)
      mic.addAction(UIAction { [weak self, weak mic] _ in
        guard UIAccessibility.isVoiceOverRunning, let self = self, let mic = mic else { return }
        if self.active != nil { self.finish(cancel: false) } else { self.begin(project, mic: mic) }
      }, for: .touchUpInside)
      mic.accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Cancel recording", actionHandler: { [weak self] _ in self?.cancelRecording(); return true })]
      mic.tag = model.projects.firstIndex(where: { $0.id == project.id }) ?? 0
      mic.widthAnchor.constraint(equalToConstant: 44).isActive = true
      titleRow.addArrangedSubview(mic)
      gridRow?.addArrangedSubview(card)
      if index == model.projects.count - 1 {
        for _ in 0..<((renderedColumns - model.projects.count % renderedColumns) % renderedColumns) { gridRow?.addArrangedSubview(UIView()) }
      }
    }
    if let summaries = model.summaries, !summaries.isEmpty {
      let title = UILabel(); title.text = "Daily summaries"; title.font = .preferredFont(forTextStyle: .headline)
      stack.addArrangedSubview(title)
      for (index, summary) in summaries.enumerated() {
        let expanded = openSummaries.contains(summary.date) || (index == 0 && !openSummaries.contains("closed:" + summary.date))
        let toggle = button(summary.label, symbol: expanded ? "chevron.down" : "chevron.right") { [weak self] in
          guard let self = self else { return }
          if expanded { self.openSummaries.remove(summary.date); self.openSummaries.insert("closed:" + summary.date) }
          else { self.openSummaries.insert(summary.date); self.openSummaries.remove("closed:" + summary.date) }
          self.render()
        }
        toggle.contentHorizontalAlignment = .leading
        toggle.accessibilityIdentifier = "dashboard-summary-" + summary.date
        toggle.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { attributes in
          var attributes = attributes; attributes.font = UIFont.preferredFont(forTextStyle: .subheadline); return attributes
        }
        toggle.configuration?.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 11, weight: .medium)
        toggle.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 8)
        let row = UIStackView(arrangedSubviews: [toggle]); row.alignment = .center
        toggle.setContentHuggingPriority(.defaultLow, for: .horizontal)
        if let action = summary.action {
          let generate = button(nil, symbol: "arrow.clockwise") { [weak self] in self?.onAction?(DashboardActionPayload(action: "summary", project: summary.date)) }
          generate.accessibilityLabel = action + " " + summary.label + " summary"
          generate.accessibilityIdentifier = "dashboard-summary-action-" + summary.date
          generate.configuration?.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 15, weight: .regular)
          generate.configuration?.baseForegroundColor = .secondaryLabel
          generate.widthAnchor.constraint(equalToConstant: 44).isActive = true
          generate.isEnabled = model.connected && !summary.busy
          row.addArrangedSubview(generate)
        }
        stack.addArrangedSubview(row)
        if expanded {
          let body = UILabel(); body.numberOfLines = 0; body.text = summary.text
          body.font = .preferredFont(forTextStyle: .subheadline); body.adjustsFontForContentSizeCategory = true
          body.textColor = .secondaryLabel; body.accessibilityIdentifier = "dashboard-summary-body"
          stack.addArrangedSubview(body)
        }
      }
    }
    if model.schedules == true {
      stack.addArrangedSubview(button("Schedules", symbol: "calendar") { [weak self] in self?.onAction?(DashboardActionPayload(action: "schedules")) })
    }
    if !voiceReady {
      let note = UILabel(); note.text = "Enable voice dictation and prepare its model on your Mac to use the microphone."; note.numberOfLines = 0; note.font = .preferredFont(forTextStyle: .caption1); note.textColor = .secondaryLabel
      stack.addArrangedSubview(note)
    }
  }
  /// The Commander avatar (idle breathing; still under Reduce Motion), a mic circle at its bottom-left, a plus circle at its bottom-right and the status pill.
  private func commanderCluster(_ commander: DashboardModel.Commander, model: DashboardModel) -> UIView {
    let enabled = model.connected && !model.busy && !awaitingTranscript
    let size: CGFloat = 96, circle: CGFloat = 44
    let host = UIView(); host.accessibilityIdentifier = "dashboard-commander"
    let open: () -> Void = { [weak self] in self?.onAction?(DashboardActionPayload(action: "commander", project: commander.id)) }

    let avatar = UIButton(type: .custom)
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.backgroundColor = .secondarySystemBackground
    avatar.layer.cornerRadius = size / 2; avatar.layer.borderWidth = 1; avatar.layer.borderColor = UIColor.separator.cgColor
    avatar.layer.shadowColor = UIColor.black.cgColor; avatar.layer.shadowOpacity = 0.12; avatar.layer.shadowRadius = 10; avatar.layer.shadowOffset = CGSize(width: 0, height: 4)
    avatar.accessibilityLabel = "Open \(commander.name)"; avatar.accessibilityIdentifier = "dashboard-commander-avatar"
    avatar.accessibilityValue = "\(commander.needsYou) needs you, \(commander.running) running, \(commander.doneToday) done"
    avatar.addAction(UIAction { _ in open() }, for: .touchUpInside)
    let art = UIImageView(image: MascotImage.largeImage)
    art.translatesAutoresizingMaskIntoConstraints = false; art.contentMode = .scaleAspectFit; art.isUserInteractionEnabled = false
    avatar.addSubview(art)
    if !UIAccessibility.isReduceMotionEnabled {
      let breathe = CABasicAnimation(keyPath: "transform.scale")
      breathe.fromValue = 1.0; breathe.toValue = 1.04; breathe.autoreverses = true; breathe.repeatCount = .infinity
      breathe.duration = commander.running > 0 ? 0.7 : 2.1; breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
      art.layer.add(breathe, forKey: "commander-breathe")
    }
    if commander.running > 0 { avatar.layer.borderColor = UIColor.systemBlue.cgColor; avatar.layer.borderWidth = 2 }

    func round(_ symbol: String, id: String, label: String) -> UIButton {
      var config = UIButton.Configuration.plain(); config.image = UIImage(systemName: symbol); config.baseForegroundColor = .label
      let b = UIButton(configuration: config)
      b.translatesAutoresizingMaskIntoConstraints = false
      b.backgroundColor = .systemBackground; b.layer.cornerRadius = circle / 2; b.layer.borderWidth = 1; b.layer.borderColor = UIColor.separator.cgColor
      b.layer.shadowColor = UIColor.black.cgColor; b.layer.shadowOpacity = 0.14; b.layer.shadowRadius = 5; b.layer.shadowOffset = CGSize(width: 0, height: 2)
      b.accessibilityIdentifier = id; b.accessibilityLabel = label
      return b
    }
    let mic = round("mic", id: "dashboard-commander-mic", label: "Dictate to \(commander.name)")
    mic.accessibilityHint = "Hold to record, release to transcribe into a draft. Move away to cancel."
    mic.isEnabled = enabled && voiceReady
    let hold = UILongPressGestureRecognizer(target: self, action: #selector(holdMic(_:)))
    hold.minimumPressDuration = 0.08; hold.allowableMovement = 40
    mic.addGestureRecognizer(hold)
    mic.addAction(UIAction { [weak self, weak mic] _ in
      guard UIAccessibility.isVoiceOverRunning, let self = self, let mic = mic else { return }
      if self.active != nil { self.finish(cancel: false) } else { self.begin(self.commanderProject(commander), mic: mic) }
    }, for: .touchUpInside)
    mic.accessibilityCustomActions = [UIAccessibilityCustomAction(name: "Cancel recording", actionHandler: { [weak self] _ in self?.cancelRecording(); return true })]
    mic.tag = Self.commanderMicTag
    let plus = round("plus", id: "dashboard-commander-plus", label: "Message \(commander.name)")
    plus.isEnabled = model.connected && !model.busy
    plus.addAction(UIAction { _ in open() }, for: .touchUpInside)

    let name = UILabel(); name.text = commander.name; name.font = UIFont.preferredFont(forTextStyle: .subheadline); name.adjustsFontForContentSizeCategory = true
    name.textAlignment = .center
    var pillConfig = UIButton.Configuration.tinted(); pillConfig.cornerStyle = .capsule
    pillConfig.title = "\(commander.needsYou) needs you · \(commander.running) running · \(commander.doneToday) done"
    pillConfig.baseForegroundColor = commander.needsYou > 0 ? .systemOrange : .secondaryLabel
    pillConfig.baseBackgroundColor = commander.needsYou > 0 ? .systemOrange : .systemGray
    pillConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { var a = $0; a.font = UIFont.preferredFont(forTextStyle: .caption1); return a }
    let pill = UIButton(configuration: pillConfig)
    pill.accessibilityIdentifier = "dashboard-commander-pill"
    pill.accessibilityLabel = "\(commander.name) status: \(commander.needsYou) needs you, \(commander.running) running, \(commander.doneToday) done"
    pill.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    pill.addAction(UIAction { _ in open() }, for: .touchUpInside)

    for view in [avatar, mic, plus, name, pill] as [UIView] { view.translatesAutoresizingMaskIntoConstraints = false; host.addSubview(view) }
    NSLayoutConstraint.activate([
      avatar.topAnchor.constraint(equalTo: host.topAnchor, constant: 4),
      avatar.centerXAnchor.constraint(equalTo: host.centerXAnchor),
      avatar.widthAnchor.constraint(equalToConstant: size), avatar.heightAnchor.constraint(equalToConstant: size),
      art.centerXAnchor.constraint(equalTo: avatar.centerXAnchor), art.centerYAnchor.constraint(equalTo: avatar.centerYAnchor),
      art.widthAnchor.constraint(equalToConstant: size - 18), art.heightAnchor.constraint(equalToConstant: size - 18),
      // Overlap the avatar's bottom-left and bottom-right edges.
      mic.widthAnchor.constraint(equalToConstant: circle), mic.heightAnchor.constraint(equalToConstant: circle),
      mic.centerXAnchor.constraint(equalTo: avatar.leadingAnchor, constant: size * 0.16),
      mic.centerYAnchor.constraint(equalTo: avatar.bottomAnchor, constant: -size * 0.1),
      plus.widthAnchor.constraint(equalToConstant: circle), plus.heightAnchor.constraint(equalToConstant: circle),
      plus.centerXAnchor.constraint(equalTo: avatar.trailingAnchor, constant: -size * 0.16),
      plus.centerYAnchor.constraint(equalTo: avatar.bottomAnchor, constant: -size * 0.1),
      name.topAnchor.constraint(equalTo: avatar.bottomAnchor, constant: 14),
      name.leadingAnchor.constraint(equalTo: host.leadingAnchor), name.trailingAnchor.constraint(equalTo: host.trailingAnchor),
      pill.topAnchor.constraint(equalTo: name.bottomAnchor, constant: 4),
      pill.centerXAnchor.constraint(equalTo: host.centerXAnchor),
      pill.bottomAnchor.constraint(equalTo: host.bottomAnchor, constant: -4),
    ])
    avatar.isEnabled = true
    return host
  }
  private static let commanderMicTag = -1
  private func commanderProject(_ commander: DashboardModel.Commander) -> DashboardModel.Project {
    DashboardModel.Project(id: commander.id, name: commander.name, color: "", assistant: "", activity: "", model: "", canStart: true)
  }

  @objc private func holdMic(_ gesture: UILongPressGestureRecognizer) {
    guard let button = gesture.view as? UIButton else { return }
    switch gesture.state {
    case .began:
      guard let model = model else { return }
      if button.tag == Self.commanderMicTag, let commander = model.commander { begin(commanderProject(commander), mic: button); return }
      guard model.projects.indices.contains(button.tag) else { return }
      begin(model.projects[button.tag], mic: button)
    case .changed:
      if !button.bounds.insetBy(dx: -32, dy: -32).contains(gesture.location(in: button)) { finish(cancel: true) }
    case .ended: finish(cancel: false)
    case .cancelled, .failed: finish(cancel: true)
    default: break
    }
  }
  private func begin(_ project: DashboardModel.Project, mic: UIButton) {
    guard active == nil, voiceReady, project.canStart, !awaitingTranscript else { return }
    active = project; self.mic = mic; pressing = true; generation += 1
    let token = generation; feedback.prepare()
    func disableOthers(_ view: UIView) {
      if let button = view as? UIButton, button !== mic { button.isEnabled = false }
      view.subviews.forEach(disableOthers)
    }
    disableOthers(stack)
    VoiceRecorder.requestPermission { [weak self] allowed in
      guard let self = self, self.pressing, self.generation == token else { return }
      guard allowed else { self.finish(cancel: true); self.onError?(VoiceRecorder.deniedMessage); return }
      do {
        try self.recorder.start(); self.feedback.impactOccurred()
        mic.configuration?.image = UIImage(systemName: "mic.fill"); mic.accessibilityValue = "Recording"; mic.configuration?.baseForegroundColor = .systemRed
        self.panGestureRecognizer.isEnabled = false
        UIAccessibility.post(notification: .announcement, argument: "Recording. Release to transcribe.")
      } catch { self.finish(cancel: true); self.onError?(error.localizedDescription) }
    }
  }
  private func finish(cancel: Bool) {
    guard let project = active else { return }
    generation += 1; pressing = false; active = nil; panGestureRecognizer.isEnabled = true
    if cancel { recorder.cancel() } else if let result = recorder.stop() {
      awaitingTranscript = true
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      onAction?(DashboardActionPayload(action: "voice", project: project.id, assistant: project.assistant, path: result.url.path))
    }
    render()
  }
}
