import UIKit
import AVFoundation

struct DashboardModel: Decodable {
  struct RecentThread: Decodable { let id: String; let title: String; var status: String? = nil; var unread: Bool? = nil }
  struct Project: Decodable {
    let id: String; let name: String; let color: String; let assistant: String
    let activity: String; let model: String; let canStart: Bool
    var recent: [RecentThread]? = nil
  }
  struct ProjectGroup: Decodable { let id: String; let name: String?; let projects: [String] }
  var projectGroups: [ProjectGroup]?
  struct Summary: Decodable {
    let date: String; let label: String; let text: String; let action: String?; let busy: Bool
  }
  /// Commander-in-Chief cluster shown above the project cards.
  struct Commander: Decodable {
    let id: String; let name: String
    let needsYou: Int; let running: Int; let doneToday: Int

    private enum CodingKeys: String, CodingKey { case id, name, needsYou, running, doneToday }
    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      id = try values.decode(String.self, forKey: .id)
      name = try values.decode(String.self, forKey: .name)
      // Counts can be absent/null while an older paired host refreshes its state.
      needsYou = try values.decodeIfPresent(Int.self, forKey: .needsYou) ?? 0
      running = try values.decodeIfPresent(Int.self, forKey: .running) ?? 0
      doneToday = try values.decodeIfPresent(Int.self, forKey: .doneToday) ?? 0
    }
  }
  var commander: Commander?
  var model: String?
  var difficulty: String?
  var hasControls: Bool?
  var workspaceName: String?
  private enum CodingKeys: String, CodingKey { case model, difficulty, hasControls, projectGroups, commander, summaries, schedules, message, expanded, workspaceHeight, connected, busy, agent, projects; case workspaceName = "workspace" }
  var summaries: [Summary]?
  var schedules: Bool?
  var message: String?
  var workspaceHeight: Double?
  var expanded: Bool?
  let connected: Bool; let busy: Bool; let agent: String; let projects: [Project]
}
struct DashboardActionPayload: Encodable {
  let action: String
  var project: String = ""
  var assistant: String = ""
  var thread: String? = nil
  var path: String? = nil
  /// `true` = transcribe and send as a new task, staying on the dashboard.
  var send: Bool? = nil
}

/// Microphone-anchored recording surface for the dashboard. Mirrors the composer: waveform capsule with
/// an X at its leading edge and a send cue that grows as the finger slides up.
final class DashboardRecordingBar: UIView {
  let destination = UILabel()
  let pill = RecordingStatusLabel()
  let cancelButton = UIButton(type: .system)
  let sendCue = UIButton(type: .system)
  private(set) var presented = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    accessibilityIdentifier = "dashboard-recording-bar"
    backgroundColor = .clear
    layer.shadowColor = UIColor.black.cgColor; layer.shadowOpacity = 0.12; layer.shadowRadius = 10; layer.shadowOffset = CGSize(width: 0, height: -2)
    isHidden = true; alpha = 0
    destination.font = .preferredFont(forTextStyle: .caption1); destination.adjustsFontForContentSizeCategory = true
    destination.textColor = .secondaryLabel; destination.textAlignment = .center
    destination.accessibilityIdentifier = "dashboard-recording-destination"
    pill.textAlignment = .center; pill.numberOfLines = 1
    pill.font = UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: .monospacedDigitSystemFont(ofSize: 13, weight: .regular))
    pill.adjustsFontForContentSizeCategory = true; pill.textColor = .label
    pill.isUserInteractionEnabled = false; pill.showWaveform = true; pill.text = "0:00"
    cancelButton.setImage(UIImage(systemName: "xmark"), for: .normal)
    cancelButton.accessibilityLabel = "Cancel recording"; cancelButton.accessibilityIdentifier = "recording-cancel"
    cancelButton.layer.cornerRadius = 22
    sendCue.setImage(UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .semibold)), for: .normal)
    sendCue.accessibilityLabel = "Send recording"; sendCue.accessibilityIdentifier = "recording-send-cue"
    sendCue.layer.cornerRadius = 22
    sendCue.layer.shadowColor = UIColor.black.cgColor; sendCue.layer.shadowOpacity = 0.12; sendCue.layer.shadowRadius = 8; sendCue.layer.shadowOffset = CGSize(width: 0, height: 3)
    for view in [destination, pill, cancelButton, sendCue] as [UIView] { view.translatesAutoresizingMaskIntoConstraints = false; addSubview(view) }
    NSLayoutConstraint.activate([
      destination.bottomAnchor.constraint(equalTo: pill.topAnchor, constant: -8),
      destination.leadingAnchor.constraint(equalTo: pill.leadingAnchor), destination.trailingAnchor.constraint(equalTo: pill.trailingAnchor),
      pill.bottomAnchor.constraint(equalTo: safeAreaLayoutGuide.bottomAnchor, constant: -12),
      pill.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16),
      pill.widthAnchor.constraint(equalToConstant: 224),
      pill.heightAnchor.constraint(equalToConstant: 44),
      cancelButton.leadingAnchor.constraint(equalTo: pill.leadingAnchor), cancelButton.centerYAnchor.constraint(equalTo: pill.centerYAnchor),
      cancelButton.widthAnchor.constraint(equalToConstant: 44), cancelButton.heightAnchor.constraint(equalToConstant: 44),
      sendCue.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -16), sendCue.bottomAnchor.constraint(equalTo: pill.topAnchor, constant: -20),
      sendCue.widthAnchor.constraint(equalToConstant: 44), sendCue.heightAnchor.constraint(equalToConstant: 44),
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }

  /// Height without the bottom safe area.
  static let contentHeight: CGFloat = 132

  private var followLifted: [UIView] = []
  private var cancelLifted: [UIView] = []
  func update(active: Bool, destination name: String, sendProgress: CGFloat = 0, cancelProgress: CGFloat = 0, fingerInWindow finger: CGPoint? = nil) {
    destination.text = "To " + name
    pill.showWaveform = active; pill.setNeedsDisplay()
    let accent = tintColor.resolvedColor(with: traitCollection)
    sendCue.backgroundColor = UIColor.secondarySystemGroupedBackground.mixed(with: accent, amount: max(0, min(1, sendProgress)))
    sendCue.tintColor = UIColor.label.mixed(with: .white, amount: max(0, min(1, sendProgress)))
    let send = max(0, min(1, sendProgress)), scale = 1 + send
    let cancel = active ? max(0, min(1, cancelProgress)) : 0
    if active && !Motion.reduced && finger != nil && send > 0 && cancel == 0, let finger = finger {
      followLifted = RecordingSwipe.liftForFollow(sendCue, already: followLifted)
      let t = RecordingSwipe.followTranslation(for: sendCue, fingerInWindow: finger, sendProgress: send)
      let railScale = RecordingSwipe.followScale(for: sendCue, progress: send)
      sendCue.transform = CGAffineTransform(translationX: t.x, y: t.y).scaledBy(x: railScale, y: railScale)
    } else {
      if !followLifted.isEmpty { RecordingSwipe.restoreAfterFollow(sendCue, lifted: followLifted); followLifted = [] }
      sendCue.transform = CGAffineTransform(translationX: 0, y: Motion.reduced ? 0 : -8 * send).scaledBy(x: scale, y: scale)
    }
    cancelButton.tintColor = UIColor.label.resolvedColor(with: traitCollection).mixed(with: UIColor.systemRed.resolvedColor(with: traitCollection), amount: cancel)
    cancelButton.backgroundColor = UIColor.systemRed.withAlphaComponent(0.15 * cancel)
    if active && !Motion.reduced && cancel > 0, let finger = finger {
      cancelLifted = RecordingSwipe.liftForFollow(cancelButton, already: cancelLifted)
      let t = RecordingSwipe.followTranslation(for: cancelButton, fingerInWindow: finger, sendProgress: cancel, axis: .horizontal)
      cancelButton.transform = CGAffineTransform(translationX: t.x, y: t.y).scaledBy(x: 1 + 0.5 * cancel, y: 1 + 0.5 * cancel)
    } else {
      RecordingSwipe.restoreAfterFollow(cancelButton, lifted: cancelLifted); cancelLifted = []
      cancelButton.transform = CGAffineTransform(scaleX: 1 + 0.5 * cancel, y: 1 + 0.5 * cancel)
    }
    guard presented != active else { return }
    presented = active
    if active {
      isHidden = false
      if !Motion.reduced { transform = CGAffineTransform(translationX: 0, y: 40) }
      Motion.animate { self.alpha = 1; self.transform = .identity }
    } else {
      Motion.animate({ self.alpha = 0; self.transform = .identity }, completion: { [weak self] _ in
        guard let self = self, !self.presented else { return }
        self.isHidden = true
      })
    }
  }
  func tick(elapsed: TimeInterval, level: CGFloat) {
    let total = Int(elapsed)
    pill.text = String(format: "%d:%02d", total / 60, total % 60)
    pill.elapsed = elapsed; pill.level = level; pill.setNeedsDisplay()
  }
}

/// Rounded translucent card with a hairline border; content is pinned to the top by its owner.
final class DashboardCardView: UIView {
  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.045) : UIColor(white: 0, alpha: 0.035) }
    layer.cornerRadius = 12; layer.cornerCurve = .continuous
    accessibilityIdentifier = "dashboard-card"
    updateBorder()
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) unsupported") }
  private func updateBorder() {
    let border = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.08) : UIColor(white: 0, alpha: 0.08) }
    layer.borderColor = border.resolvedColor(with: traitCollection).cgColor
    layer.borderWidth = 1 / max(traitCollection.displayScale, 1)
  }
  override func traitCollectionDidChange(_ previous: UITraitCollection?) { super.traitCollectionDidChange(previous); updateBorder() }
}

/// One native scroll surface; only the virtual workspace is embedded web content.
final class DashboardView: UIScrollView {
  var onAction: ((DashboardActionPayload) -> Void)?
  var onError: ((String) -> Void)?
  private let stack = UIStackView()
  let workspace = UIView()
  private var workspaceHeight: NSLayoutConstraint!
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
  private let bar = DashboardRecordingBar()
  private weak var recordingAnchor: UIView?
  private var recording = false
  private var downAt: TimeInterval = 0
  private var micOrigin = CGPoint.zero
  private var sendArmed = false, cancelArmed = false
  private var sendProgress: CGFloat = 0, cancelProgress: CGFloat = 0
  private let feedback = UIImpactFeedbackGenerator(style: .medium)
  private var observers: [NSObjectProtocol] = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    accessibilityIdentifier = "dashboard-scroll"
    workspace.accessibilityIdentifier = "dashboard-workspace"
    workspaceHeight = workspace.heightAnchor.constraint(equalToConstant: 240)
    workspaceHeight.isActive = true
    alwaysBounceVertical = true
    delaysContentTouches = false
    stack.axis = .vertical; stack.spacing = 12
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: contentLayoutGuide.leadingAnchor, constant: 20),
      stack.trailingAnchor.constraint(equalTo: contentLayoutGuide.trailingAnchor, constant: -20),
      stack.topAnchor.constraint(equalTo: contentLayoutGuide.topAnchor, constant: 16),
      stack.bottomAnchor.constraint(equalTo: contentLayoutGuide.bottomAnchor, constant: -24),
      stack.widthAnchor.constraint(equalTo: frameLayoutGuide.widthAnchor, constant: -40),
    ])
    addSubview(bar)
    bar.cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
    bar.sendCue.addTarget(self, action: #selector(sendTapped), for: .touchUpInside)
    recorder.onTick = { [weak self] seconds in
      guard let self = self, self.recording else { return }
      self.mic?.accessibilityValue = "\(Int(seconds)) seconds — " + (self.pressing ? "Release to send" : "Tap Send or Cancel")
      self.bar.tick(elapsed: seconds, level: self.recorder.level)
    }
    recorder.onLimit = { [weak self] in self?.finish(cancel: false) }
    for name in [UIApplication.willResignActiveNotification, AVAudioSession.interruptionNotification] {
      observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in self?.cancelRecording() })
    }
  }
  @objc private func cancelTapped() { cancelRecording() }
  @objc private func sendTapped() { finish(cancel: false) }
  override func layoutSubviews() {
    // The web map reports its aspect-correct height, including its controls.
    let workspaceTargetHeight = CGFloat(model?.workspaceHeight ?? 240)
    if workspaceHeight.constant != workspaceTargetHeight { workspaceHeight.constant = workspaceTargetHeight }
    super.layoutSubviews()
    if !isHidden && active == nil && columns != renderedColumns { render() }
    let height = DashboardRecordingBar.contentHeight
    if let anchor = recordingAnchor {
      let rect = anchor.convert(anchor.bounds, to: self)
      let width = min(256, bounds.width)
      let x = min(max(bounds.minX, rect.midX - width + 38), bounds.maxX - width)
      let y = max(bounds.minY + safeAreaInsets.top, rect.minY - height - 8)
      bar.frame = CGRect(x: x, y: y, width: width, height: height)
    } else {
      let height = height + safeAreaInsets.bottom
      bar.frame = CGRect(x: bounds.minX, y: bounds.maxY - height, width: bounds.width, height: height)
    }
    bringSubviewToFront(bar)
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
    return bounds.width >= 900 || (landscape && bounds.width >= 680) ? 3 : bounds.width >= 320 ? 2 : 1
  }

  func apply(_ model: DashboardModel) {
    self.model = model
    setNeedsLayout()
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
    if let commander = model.commander { stack.addArrangedSubview(commanderCluster(commander, model: model)) }
    let workspaceRow = UIView()
    workspaceRow.addSubview(workspace)
    workspace.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      workspace.leadingAnchor.constraint(equalTo: workspaceRow.leadingAnchor, constant: -20),
      workspace.trailingAnchor.constraint(equalTo: workspaceRow.trailingAnchor, constant: 20),
      workspace.topAnchor.constraint(equalTo: workspaceRow.topAnchor),
      workspace.bottomAnchor.constraint(equalTo: workspaceRow.bottomAnchor),
    ])
    stack.addArrangedSubview(workspaceRow)
    if let message = model.message, !message.isEmpty {
      let status = UILabel(); status.text = message; status.numberOfLines = 0
      status.font = .preferredFont(forTextStyle: .subheadline); status.textColor = .systemRed
      stack.addArrangedSubview(status)
    }
    let header = UIStackView(arrangedSubviews: [heading]); header.alignment = .center; header.spacing = 8
    stack.addArrangedSubview(header)
    heading.setContentHuggingPriority(.defaultLow, for: .horizontal)
    func picker(_ title: String, label: String, id: String, action: String) -> UIButton {
      var config = UIButton.Configuration.plain()
      config.title = title; config.image = UIImage(systemName: "chevron.down")
      config.imagePlacement = .trailing; config.imagePadding = 6
      config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 9, weight: .medium)
      config.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 9, bottom: 6, trailing: 9)
      config.titleLineBreakMode = .byTruncatingTail; config.baseForegroundColor = .label
      config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { var a = $0; a.font = Self.scaled(12, .regular, .caption1); return a }
      config.background.backgroundColor = .secondarySystemGroupedBackground
      config.background.strokeColor = .separator; config.background.strokeWidth = 0.5
      config.background.cornerRadius = 6; config.background.backgroundInsets = NSDirectionalEdgeInsets(top: 6, leading: 0, bottom: 6, trailing: 0)
      let control = UIButton(configuration: config)
      control.setContentHuggingPriority(.required, for: .horizontal)
      control.accessibilityIdentifier = id; control.accessibilityLabel = label
      control.isEnabled = model.connected && !model.busy && !awaitingTranscript
      control.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
      control.widthAnchor.constraint(lessThanOrEqualToConstant: 180).isActive = true
      control.addAction(UIAction { [weak self] _ in self?.onAction?(DashboardActionPayload(action: action)) }, for: .touchUpInside)
      return control
    }
    let agent = picker(model.agent, label: "Provider: " + model.agent, id: "dashboard-agent", action: "agent")
    let defaults = UIStackView(arrangedSubviews: [agent]); defaults.axis = .horizontal; defaults.alignment = .center; defaults.spacing = 6
    defaults.accessibilityIdentifier = "dashboard-launch-controls"
    if model.hasControls == true {
      defaults.addArrangedSubview(picker(model.model ?? "Model default", label: "Model: " + (model.model ?? "Model default"), id: "dashboard-model", action: "dashboard-model"))
      defaults.addArrangedSubview(picker(model.difficulty ?? "Difficulty default", label: "Difficulty: " + (model.difficulty ?? "Difficulty default"), id: "dashboard-difficulty", action: "dashboard-effort"))
    }
    let wide = bounds.width >= 620 && !traitCollection.preferredContentSizeCategory.isAccessibilityCategory
    if wide {
      defaults.setContentHuggingPriority(.required, for: .horizontal)
      header.addArrangedSubview(defaults)
    } else {
      defaults.distribution = .fillEqually
      stack.addArrangedSubview(defaults)
    }
    if !model.connected || model.projects.isEmpty || model.busy || awaitingTranscript {
      let status = UILabel(); status.numberOfLines = 0; status.font = .preferredFont(forTextStyle: .body)
      status.text = model.busy || awaitingTranscript ? "Transcribing…" : !model.connected ? "Connect to your Mac to start tasks." : "Your projects will appear here."
      stack.addArrangedSubview(status)
    }
    let groups = model.projectGroups ?? [DashboardModel.ProjectGroup(id: "", name: nil, projects: model.projects.map { $0.id })]
    for group in groups {
      let projects = group.projects.compactMap { id in model.projects.first { $0.id == id } }
      guard !projects.isEmpty else { continue }
      if let name = group.name {
        // Quiet section label: 13 pt semibold, secondary colour, 24 pt above and 8 pt below.
        if let last = stack.arrangedSubviews.last { stack.setCustomSpacing(24, after: last) }
        let heading = UILabel()
        heading.attributedText = NSAttributedString(string: name.uppercased(), attributes: [.font: Self.scaled(13, .semibold, .footnote), .foregroundColor: UIColor.secondaryLabel, .kern: 0.5])
        heading.accessibilityLabel = name; heading.accessibilityTraits = .header
        stack.addArrangedSubview(heading); stack.setCustomSpacing(8, after: heading)
      }
      var gridRow: UIStackView?
      for (index, project) in projects.enumerated() {
        if index % renderedColumns == 0 {
          let row = UIStackView(); row.axis = .horizontal; row.spacing = 12; row.distribution = .fillEqually
          stack.addArrangedSubview(row); gridRow = row
        }
        gridRow?.addArrangedSubview(projectCard(project, model: model))
        if index == projects.count - 1 {
          for _ in 0..<((renderedColumns - projects.count % renderedColumns) % renderedColumns) { gridRow?.addArrangedSubview(UIView()) }
        }
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
  // MARK: Project cards

  static func scaled(_ size: CGFloat, _ weight: UIFont.Weight, _ style: UIFont.TextStyle) -> UIFont {
    UIFontMetrics(forTextStyle: style).scaledFont(for: .systemFont(ofSize: size, weight: weight))
  }
  private static func color(hex raw: String) -> UIColor? {
    var hex = raw.trimmingCharacters(in: .whitespaces)
    if hex.hasPrefix("#") { hex.removeFirst() }
    if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
    guard hex.count == 6, let value = UInt32(hex, radix: 16) else { return nil }
    return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255, blue: CGFloat(value & 255) / 255, alpha: 1)
  }
  private static let rowHighlight = UIColor { $0.userInterfaceStyle == .dark ? UIColor(white: 1, alpha: 0.08) : UIColor(white: 0, alpha: 0.06) }

  private func iconButton(_ symbol: String) -> UIButton {
    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 17, weight: .regular))
    config.baseForegroundColor = .secondaryLabel
    config.contentInsets = .zero
    let button = UIButton(configuration: config)
    button.contentHorizontalAlignment = .center; button.contentVerticalAlignment = .center
    button.widthAnchor.constraint(equalToConstant: 44).isActive = true
    button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    return button
  }

  /// Header row (dot, name, + and mic) over a top-aligned list of thread rows. The name takes the project colour.
  private func projectCard(_ project: DashboardModel.Project, model: DashboardModel) -> UIView {
    let card = DashboardCardView()
    let emit: (String) -> Void = { [weak self] action in self?.onAction?(DashboardActionPayload(action: action, project: project.id, assistant: project.assistant)) }

    let dot = UIView(); dot.layer.cornerRadius = 4
    dot.backgroundColor = Self.color(hex: project.color) ?? .tertiaryLabel
    dot.accessibilityIdentifier = "dashboard-dot-" + project.id
    dot.widthAnchor.constraint(equalToConstant: 8).isActive = true
    dot.heightAnchor.constraint(equalToConstant: 8).isActive = true

    let title = button(project.name) { emit("open") }
    title.accessibilityLabel = project.name
    title.constraints.filter { $0.firstAttribute == .height }.forEach { $0.isActive = false }
    title.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    title.accessibilityIdentifier = "dashboard-project-" + project.id
    title.configuration?.baseForegroundColor = Self.color(hex: project.color) ?? .label
    title.configuration?.background.backgroundColor = .clear
    title.configuration?.titleLineBreakMode = .byTruncatingTail
    title.configuration?.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 4)
    title.configuration?.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { var a = $0; a.font = Self.scaled(15, .semibold, .subheadline); return a }
    title.titleLabel?.numberOfLines = 1
    title.contentHorizontalAlignment = .leading
    title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    title.setContentHuggingPriority(.defaultLow, for: .horizontal)

    let create = iconButton("plus")
    create.addAction(UIAction { _ in emit("new") }, for: .touchUpInside)
    create.accessibilityIdentifier = "dashboard-new-\(project.id)"; create.isEnabled = project.canStart && !awaitingTranscript
    create.accessibilityLabel = "New thread in " + project.name
    let mic = iconButton("mic")
    mic.accessibilityLabel = "Dictate task in \(project.name)"
    mic.accessibilityHint = "Hold and release to send. Tap to record until Send or Cancel. Slide left to cancel."
    mic.accessibilityIdentifier = "dashboard-mic-\(project.id)"
    mic.isEnabled = create.isEnabled && voiceReady
    let hold = UILongPressGestureRecognizer(target: self, action: #selector(holdMic(_:)))
    hold.minimumPressDuration = 0.08; hold.allowableMovement = .greatestFiniteMagnitude
    mic.addGestureRecognizer(hold)
    mic.addAction(UIAction { [weak self, weak mic] _ in
      guard UIAccessibility.isVoiceOverRunning, let self = self, let mic = mic else { return }
      if self.active != nil { self.finish(cancel: false) } else { self.begin(project, mic: mic, pressing: false) }
    }, for: .touchUpInside)
    mic.accessibilityCustomActions = voiceActions(project, mic: mic)
    mic.tag = model.projects.firstIndex(where: { $0.id == project.id }) ?? 0

    let header: UIStackView
    let narrow = !(renderedColumns >= 3 || bounds.width >= 600)
    if !narrow {
      header = UIStackView(arrangedSubviews: [dot, title, create, mic])
      header.axis = .horizontal; header.alignment = .center; header.spacing = 0
      header.setCustomSpacing(8, after: dot)
    } else {
      // Narrow two-column cards: the dot and name are centred as a unit (the name truncates); + and mic are centred as a pair on the next line.
      title.constraints.filter { $0.firstAttribute == .height }.forEach { $0.isActive = false }
      title.heightAnchor.constraint(greaterThanOrEqualToConstant: 32).isActive = true
      title.setContentHuggingPriority(.required, for: .horizontal)
      let name = UIStackView(arrangedSubviews: [dot, title]); name.alignment = .center; name.spacing = 8
      let icons = UIStackView(arrangedSubviews: [create, mic]); icons.alignment = .center
      header = UIStackView(arrangedSubviews: [name, icons]); header.axis = .vertical; header.alignment = .center; header.spacing = 0
      header.layoutMargins = .zero
      header.setCustomSpacing(-6, after: name)
    }

    let threads = UIStackView(); threads.axis = .vertical; threads.spacing = 0
    let recent = Array((project.recent ?? []).prefix(3))
    for thread in recent {
      var config = UIButton.Configuration.plain()
      config.baseForegroundColor = .label
      config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 8, bottom: 0, trailing: 0)
      config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { var a = $0; a.font = Self.scaled(14, .regular, .subheadline); return a }
      let link = UIButton(configuration: config)
      link.configurationUpdateHandler = { button in
        var c = button.configuration
        c?.background.backgroundColor = button.isHighlighted ? DashboardView.rowHighlight : .clear
        c?.background.cornerRadius = 8
        button.configuration = c
      }
      link.addAction(UIAction { [weak self] _ in
        self?.onAction?(DashboardActionPayload(action: "thread", project: project.id, thread: thread.id))
      }, for: .touchUpInside)
      link.accessibilityIdentifier = "dashboard-thread-" + thread.id
      link.contentHorizontalAlignment = .leading
      let indicator = StatusIndicatorView()
      let spoken = indicator.configure(status: thread.status ?? "", unread: thread.unread ?? false)
      let title = UILabel()
      title.text = thread.title
      title.font = Self.scaled(14, .regular, .subheadline)
      title.numberOfLines = 1; title.lineBreakMode = .byTruncatingTail
      title.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      var rowViews: [UIView] = [title]
      if thread.status == "sending" || thread.status == "queued" {
        let state = UILabel()
        state.text = thread.status == "sending" ? "Sending…" : "Queued"
        state.font = Self.scaled(12, .regular, .caption1)
        state.textColor = .secondaryLabel
        state.setContentHuggingPriority(.required, for: .horizontal)
        state.setContentCompressionResistancePriority(.required, for: .horizontal)
        rowViews.append(state)
      }
      rowViews.append(indicator)
      let content = UIStackView(arrangedSubviews: rowViews)
      content.alignment = .center; content.spacing = 4
      content.isUserInteractionEnabled = false; content.translatesAutoresizingMaskIntoConstraints = false
      link.addSubview(content)
      NSLayoutConstraint.activate([
        content.leadingAnchor.constraint(equalTo: link.leadingAnchor, constant: 8),
        content.trailingAnchor.constraint(equalTo: link.trailingAnchor),
        content.topAnchor.constraint(equalTo: link.topAnchor),
        content.bottomAnchor.constraint(equalTo: link.bottomAnchor),
      ])
      link.accessibilityLabel = [thread.title, spoken].filter { !$0.isEmpty }.joined(separator: ", ")
      link.heightAnchor.constraint(greaterThanOrEqualToConstant: 34).isActive = true
      threads.addArrangedSubview(link)
    }
    if recent.isEmpty {
      let empty = UILabel(); empty.text = "No threads yet"; empty.font = Self.scaled(14, .regular, .subheadline)
      empty.textColor = .tertiaryLabel; empty.accessibilityIdentifier = "dashboard-empty-" + project.id
      let holder = UIView(); empty.translatesAutoresizingMaskIntoConstraints = false; holder.addSubview(empty)
      NSLayoutConstraint.activate([
        empty.leadingAnchor.constraint(equalTo: holder.leadingAnchor, constant: 8), empty.trailingAnchor.constraint(equalTo: holder.trailingAnchor, constant: -8),
        empty.topAnchor.constraint(equalTo: holder.topAnchor), empty.bottomAnchor.constraint(equalTo: holder.bottomAnchor),
        holder.heightAnchor.constraint(greaterThanOrEqualToConstant: 28),
      ])
      threads.addArrangedSubview(holder)
    }

    for view in [header, threads] { view.translatesAutoresizingMaskIntoConstraints = false; card.addSubview(view) }
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: card.topAnchor, constant: 4),
      header.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: narrow ? 8 : 14),
      header.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: narrow ? -8 : -4),
      threads.topAnchor.constraint(equalTo: header.bottomAnchor),
      threads.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 6),
      threads.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -6),
      threads.bottomAnchor.constraint(lessThanOrEqualTo: card.bottomAnchor, constant: -10),
    ])
    return card
  }

  /// The Commander avatar (idle breathing; still under Reduce Motion), a mic circle at its bottom-left, a plus circle at its bottom-right and the status pill.
  private func commanderCluster(_ commander: DashboardModel.Commander, model: DashboardModel) -> UIView {
    let enabled = model.connected && !model.busy && !awaitingTranscript
    let size: CGFloat = 96, circle: CGFloat = 44
    let host = UIView(); host.accessibilityIdentifier = "dashboard-commander"
    let open: () -> Void = { [weak self] in self?.onAction?(DashboardActionPayload(action: "commander", project: commander.id)) }

    let avatar = UIButton(type: .custom)
    avatar.translatesAutoresizingMaskIntoConstraints = false
    avatar.backgroundColor = UIColor(red: 234.0 / 255, green: 229.0 / 255, blue: 215.0 / 255, alpha: 1) // Shared dormouse disc: #eae5d7
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
    mic.backgroundColor = tintColor
    mic.configuration?.baseForegroundColor = .white
    mic.layer.borderWidth = 0
    mic.accessibilityHint = "Hold and release to send. Tap to record until Send or Cancel. Slide left to cancel."
    mic.isEnabled = enabled && voiceReady
    let hold = UILongPressGestureRecognizer(target: self, action: #selector(holdMic(_:)))
    hold.minimumPressDuration = 0.08; hold.allowableMovement = .greatestFiniteMagnitude
    mic.addGestureRecognizer(hold)
    mic.addAction(UIAction { [weak self, weak mic] _ in
      guard UIAccessibility.isVoiceOverRunning, let self = self, let mic = mic else { return }
      if self.active != nil { self.finish(cancel: false) } else { self.begin(self.commanderProject(commander), mic: mic, pressing: false) }
    }, for: .touchUpInside)
    mic.accessibilityCustomActions = voiceActions(commanderProject(commander), mic: mic)
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

  private func voiceActions(_ project: DashboardModel.Project, mic: UIButton) -> [UIAccessibilityCustomAction] {
    [
      UIAccessibilityCustomAction(name: "Start recording", actionHandler: { [weak self, weak mic] _ in
        guard let self = self, let mic = mic, self.active == nil else { return false }
        self.begin(project, mic: mic, pressing: false); return true
      }),
      UIAccessibilityCustomAction(name: "Send recording", actionHandler: { [weak self] _ in
        guard let self = self, self.active != nil else { return false }
        self.finish(cancel: false); return true
      }),
      UIAccessibilityCustomAction(name: "Cancel recording", actionHandler: { [weak self] _ in self?.cancelRecording(); return true }),
    ]
  }

  /// Gesture semantics mirror ComposerView.micHold: release after 0.3 s (or sliding up 64 pt) sends,
  /// sliding left 96 pt cancels, and a quick tap keeps recording until Send or Cancel is tapped.
  @objc private func holdMic(_ gesture: UILongPressGestureRecognizer) {
    guard let button = gesture.view as? UIButton else { return }
    let point = gesture.location(in: nil)
    switch gesture.state {
    case .began:
      guard let model = model else { return }
      micOrigin = point
      if button.tag == Self.commanderMicTag, let commander = model.commander { begin(commanderProject(commander), mic: button, pressing: true); return }
      guard model.projects.indices.contains(button.tag) else { return }
      begin(model.projects[button.tag], mic: button, pressing: true)
    case .changed:
      guard pressing, active != nil else { return }
      let cancel = RecordingSwipe.shouldCancel(origin: micOrigin, end: point)
      let armed = RecordingSwipe.shouldSend(origin: micOrigin, end: point)
      let left = max(0, micOrigin.x - point.x), up = max(0, micOrigin.y - point.y)
      cancelProgress = left > up ? min(1, left / 96) : 0
      sendProgress = left > up ? 0 : min(1, up / 64)
      if (armed && !sendArmed) || (cancel && !cancelArmed) { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
      sendArmed = armed; cancelArmed = cancel
      fingerInWindow = point
      if recording { presentBar() }
    case .ended:
      guard pressing, active != nil else { return }
      if RecordingSwipe.shouldCancel(origin: micOrigin, end: point) { finish(cancel: true); return }
      sendArmed = RecordingSwipe.shouldSend(origin: micOrigin, end: point)
      pressing = false
      if RecordingSwipe.sendsOnRelease(duration: ProcessInfo.processInfo.systemUptime - downAt, armed: sendArmed) {
        finish(cancel: false)
      } else if recording {
        // Tap mode: keep recording; scrolling is allowed again but other mics stay disabled.
        sendArmed = false; sendProgress = 0; cancelProgress = 0
        panGestureRecognizer.isEnabled = true
        presentBar()
      }
    case .cancelled, .failed: finish(cancel: true)
    default: break
    }
  }
  private var fingerInWindow: CGPoint?
  private func presentBar() {
    bar.update(active: recording, destination: active?.name ?? "", sendProgress: sendProgress, cancelProgress: cancelProgress, fingerInWindow: pressing ? fingerInWindow : nil)
  }
  /// Presentation is independent of capture so layout can be verified without a microphone.
  func presentRecordingBar(active: Bool, destination: String, sendProgress: CGFloat = 0, cancelProgress: CGFloat = 0, fingerInWindow: CGPoint? = nil, anchor: UIView? = nil) {
    recordingAnchor = anchor
    setNeedsLayout()
    bar.update(active: active, destination: destination, sendProgress: sendProgress, cancelProgress: cancelProgress, fingerInWindow: fingerInWindow)
    layoutIfNeeded()
  }
  private func begin(_ project: DashboardModel.Project, mic: UIButton, pressing touching: Bool) {
    guard active == nil, voiceReady, project.canStart, !awaitingTranscript else { return }
    active = project; self.mic = mic; recordingAnchor = mic; setNeedsLayout(); layoutIfNeeded(); pressing = touching; generation += 1
    downAt = ProcessInfo.processInfo.systemUptime
    sendArmed = false; cancelArmed = false; sendProgress = 0; cancelProgress = 0
    let token = generation; feedback.prepare()
    func disableOthers(_ view: UIView) {
      if let button = view as? UIButton, button !== mic { button.isEnabled = false }
      view.subviews.forEach(disableOthers)
    }
    disableOthers(stack)
    VoiceRecorder.requestPermission { [weak self] allowed in
      guard let self = self, self.active != nil, self.generation == token else { return }
      guard allowed else { self.finish(cancel: true); self.onError?(VoiceRecorder.deniedMessage); return }
      do {
        try self.recorder.start(); self.feedback.impactOccurred()
        self.recording = true
        mic.configuration?.image = UIImage(systemName: "mic.fill"); mic.configuration?.background.backgroundColor = .clear
        mic.configuration?.baseForegroundColor = .systemRed; mic.backgroundColor = .clear
        mic.accessibilityValue = "0 seconds"
        self.bar.tick(elapsed: 0, level: 0)
        self.presentBar()
        if self.pressing { self.panGestureRecognizer.isEnabled = false }
        UIAccessibility.post(notification: .announcement, argument: "Recording to \(project.name).")
      } catch { self.finish(cancel: true); self.onError?(error.localizedDescription) }
    }
  }
  private func finish(cancel: Bool) {
    guard let project = active else { return }
    generation += 1; pressing = false; active = nil; recording = false; panGestureRecognizer.isEnabled = true
    sendArmed = false; cancelArmed = false; sendProgress = 0; cancelProgress = 0
    bar.update(active: false, destination: project.name)
    if cancel { recorder.cancel() } else if let result = recorder.stop() {
      // No native lockout after a send: the next mic is usable immediately.
      UIImpactFeedbackGenerator(style: .light).impactOccurred()
      onAction?(DashboardActionPayload(action: "voice", project: project.id, assistant: project.assistant, path: result.url.path, send: true))
    }
    render()
  }
}
