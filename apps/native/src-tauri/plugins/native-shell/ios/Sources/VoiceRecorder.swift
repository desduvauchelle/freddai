import AVFoundation
import Foundation
import UIKit

/// Push-to-talk recorder: mono 16 kHz AAC in `freddai-attachments/<uuid>/dictation.m4a`, capped at ten minutes.
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
  static let maxSeconds: TimeInterval = 600
  static let minSeconds: TimeInterval = 0.3
  static let deniedMessage = "Microphone access is off — enable it in Settings › Freddai"

  private var recorder: AVAudioRecorder?
  private var timer: Timer?
  private(set) var fileURL: URL?
  private var previousIdleTimerDisabled: Bool?
  private var startedAt = Date()
  var elapsed: TimeInterval { min(Date().timeIntervalSince(startedAt), Self.maxSeconds) }

  /// Called once per second-ish with elapsed seconds while recording.
  var onTick: ((TimeInterval) -> Void)?
  /// Called when the cap is reached; the owner should treat it like a release.
  var onLimit: (() -> Void)?

  var level: CGFloat {
    guard let recorder = recorder else { return 0 }
    recorder.updateMeters()
    return CGFloat(max(0, min(1, pow(10, recorder.averagePower(forChannel: 0) / 40))))
  }

  var isRecording: Bool { recorder?.isRecording == true }

  static func requestPermission(_ completion: @escaping (Bool) -> Void) {
    let finish: (Bool) -> Void = { granted in DispatchQueue.main.async { completion(granted) } }
    if #available(iOS 17.0, *) {
      AVAudioApplication.requestRecordPermission(completionHandler: finish)
    } else {
      AVAudioSession.sharedInstance().requestRecordPermission(finish)
    }
  }

  /// Starts recording. Throws a user-presentable error if the session or file cannot be set up.
  func start() throws {
    guard !isRecording else { return }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
    // iOS otherwise suppresses the composer’s start haptic while the microphone is active.
    try session.setAllowHapticsAndSystemSoundsDuringRecording(true)
    try session.setActive(true)
    let dir = AttachmentStore.root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let url = dir.appendingPathComponent("dictation.m4a")
    let settings: [String: Any] = [
      AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
      AVSampleRateKey: 16000,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 32000,
      AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ]
    let recorder = try AVAudioRecorder(url: url, settings: settings)
    recorder.delegate = self
    recorder.isMeteringEnabled = true
    guard recorder.record(forDuration: Self.maxSeconds) else {
      try? FileManager.default.removeItem(at: dir)
      throw NSError(domain: "Freddai.Voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn’t start recording."])
    }
    self.recorder = recorder
    previousIdleTimerDisabled = UIApplication.shared.isIdleTimerDisabled
    UIApplication.shared.isIdleTimerDisabled = true
    fileURL = url
    startedAt = Date()
    timer = Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true) { [weak self] _ in
      guard let self = self, self.recorder != nil else { return }
      self.onTick?(self.elapsed)
    }
  }

  /// Stops and returns the recording, or nil (and deletes the file) if shorter than the minimum.
  func stop() -> (url: URL, durationMs: Int)? {
    timer?.invalidate(); timer = nil
    if let previous = previousIdleTimerDisabled {
      UIApplication.shared.isIdleTimerDisabled = previous
      previousIdleTimerDisabled = nil
    }
    guard let recorder = recorder, let url = fileURL else { return nil }
    let seconds = elapsed
    recorder.stop()
    self.recorder = nil
    fileURL = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    if seconds < Self.minSeconds {
      AttachmentStore.discard([url.path])
      return nil
    }
    return (url, Int((seconds * 1000).rounded()))
  }

  /// Aborts without producing a result.
  func cancel() {
    if let url = stop()?.url { AttachmentStore.discard([url.path]) }
  }

  func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
    // Fires on the ten-minute cap (not on a manual stop, which clears `self.recorder` first).
    if recorder === self.recorder { DispatchQueue.main.async { [weak self] in self?.onLimit?() } }
  }
}

/// Swipe feedback and the tap-versus-hold release decision.
enum RecordingSwipe {
  static func sendsOnRelease(duration: TimeInterval, armed: Bool) -> Bool {
    duration >= 0.3 || armed
  }
  static func shouldCancel(origin: CGPoint, end: CGPoint) -> Bool {
    origin.x - end.x >= 96 && origin.x - end.x > max(0, origin.y - end.y)
  }
  static func shouldSend(origin: CGPoint, end: CGPoint) -> Bool {
    origin.y - end.y >= 64 && !shouldCancel(origin: origin, end: end)
  }

  /// Eased 0...1 follow amount for a linear send progress (0 when cancel is the dominant direction).
  static func followAmount(sendProgress: CGFloat) -> CGFloat {
    let t = max(0, min(1, sendProgress))
    return 1 - (1 - t) * (1 - t)
  }
  /// Translation (in `view.superview` space) that moves the send cue from rest toward the finger.
  /// `fingerInWindow` is in window coordinates; keep the enlarged cue inside the visible safe area.
  static func followTranslation(for view: UIView, fingerInWindow: CGPoint, sendProgress: CGFloat) -> CGPoint {
    guard let superview = view.superview else { return .zero }
    let finger = superview.convert(fingerInWindow, from: nil)
    let amount = followAmount(sendProgress: sendProgress)
    var target = CGPoint(x: view.center.x + (finger.x - view.center.x) * amount,
                         y: view.center.y + (finger.y - view.center.y) * amount)
    if let window = view.window {
      let safe = window.bounds.inset(by: window.safeAreaInsets)
      let scale = 1 + max(0, min(1, sendProgress))
      // Convert the final scaled footprint, rather than the previous frame's transform.
      let halfSize = CGSize(width: view.bounds.width * scale / 2, height: view.bounds.height * scale / 2)
      var centre = superview.convert(target, to: window)
      centre.x = max(safe.minX + halfSize.width, min(safe.maxX - halfSize.width, centre.x))
      centre.y = max(safe.minY + halfSize.height, min(safe.maxY - halfSize.height, centre.y))
      target = superview.convert(centre, from: window)
    }
    return CGPoint(x: target.x - view.center.x, y: target.y - view.center.y)
  }
  /// Lets a following cue draw outside clipping ancestors and above siblings. Returns the views whose clipping was disabled.
  static func liftForFollow(_ view: UIView, already: [UIView]) -> [UIView] {
    guard already.isEmpty else { return already }
    var changed: [UIView] = []
    var ancestor = view.superview
    while let node = ancestor {
      if node.clipsToBounds && !(node is UIScrollView) { node.clipsToBounds = false; changed.append(node) }
      ancestor = node.superview
    }
    view.layer.zPosition = 100
    return changed
  }
  static func restoreAfterFollow(_ view: UIView, lifted: [UIView]) {
    lifted.forEach { $0.clipsToBounds = true }
    view.layer.zPosition = 0
  }
}
