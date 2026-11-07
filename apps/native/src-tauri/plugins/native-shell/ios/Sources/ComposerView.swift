import UIKit

/// Desktop composer layout: attachment chips, growing text, then an inset control row.
final class ComposerView: UIView, UITextViewDelegate {
  // Keep these paired with appearance.css and the desktop composer palette.
  static let threadBackground = UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x18191c) : UIColor(rgb: 0xfafafa) }
  private let surface = UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x25262c) : UIColor(rgb: 0xf0f0f3) }
  private let border = UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x484853) : UIColor(rgb: 0xd8d8e0) }
  private let field = UIView()
  private let chipsScroll = UIScrollView()
  private let chipsStack = UIStackView()
  private let textView = UITextView()
  private let placeholderLabel = UILabel()
  private let sendButton = UIButton(type: .system)
  private var hasModel = false
  private var hasAccess = false
  private let modelButton = UIButton(type: .system)
  private let accessButton = UIButton(type: .system)
  var onSetting: ((String) -> Void)?
  private let attachButton = UIButton(type: .system)
  private let picker = AttachmentPicker()
  private let micButton = UIButton(type: .system)
  private let voiceStatusLabel = RecordingStatusLabel()
  private let recordingSendCue = UIButton(type: .system)
  private let recordingCancelButton = UIButton(type: .system)
  private var micDownAt: TimeInterval = 0
  private var recordingPresented = false
  private let voiceSpinner = UIActivityIndicatorView(style: .medium)
  private let recorder = VoiceRecorder()
  private let recordingFeedback = UIImpactFeedbackGenerator(style: .medium)
  private var voiceEnabled = false
  private var voiceState = "idle"
  private var micPressing = false
  private var micOrigin = CGPoint.zero
  private var sendArmed = false
  private var sendProgress: CGFloat = 0
  private var permissionGeneration = 0
  private var recording = false
  private var heightConstraint: NSLayoutConstraint!
  private var chipsHeight: NSLayoutConstraint!
  private let maxLines: CGFloat = 6
  private(set) var files: [AttachedFile] = []

  weak var presenter: UIViewController?
  var onSend: ((String, [AttachedFile]) -> Void)?
  var onVoiceRecorded: ((String, Int) -> Void)?
  var onVoiceError: ((String) -> Void)?

  var placeholder: String {
    get { placeholderLabel.text ?? "" }
    set { placeholderLabel.text = newValue }
  }

  init() {
    super.init(frame: .zero)
    setup()
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  private func setup() {
    backgroundColor = Self.threadBackground

    field.translatesAutoresizingMaskIntoConstraints = false
    field.backgroundColor = surface
    field.layer.borderWidth = 1
    field.layer.borderColor = border.resolvedColor(with: traitCollection).cgColor
    field.layer.cornerRadius = 24
    field.layer.cornerCurve = .continuous
    field.clipsToBounds = true
    addSubview(field)

    chipsScroll.translatesAutoresizingMaskIntoConstraints = false
    chipsScroll.showsHorizontalScrollIndicator = false
    chipsScroll.isHidden = true
    chipsScroll.alwaysBounceVertical = false
    chipsScroll.clipsToBounds = true
    field.addSubview(chipsScroll)
    chipsStack.axis = .horizontal
    chipsStack.spacing = 8
    chipsStack.translatesAutoresizingMaskIntoConstraints = false
    chipsScroll.addSubview(chipsStack)

    textView.translatesAutoresizingMaskIntoConstraints = false
    textView.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 16))
    textView.textColor = .label
    textView.adjustsFontForContentSizeCategory = true
    textView.backgroundColor = .clear
    textView.textContainerInset = UIEdgeInsets(top: 16, left: 11, bottom: 8, right: 11)
    textView.isScrollEnabled = false
    textView.returnKeyType = .default
    textView.delegate = self
    field.addSubview(textView)

    placeholderLabel.translatesAutoresizingMaskIntoConstraints = false
    placeholderLabel.font = textView.font
    placeholderLabel.adjustsFontForContentSizeCategory = true
    placeholderLabel.textColor = .secondaryLabel
    placeholderLabel.text = "Message"
    placeholderLabel.isUserInteractionEnabled = false
    field.addSubview(placeholderLabel)

    var plus = UIButton.Configuration.plain()
    plus.image = UIImage(systemName: "plus")
    plus.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20)
    plus.baseForegroundColor = .label
    plus.contentInsets = .zero
    attachButton.configuration = plus
    attachButton.translatesAutoresizingMaskIntoConstraints = false
    attachButton.accessibilityLabel = "Attach"
    attachButton.accessibilityHint = "Photo Library, Take Photo or Files"
    attachButton.showsMenuAsPrimaryAction = true
    attachButton.menu = UIMenu(children: attachActions())
    field.addSubview(attachButton)

    for (button, symbol, action) in [(modelButton, "cpu", "model"), (accessButton, "checkmark.shield", "permissions")] {
      var setting = UIButton.Configuration.plain()
      setting.image = UIImage(systemName: symbol)
      setting.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 18)
      setting.baseForegroundColor = .secondaryLabel
      setting.contentInsets = .zero
      button.configuration = setting
      button.translatesAutoresizingMaskIntoConstraints = false
      button.isHidden = true
      button.addAction(UIAction { [weak self] _ in self?.onSetting?(action) }, for: .touchUpInside)
      field.addSubview(button)
    }

    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: "arrow.up")
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 20)
    config.contentInsets = .zero
    sendButton.configuration = config
    sendButton.translatesAutoresizingMaskIntoConstraints = false
    sendButton.accessibilityLabel = "Send"
    sendButton.addTarget(self, action: #selector(send), for: .touchUpInside)
    field.addSubview(sendButton)

    var mic = UIButton.Configuration.plain()
    mic.image = UIImage(systemName: "mic.fill")
    mic.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 18)
    mic.baseForegroundColor = .secondaryLabel
    mic.contentInsets = .zero
    micButton.configuration = mic
    micButton.translatesAutoresizingMaskIntoConstraints = false
    micButton.accessibilityLabel = "Dictate"
    micButton.accessibilityHint = "Hold and release to send. Tap to record until Send or Cancel."
    micButton.isHidden = true
    micButton.layer.cornerRadius = 18
    let hold = UILongPressGestureRecognizer(target: self, action: #selector(micHold(_:)))
    hold.minimumPressDuration = 0
    hold.allowableMovement = .greatestFiniteMagnitude
    micButton.addGestureRecognizer(hold)
    field.addSubview(micButton)

    NotificationCenter.default.addObserver(self, selector: #selector(cancelRecording), name: UIApplication.willResignActiveNotification, object: nil)
    micButton.accessibilityCustomActions = [
      UIAccessibilityCustomAction(name: "Start recording", target: self, selector: #selector(accessibleStartRecording)),
      UIAccessibilityCustomAction(name: "Send recording", target: self, selector: #selector(accessibleSendRecording)),
      UIAccessibilityCustomAction(name: "Cancel recording", target: self, selector: #selector(accessibleCancelRecording))
    ]
    recordingSendCue.translatesAutoresizingMaskIntoConstraints = false
    recordingSendCue.setImage(UIImage(systemName: "arrow.up", withConfiguration: UIImage.SymbolConfiguration(pointSize: 19, weight: .semibold)), for: .normal)
    recordingSendCue.accessibilityIdentifier = "recording-send-cue"
    recordingSendCue.accessibilityLabel = "Send recording"
    recordingSendCue.addTarget(self, action: #selector(sendRecording), for: .touchUpInside)
    recordingSendCue.layer.cornerRadius = 22
    recordingSendCue.layer.shadowColor = UIColor.black.cgColor
    recordingSendCue.layer.shadowOpacity = 0.12
    recordingSendCue.layer.shadowRadius = 8
    recordingSendCue.layer.shadowOffset = CGSize(width: 0, height: 3)
    recordingSendCue.alpha = 0
    addSubview(recordingSendCue)
    NSLayoutConstraint.activate([
      recordingSendCue.centerXAnchor.constraint(equalTo: micButton.centerXAnchor),
      recordingSendCue.centerYAnchor.constraint(equalTo: micButton.centerYAnchor, constant: -64),
      recordingSendCue.widthAnchor.constraint(equalToConstant: 44),
      recordingSendCue.heightAnchor.constraint(equalToConstant: 44)
    ])
    recordingCancelButton.translatesAutoresizingMaskIntoConstraints = false
    recordingCancelButton.setImage(UIImage(systemName: "xmark"), for: .normal)
    recordingCancelButton.accessibilityLabel = "Cancel recording"
    recordingCancelButton.accessibilityIdentifier = "recording-cancel"
    recordingCancelButton.isHidden = true
    recordingCancelButton.addTarget(self, action: #selector(cancelRecording), for: .touchUpInside)
    field.addSubview(recordingCancelButton)
    voiceStatusLabel.textAlignment = .center
    voiceStatusLabel.numberOfLines = 1
    voiceStatusLabel.translatesAutoresizingMaskIntoConstraints = false
    voiceStatusLabel.font = UIFontMetrics(forTextStyle: .subheadline).scaledFont(for: .monospacedDigitSystemFont(ofSize: 13, weight: .regular))
    voiceStatusLabel.adjustsFontForContentSizeCategory = true
    voiceStatusLabel.textColor = .secondaryLabel
    voiceStatusLabel.isHidden = true
    voiceStatusLabel.isUserInteractionEnabled = false
    field.insertSubview(voiceStatusLabel, belowSubview: micButton)
    NSLayoutConstraint.activate([
      recordingCancelButton.leadingAnchor.constraint(equalTo: voiceStatusLabel.leadingAnchor),
      recordingCancelButton.centerYAnchor.constraint(equalTo: voiceStatusLabel.centerYAnchor),
      recordingCancelButton.widthAnchor.constraint(equalToConstant: 44),
      recordingCancelButton.heightAnchor.constraint(equalToConstant: 44)
    ])
    voiceSpinner.translatesAutoresizingMaskIntoConstraints = false
    voiceSpinner.hidesWhenStopped = true
    field.addSubview(voiceSpinner)
    recorder.onTick = { [weak self] seconds in self?.showElapsed(seconds) }
    recorder.onLimit = { [weak self] in self?.finishRecording() }

    picker.present = { [weak self] controller in self?.presenter?.present(controller, animated: true) }
    picker.onFiles = { [weak self] files in self?.add(files) }
    picker.onError = { [weak self] message in self?.alert(title: "Couldn’t attach", message: message) }

    heightConstraint = textView.heightAnchor.constraint(equalToConstant: 36)
    chipsHeight = chipsScroll.heightAnchor.constraint(equalToConstant: 0)
    NSLayoutConstraint.activate([
      field.topAnchor.constraint(equalTo: topAnchor, constant: 8),
      field.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
      field.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),

      attachButton.leadingAnchor.constraint(equalTo: field.leadingAnchor, constant: 8),
      attachButton.topAnchor.constraint(equalTo: textView.bottomAnchor, constant: 3),
      attachButton.bottomAnchor.constraint(equalTo: field.bottomAnchor, constant: -6),
      attachButton.widthAnchor.constraint(equalToConstant: 44),
      attachButton.heightAnchor.constraint(equalToConstant: 44),

      modelButton.leadingAnchor.constraint(equalTo: attachButton.trailingAnchor),
      modelButton.centerYAnchor.constraint(equalTo: attachButton.centerYAnchor),
      modelButton.widthAnchor.constraint(equalToConstant: 44),
      modelButton.heightAnchor.constraint(equalToConstant: 44),
      accessButton.leadingAnchor.constraint(equalTo: modelButton.trailingAnchor),
      accessButton.centerYAnchor.constraint(equalTo: attachButton.centerYAnchor),
      accessButton.widthAnchor.constraint(equalToConstant: 44),
      accessButton.heightAnchor.constraint(equalToConstant: 44),

      chipsScroll.topAnchor.constraint(equalTo: field.topAnchor),
      chipsScroll.leadingAnchor.constraint(equalTo: field.leadingAnchor),
      chipsScroll.trailingAnchor.constraint(equalTo: field.trailingAnchor),
      chipsHeight,
      chipsStack.leadingAnchor.constraint(equalTo: chipsScroll.contentLayoutGuide.leadingAnchor, constant: 10),
      chipsStack.trailingAnchor.constraint(equalTo: chipsScroll.contentLayoutGuide.trailingAnchor, constant: -10),
      chipsStack.topAnchor.constraint(equalTo: chipsScroll.contentLayoutGuide.topAnchor, constant: 8),
      chipsStack.bottomAnchor.constraint(equalTo: chipsScroll.contentLayoutGuide.bottomAnchor),
      chipsStack.heightAnchor.constraint(equalToConstant: 56),

      textView.topAnchor.constraint(equalTo: chipsScroll.bottomAnchor),
      textView.leadingAnchor.constraint(equalTo: field.leadingAnchor),
      textView.trailingAnchor.constraint(equalTo: field.trailingAnchor),
      heightConstraint,

      placeholderLabel.leadingAnchor.constraint(equalTo: textView.leadingAnchor, constant: 16),
      placeholderLabel.trailingAnchor.constraint(lessThanOrEqualTo: textView.trailingAnchor, constant: -6),
      placeholderLabel.centerYAnchor.constraint(equalTo: textView.topAnchor, constant: 26),

      micButton.trailingAnchor.constraint(equalTo: sendButton.leadingAnchor, constant: -16),
      micButton.centerYAnchor.constraint(equalTo: sendButton.centerYAnchor),
      micButton.widthAnchor.constraint(equalToConstant: 36),
      micButton.heightAnchor.constraint(equalToConstant: 36),
      voiceSpinner.leadingAnchor.constraint(equalTo: attachButton.trailingAnchor, constant: 4),
      voiceSpinner.centerYAnchor.constraint(equalTo: attachButton.centerYAnchor),
      voiceStatusLabel.trailingAnchor.constraint(equalTo: micButton.trailingAnchor, constant: 4),
      voiceStatusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: field.leadingAnchor, constant: 8),
      voiceStatusLabel.widthAnchor.constraint(equalToConstant: 224),
      voiceStatusLabel.heightAnchor.constraint(equalToConstant: 44),
      voiceStatusLabel.centerYAnchor.constraint(equalTo: micButton.centerYAnchor),

      sendButton.trailingAnchor.constraint(equalTo: field.trailingAnchor, constant: -12),
      sendButton.centerYAnchor.constraint(equalTo: attachButton.centerYAnchor),
      sendButton.widthAnchor.constraint(equalToConstant: 36),
      sendButton.heightAnchor.constraint(equalToConstant: 36),
    ])
    sendButton.layer.cornerRadius = 18
    refresh()
  }

  func setSettings(model: String?, access: String?, disabled: Bool) {
    hasModel = model != nil
    hasAccess = access != nil
    modelButton.isHidden = !hasModel || recording || voiceState == "transcribing"
    accessButton.isHidden = !hasAccess || recording || voiceState == "transcribing"
    modelButton.isEnabled = !disabled
    accessButton.isEnabled = !disabled
    modelButton.accessibilityLabel = "Model: " + (model ?? "Unavailable")
    accessButton.accessibilityLabel = "Permissions: " + (access ?? "Unavailable")
    accessButton.setImage(UIImage(systemName: access == "Full access" ? "exclamationmark.shield" : "checkmark.shield"), for: .normal)
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    field.layer.borderColor = border.resolvedColor(with: traitCollection).cgColor
    refresh()
  }

  // MARK: Attachments

  private func attachActions() -> [UIMenuElement] {
    var actions: [UIMenuElement] = [
      UIAction(title: "Photo Library", image: UIImage(systemName: "photo.on.rectangle")) { [weak self] _ in
        guard let self = self, self.hasRoom() else { return }
        self.picker.showLibrary(limit: AttachmentLimits.maxFiles - self.files.count)
      },
    ]
    if AttachmentPicker.cameraAvailable {
      actions.append(UIAction(title: "Take Photo", image: UIImage(systemName: "camera")) { [weak self] _ in
        guard let self = self, self.hasRoom() else { return }
        self.picker.showCamera()
      })
    }
    actions.append(UIAction(title: "Files", image: UIImage(systemName: "folder")) { [weak self] _ in
      guard let self = self, self.hasRoom() else { return }
      self.picker.showFiles()
    })
    return actions
  }

  private func hasRoom() -> Bool {
    if files.count >= AttachmentLimits.maxFiles {
      alert(title: "Attachment limit reached", message: "You can attach up to \(AttachmentLimits.maxFiles) files to one message.")
      return false
    }
    return true
  }

  private func alert(title: String, message: String) {
    guard let presenter = presenter, presenter.presentedViewController == nil else { return }
    let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "OK", style: .default))
    presenter.present(alert, animated: true)
  }

  /// Adds picked files, enforcing 20 files, 25 MB each and 100 MB per message. Refused files are deleted and explained in one alert.
  func add(_ new: [AttachedFile]) {
    var accepted = files
    var problems: [String] = []
    var total = accepted.reduce(Int64(0)) { $0 + $1.bytes }
    for file in new {
      if file.bytes > AttachmentLimits.maxFileBytes {
        problems.append("“\(file.name)” is larger than 25 MB.")
      } else if accepted.count >= AttachmentLimits.maxFiles {
        problems.append("You can attach up to \(AttachmentLimits.maxFiles) files to one message.")
      } else if total + file.bytes > AttachmentLimits.maxTotalBytes {
        problems.append("Attachments can total at most 100 MB per message.")
      } else {
        accepted.append(file)
        total += file.bytes
        continue
      }
      AttachmentStore.discard([file.path])
    }
    setFiles(accepted)
    if !problems.isEmpty {
      var seen = Set<String>()
      alert(title: "Some files weren’t attached", message: problems.filter { seen.insert($0).inserted }.joined(separator: "\n"))
    }
  }

  private func setFiles(_ new: [AttachedFile]) {
    files = new
    let animate = window != nil
    var existing: [String: AttachmentChip] = [:]
    for case let chip as AttachmentChip in chipsStack.arrangedSubviews { existing[chip.filePath] = chip }
    let keep = Set(new.map(\.path))
    let removed = existing.filter { !keep.contains($0.key) }.map(\.value)
    var added: [AttachmentChip] = []
    for (index, file) in new.enumerated() {
      if let chip = existing[file.path] {
        if chipsStack.arrangedSubviews.firstIndex(of: chip) != index { chipsStack.removeArrangedSubview(chip); chipsStack.insertArrangedSubview(chip, at: min(index, chipsStack.arrangedSubviews.count)) }
        continue
      }
      let chip = AttachmentChip(file: file) { [weak self] in self?.remove(file) }
      if animate { chip.isHidden = true; chip.alpha = 0; if !Motion.reduced { chip.transform = CGAffineTransform(scaleX: 0.8, y: 0.8) } }
      chipsStack.insertArrangedSubview(chip, at: min(index, chipsStack.arrangedSubviews.count))
      added.append(chip)
    }
    if !new.isEmpty { chipsScroll.isHidden = false }
    chipsHeight.constant = new.isEmpty ? 0 : 64
    refresh()
    setNeedsLayout()
    guard animate else {
      removed.forEach { $0.removeFromSuperview() }
      chipsScroll.isHidden = new.isEmpty
      return
    }
    Motion.animate({
      for chip in removed { chip.isHidden = true; chip.alpha = 0; if !Motion.reduced { chip.transform = CGAffineTransform(scaleX: 0.8, y: 0.8) } }
      for chip in added { chip.isHidden = false; chip.alpha = 1; chip.transform = .identity }
      self.superview?.layoutIfNeeded()
    }, completion: { [weak self] _ in
      removed.forEach { $0.removeFromSuperview() }
      if let self = self { self.chipsScroll.isHidden = self.files.isEmpty }
    })
  }

  private func remove(_ file: AttachedFile) {
    AttachmentStore.discard([file.path])
    setFiles(files.filter { $0 != file })
  }

  // MARK: Text and sending

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
    let sending = files
    textView.text = ""
    // The tmp copies stay on disk until JS confirms the send; a rejected send hands them back via `setText`.
    setFiles([])
    onSend?(text, sending)
  }

  /// Replaces the text; when `restored` is given, also replaces the attachment chips (files that vanished are skipped).
  func setText(_ text: String, files restored: [AttachedFile]? = nil) {
    textView.text = text
    if let restored = restored { setFiles(restored.filter(AttachmentStore.exists)) }
    refresh()
  }

  /// Appends dictated text to the current text with a single space separator and moves the caret to the end.
  /// With `submit`, the combined text goes out through the same path as tapping Send (attachments included).
  func appendText(_ addition: String, submit: Bool = false) {
    let add = addition.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !add.isEmpty else { return }
    let current = textView.text ?? ""
    textView.text = current.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? add : current.trimmingCharacters(in: .whitespaces.union(.newlines)) + " " + add
    textView.selectedRange = NSRange(location: (textView.text as NSString).length, length: 0)
    refresh()
    if submit { send() }
  }

  // MARK: Voice dictation

  /// `enabled` shows the mic button; `state` is "idle" or "transcribing" (Mac is working on the last recording).
  func setVoice(enabled: Bool, state: String?) {
    voiceEnabled = enabled
    if let state = state { voiceState = state }
    if !enabled { cancelRecording() }
    updateVoiceUI()
  }

  private func updateVoiceUI() {
    let transcribing = voiceState == "transcribing"
    modelButton.isHidden = !hasModel || recording || transcribing
    accessButton.isHidden = !hasAccess || recording || transcribing
    micButton.isHidden = !voiceEnabled
    micButton.isEnabled = !transcribing
    micButton.configuration?.image = UIImage(systemName: "mic.fill")
    if !recording { micButton.transform = .identity }
    if recording {
      micButton.backgroundColor = .clear
      micButton.configuration?.baseForegroundColor = .systemRed
      voiceStatusLabel.textColor = .label
      voiceStatusLabel.isHidden = false
      voiceSpinner.stopAnimating()
    } else {
      micButton.backgroundColor = .clear
      micButton.configuration?.baseForegroundColor = transcribing ? .tertiaryLabel : .secondaryLabel
      voiceStatusLabel.textColor = .secondaryLabel
      voiceStatusLabel.isHidden = !transcribing
      if transcribing { voiceStatusLabel.text = "Transcribing…"; voiceSpinner.startAnimating() } else { voiceSpinner.stopAnimating() }
    }
    presentRecording(recording, armed: sendArmed, progress: sendProgress)
  }

  /// Presentation is independent of capture, so layout/motion can be verified without a microphone.
  func presentRecording(_ active: Bool, armed: Bool, progress: CGFloat? = nil) {
    if active { voiceStatusLabel.isHidden = false; micButton.configuration?.baseForegroundColor = .systemRed }
    recordingCancelButton.isHidden = !active
    recordingSendCue.isUserInteractionEnabled = active
    recordingSendCue.isAccessibilityElement = active
    voiceStatusLabel.showWaveform = active
    voiceStatusLabel.setNeedsDisplay()
    attachButton.alpha = active ? 0 : 1
    sendButton.alpha = active ? 0 : 1
    attachButton.isUserInteractionEnabled = !active
    sendButton.isUserInteractionEnabled = !active
    let amount = max(0, min(1, progress ?? (armed ? 1 : 0)))
    let base = UIColor.secondarySystemGroupedBackground.resolvedColor(with: traitCollection)
    let accent = tintColor.resolvedColor(with: traitCollection)
    recordingSendCue.backgroundColor = base.mixed(with: accent, amount: amount)
    recordingSendCue.tintColor = UIColor.label.resolvedColor(with: traitCollection).mixed(with: .white, amount: amount)
    let scale = 1 + 0.18 * amount
    recordingSendCue.transform = active ? CGAffineTransform(translationX: 0, y: Motion.reduced ? 0 : -8 * amount).scaledBy(x: scale, y: scale) : CGAffineTransform(translationX: 0, y: 54)
    if recordingPresented != active {
      recordingPresented = active
      layoutIfNeeded()
      if active {
        voiceStatusLabel.alpha = 0
        if !Motion.reduced {
          voiceStatusLabel.transform = CGAffineTransform(translationX: 94, y: 0).scaledBy(x: 0.16, y: 1)
          recordingSendCue.transform = CGAffineTransform(translationX: 0, y: 54).scaledBy(x: 0.72, y: 0.72)
        }
        Motion.animate {
          self.voiceStatusLabel.alpha = 1
          self.voiceStatusLabel.transform = .identity
          self.recordingSendCue.alpha = 1
          self.recordingSendCue.transform = .identity
        }
      } else {
        Motion.animate { self.recordingSendCue.alpha = 0 }
        voiceStatusLabel.transform = .identity
        voiceStatusLabel.alpha = 1
      }
    }
  }

  private func showElapsed(_ seconds: TimeInterval) {
    let total = Int(seconds)
    voiceStatusLabel.text = String(format: "%d:%02d", total / 60, total % 60)
    micButton.accessibilityValue = "\(voiceStatusLabel.text ?? "") — " + (micPressing ? "Release to send" : "Tap Send or Cancel")
    voiceStatusLabel.elapsed = seconds
    voiceStatusLabel.level = recorder.level
    voiceStatusLabel.setNeedsDisplay()
  }

  @objc private func micHold(_ gesture: UILongPressGestureRecognizer) {
    switch gesture.state {
    case .began:
      guard !recording, !micPressing else { return }
      micDownAt = ProcessInfo.processInfo.systemUptime
      recordingFeedback.prepare()
      micPressing = true
      sendArmed = false
      sendProgress = 0
      micOrigin = gesture.location(in: self)
      permissionGeneration += 1
      let generation = permissionGeneration
      VoiceRecorder.requestPermission { [weak self] granted in
        guard let self = self, self.permissionGeneration == generation, self.voiceEnabled else { return }
        guard granted else {
          self.micPressing = false
          self.onVoiceError?(VoiceRecorder.deniedMessage)
          return
        }
        self.beginRecording()
      }
    case .changed:
      let point = gesture.location(in: self)
      let armed = RecordingSwipe.shouldSend(origin: micOrigin, end: point)
      sendProgress = abs(point.x - micOrigin.x) <= 96 ? max(0, min(1, (micOrigin.y - point.y) / 64)) : 0
      if recording { presentRecording(true, armed: armed, progress: sendProgress) }
      if armed != sendArmed {
        sendArmed = armed
        updateVoiceUI()
        if armed { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
      }
      if recording { showElapsed(recorder.elapsed) }
    case .ended:
      guard micPressing else { return }
      micPressing = false
      let held = RecordingSwipe.sendsOnRelease(duration: ProcessInfo.processInfo.systemUptime - micDownAt, armed: sendArmed)
      if held || sendArmed {
        permissionGeneration += 1
        finishRecording()
      } else if recording {
        showElapsed(recorder.elapsed)
      }
    case .cancelled, .failed:
      cancelRecording()
    default:
      break
    }
  }

  private func beginRecording() {
    do {
      try recorder.start()
    } catch {
      onVoiceError?("Couldn’t start recording: \(error.localizedDescription)")
      return
    }
    recording = true
    recordingFeedback.impactOccurred()
    showElapsed(0)
    updateVoiceUI()
  }

  @objc private func accessibleStartRecording() -> Bool {
    guard voiceEnabled, voiceState != "transcribing", !recording else { return false }
    permissionGeneration += 1
    let generation = permissionGeneration
    micPressing = true
    VoiceRecorder.requestPermission { [weak self] granted in
      guard let self = self, self.micPressing, self.permissionGeneration == generation else { return }
      if granted { self.beginRecording() } else { self.cancelRecording(); self.onVoiceError?(VoiceRecorder.deniedMessage) }
    }
    return true
  }
  @objc private func accessibleSendRecording() -> Bool { finishRecording(); return true }
  @objc private func accessibleCancelRecording() -> Bool { cancelRecording(); return true }

  @objc func cancelRecording() {
    micPressing = false
    permissionGeneration += 1
    sendArmed = false
    sendProgress = 0
    recorder.cancel()
    recording = false
    updateVoiceUI()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { cancelRecording() }
  }

  @objc private func sendRecording() { finishRecording() }

  // The send cue sits above the composer; include it in hit testing.
  override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    if recordingSendCue.isUserInteractionEnabled, recordingSendCue.alpha > 0.01,
       recordingSendCue.point(inside: recordingSendCue.convert(point, from: self), with: event) {
      return recordingSendCue
    }
    return super.hitTest(point, with: event)
  }

  private func finishRecording() {
    guard recording else { return }
    recording = false
    micPressing = false
    permissionGeneration += 1
    sendArmed = false
    sendProgress = 0
    let result = recorder.stop()
    updateVoiceUI()
    guard let result = result else { return } // too short: discarded silently
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    onVoiceRecorded?(result.url.path, result.durationMs)
  }

  override func resignFirstResponder() -> Bool { textView.resignFirstResponder() }

  func textViewDidChange(_ textView: UITextView) { refresh(animated: true) }

  private func refresh(animated: Bool = false) {
    placeholderLabel.isHidden = !textView.text.isEmpty
    let enabled = !textView.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    let styleSend = { [self] in
      sendButton.isEnabled = enabled
      let dark = traitCollection.userInterfaceStyle == .dark
      sendButton.backgroundColor = enabled
        ? UIColor(rgb: dark ? 0xd5c9ee : 0x393947)
        : UIColor(rgb: dark ? 0x393642 : 0xe9e9ef)
      sendButton.configuration?.baseForegroundColor = UIColor(rgb: enabled ? (dark ? 0x302b3b : 0xffffff) : (dark ? 0x8f889e : 0x62626d))
    }
    if sendButton.isEnabled != enabled { Motion.crossfade(sendButton, styleSend) } else { styleSend() }
    let lineHeight = (textView.font?.lineHeight ?? 17)
    let insets = textView.textContainerInset.top + textView.textContainerInset.bottom
    let minHeight = max(64, ceil(lineHeight + insets))
    let maxHeight = ceil(lineHeight * maxLines + insets)
    let fitting = textView.sizeThatFits(CGSize(width: max(textView.bounds.width, 200), height: .greatestFiniteMagnitude)).height
    let newHeight = min(max(fitting, minHeight), maxHeight)
    let heightChanged = heightConstraint.constant != newHeight
    heightConstraint.constant = newHeight
    textView.isScrollEnabled = fitting > maxHeight
    if animated, heightChanged, window != nil { Motion.animate { self.superview?.layoutIfNeeded() } }
  }
}

private extension UIColor {
  convenience init(rgb: UInt32) {
    self.init(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255, blue: CGFloat(rgb & 255) / 255, alpha: 1)
  }
}

/// Neutral capsule anchored to the held microphone. Audio history scrolls toward the mic.
final class RecordingStatusLabel: UILabel {
  static let recordingGreen = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.34, green: 0.84, blue: 0.55, alpha: 1) : UIColor(red: 0.08, green: 0.48, blue: 0.27, alpha: 1) }
  var level: CGFloat = 0 {
    didSet { samples.append(max(0, min(1, level))); if samples.count > 32 { samples.removeFirst() } }
  }
  var elapsed: TimeInterval = 0
  var showWaveform = false
  private var samples = Array(repeating: CGFloat(0), count: 32)
  override var intrinsicContentSize: CGSize { CGSize(width: 224, height: 44) }
  override func draw(_ rect: CGRect) {
    guard showWaveform else { super.draw(rect); return }
    UIColor.secondarySystemGroupedBackground.setFill()
    UIBezierPath(roundedRect: bounds, cornerRadius: bounds.height / 2).fill()
    let timer = text ?? "0:00"
    let timerFont = UIFont.monospacedDigitSystemFont(ofSize: 14, weight: .medium)
    timer.draw(at: CGPoint(x: 44, y: (bounds.height - timerFont.lineHeight) / 2), withAttributes: [.font: timerFont, .foregroundColor: Self.recordingGreen])
    Self.recordingGreen.setFill()
    let count = max(0, Int((bounds.width - 142) / 5))
    for (index, sample) in samples.suffix(count).enumerated() {
      let height = 3 + 23 * sample
      UIBezierPath(roundedRect: CGRect(x: 100 + CGFloat(index) * 5, y: (bounds.height - height) / 2, width: 2.5, height: height), cornerRadius: 1.25).fill()
    }
  }
}

private extension UIColor {
  func mixed(with other: UIColor, amount: CGFloat) -> UIColor {
    var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
    var rr: CGFloat = 0, gg: CGFloat = 0, bb: CGFloat = 0, aa: CGFloat = 0
    getRed(&r, green: &g, blue: &b, alpha: &a)
    other.getRed(&rr, green: &gg, blue: &bb, alpha: &aa)
    return UIColor(red: r + (rr-r)*amount, green: g + (gg-g)*amount, blue: b + (bb-b)*amount, alpha: a + (aa-a)*amount)
  }
}
