import AVFoundation
import Foundation

/// Push-to-talk recorder: mono 16 kHz AAC in `freddai-attachments/<uuid>/dictation.m4a`, capped at two minutes.
final class VoiceRecorder: NSObject, AVAudioRecorderDelegate {
  static let maxSeconds: TimeInterval = 120
  static let minSeconds: TimeInterval = 0.3
  static let deniedMessage = "Microphone access is off — enable it in Settings › Freddai"

  private var recorder: AVAudioRecorder?
  private var timer: Timer?
  private(set) var fileURL: URL?
  private var startedAt = Date()
  var elapsed: TimeInterval { min(Date().timeIntervalSince(startedAt), Self.maxSeconds) }

  /// Called once per second-ish with elapsed seconds while recording.
  var onTick: ((TimeInterval) -> Void)?
  /// Called when the cap is reached; the owner should treat it like a release.
  var onLimit: (() -> Void)?

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
    guard recorder.record(forDuration: Self.maxSeconds) else {
      try? FileManager.default.removeItem(at: dir)
      throw NSError(domain: "Freddai.Voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Couldn’t start recording."])
    }
    self.recorder = recorder
    fileURL = url
    startedAt = Date()
    timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      guard let self = self, self.recorder != nil else { return }
      self.onTick?(self.elapsed)
    }
  }

  /// Stops and returns the recording, or nil (and deletes the file) if shorter than the minimum.
  func stop() -> (url: URL, durationMs: Int)? {
    timer?.invalidate(); timer = nil
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
    // Fires on the two-minute cap (not on a manual stop, which clears `self.recorder` first).
    if recorder === self.recorder { DispatchQueue.main.async { [weak self] in self?.onLimit?() } }
  }
}
