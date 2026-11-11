import UIKit

/// Active Commander call state pushed from JS inside `set_mode` (`call`). Decoded defensively: every field is optional.
struct CallState: Decodable, Equatable {
  var active: Bool = false
  var startedAt: Double?   // epoch milliseconds
  var muted: Bool = false
  var phase: String = "idle"

  static let none = CallState()

  init() {}
  init(active: Bool, startedAt: Double?, muted: Bool, phase: String) {
    self.active = active; self.startedAt = startedAt; self.muted = muted; self.phase = phase
  }
  init(from decoder: Decoder) throws {
    // A malformed `call` means no call rather than failing the whole set_mode.
    guard let c = try? decoder.container(keyedBy: CodingKeys.self) else { return }
    active = (try? c.decodeIfPresent(Bool.self, forKey: .active)) ?? false
    startedAt = try? c.decodeIfPresent(Double.self, forKey: .startedAt)
    muted = (try? c.decodeIfPresent(Bool.self, forKey: .muted)) ?? false
    phase = (try? c.decodeIfPresent(String.self, forKey: .phase)) ?? "idle"
  }
  private enum CodingKeys: String, CodingKey { case active, startedAt, muted, phase }
}

/// Compact header group shown in place of the phone button while a call is active:
/// waveform, `m:ss` timer (ticks natively), mute toggle, red hang-up.
final class CallIndicatorView: UIView {
  var onMute: (() -> Void)?
  var onHangup: (() -> Void)?
  let waveform = UIImageView(image: UIImage(systemName: "waveform"))
  let timerLabel = UILabel()
  let muteButton = UIButton(type: .system)
  let hangupButton = UIButton(type: .system)
  private let stack = UIStackView()
  private var timer: Timer?
  private(set) var state = CallState.none

  override init(frame: CGRect) {
    super.init(frame: frame)
    waveform.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold)
    waveform.contentMode = .scaleAspectFit
    waveform.setContentHuggingPriority(.required, for: .horizontal)
    timerLabel.font = .monospacedDigitSystemFont(ofSize: 15, weight: .medium)
    timerLabel.textColor = .label
    timerLabel.setContentCompressionResistancePriority(.required, for: .horizontal)
    muteButton.addTarget(self, action: #selector(muteTapped), for: .touchUpInside)
    hangupButton.setImage(UIImage(systemName: "phone.down.fill"), for: .normal)
    hangupButton.tintColor = .systemRed
    hangupButton.accessibilityLabel = "End call"
    hangupButton.addTarget(self, action: #selector(hangupTapped), for: .touchUpInside)
    for button in [muteButton, hangupButton] {
      button.widthAnchor.constraint(equalToConstant: 44).isActive = true
      button.heightAnchor.constraint(equalToConstant: 44).isActive = true
    }
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 4
    for v in [waveform, timerLabel, muteButton, hangupButton] { stack.addArrangedSubview(v) }
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: trailingAnchor),
      stack.topAnchor.constraint(equalTo: topAnchor),
      stack.bottomAnchor.constraint(equalTo: bottomAnchor),
      heightAnchor.constraint(equalToConstant: 44),
    ])
    apply(.none)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  deinit { timer?.invalidate() }

  /// Narrow headers drop the waveform first and keep timer + hang-up.
  var compact = false { didSet { if oldValue != compact { waveform.isHidden = compact } } }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { stopTimer() } else if state.active { startTimer() }
  }

  func apply(_ new: CallState) {
    let changed = new != state
    state = new
    guard changed else { return }
    muteButton.setImage(UIImage(systemName: new.muted ? "mic.slash" : "mic"), for: .normal)
    muteButton.tintColor = new.muted ? .systemRed : .label
    muteButton.accessibilityLabel = new.muted ? "Unmute" : "Mute"
    waveform.tintColor = new.phase == "error" ? .systemRed : .label
    waveform.isHidden = compact
    updateWaveformEffect()
    refreshTime()
    if new.active { startTimer() } else { stopTimer() }
  }

  private var animates: Bool { !state.muted && ["listening", "hearing", "speaking", "transcribing", "working"].contains(state.phase) }

  private func updateWaveformEffect() {
    if #available(iOS 17.0, *) {
      if animates { waveform.addSymbolEffect(.variableColor.iterative, options: .repeating) }
      else { waveform.removeAllSymbolEffects() }
    }
  }

  static func format(elapsed seconds: Int) -> String {
    let s = max(0, seconds)
    return String(format: "%d:%02d", s / 60, s % 60)
  }

  private var elapsedText: String {
    guard let startedAt = state.startedAt else { return "0:00" }
    return Self.format(elapsed: Int(Date().timeIntervalSince1970 - startedAt / 1000))
  }

  private func refreshTime() {
    let text = elapsedText
    if timerLabel.text != text { timerLabel.text = text }
    let phase = state.muted ? "\(state.phase), muted" : state.phase
    waveform.isAccessibilityElement = false
    timerLabel.accessibilityLabel = "Commander call, \(phase), \(text)"
    accessibilityLabel = timerLabel.accessibilityLabel
  }

  private func startTimer() {
    guard timer == nil, window != nil else { return }
    let t = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.refreshTime() }
    RunLoop.main.add(t, forMode: .common)
    timer = t
    updateWaveformEffect()
  }

  private func stopTimer() { timer?.invalidate(); timer = nil }

  @objc private func muteTapped() { onMute?() }
  @objc private func hangupTapped() { onHangup?() }
}
