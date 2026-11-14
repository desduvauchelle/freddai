import AVFoundation
import PhotosUI
import ReplayKit
import UIKit
import UniformTypeIdentifiers

/// A finished, compressed bug-walk video in `<cache>/freddai-bugwalk`.
struct BugWalkVideoResult: Encodable {
  let path: String
  let name: String
  let mime: String
  let bytes: Int
  let durationS: Double
}

struct BugWalkPickResult: Encodable {
  let picked: Bool
  var video: BugWalkVideoResult?
}

struct BugWalkAvailability: Encodable { let available: Bool }

struct BugWalkStatePayload: Encodable {
  let state: String
  let elapsedS: Int
}

struct StartBugWalkArgs: Decodable { var microphone: Bool? }

struct BugWalkError: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

/// In-app ReplayKit recording (captures only Freddai itself, an iOS limitation) and Photos video picking.
/// Both paths end in `BugWalkExporter`, which compresses to 720p MP4 in the cache dir.
/// All public methods must be called on the main queue; completions are delivered on the main queue.
final class BugWalkRecorder: NSObject, PHPickerViewControllerDelegate {
  static let maxDurationS: Double = 600
  /// ReplayKit stops a hair after the 600 s timer; allow a little slack so the auto-stopped file is not rejected.
  static let recordingSlackS: Double = 15

  var emit: ((BugWalkStatePayload) -> Void)?
  var presenter: (() -> UIViewController?)?

  private enum Phase { case idle, starting, recording, finishing }
  private var phase = Phase.idle
  private var startedAt: Date?
  private var timer: Timer?
  private var rawURL: URL?
  private var finishResult: Result<BugWalkVideoResult, BugWalkError>?
  private var finishWaiters: [(Result<BugWalkVideoResult, BugWalkError>) -> Void] = []
  private var pickCompletion: ((Result<BugWalkVideoResult?, BugWalkError>) -> Void)?

  static var available: Bool { RPScreenRecorder.shared().isAvailable }

  private var elapsed: Int { Int(Date().timeIntervalSince(startedAt ?? Date())) }

  // MARK: Recording

  func start(microphone: Bool, completion: @escaping (BugWalkError?) -> Void) {
    guard phase == .idle else { completion(BugWalkError("A screen recording is already in progress")); return }
    let recorder = RPScreenRecorder.shared()
    guard recorder.isAvailable else { completion(BugWalkError("Screen recording isn't available on this device")); return }
    guard !recorder.isRecording else { completion(BugWalkError("A screen recording is already in progress")); return }
    phase = .starting
    finishResult = nil
    recorder.isMicrophoneEnabled = microphone
    recorder.startRecording { [weak self] error in
      DispatchQueue.main.async {
        guard let self else { return }
        if let error {
          self.phase = .idle
          completion(Self.mapStartError(error))
          return
        }
        self.phase = .recording
        self.startedAt = Date()
        self.emit?(BugWalkStatePayload(state: "recording", elapsedS: 0))
        let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        completion(nil)
      }
    }
  }

  private static func mapStartError(_ error: Error) -> BugWalkError {
    let ns = error as NSError
    if ns.domain == RPRecordingErrorDomain {
      switch ns.code {
      case -5801: return BugWalkError("Screen recording permission was denied")  // RPRecordingErrorUserDeclined
      case -5802: return BugWalkError("Screen recording is disabled by parental controls")  // RPRecordingErrorDisabled
      case -5805: return BugWalkError("There isn't enough storage to record the screen")  // RPRecordingErrorInsufficientStorage
      default: break
      }
    }
    return BugWalkError("Couldn't start screen recording: \(error.localizedDescription)")
  }

  private func tick() {
    guard phase == .recording else { return }
    let seconds = elapsed
    if Double(seconds) >= Self.maxDurationS {
      // Hard cap: stop and export; a later stop() call gets this same result.
      finish(discard: false)
      return
    }
    emit?(BugWalkStatePayload(state: "recording", elapsedS: seconds))
  }

  func stop(completion: @escaping (Result<BugWalkVideoResult, BugWalkError>) -> Void) {
    if let finishResult { completion(finishResult); return }
    switch phase {
    case .recording:
      finishWaiters.append(completion)
      finish(discard: false)
    case .finishing, .starting:
      finishWaiters.append(completion)
    case .idle:
      completion(.failure(BugWalkError("No screen recording is in progress")))
    }
  }

  func cancel(completion: @escaping () -> Void) {
    guard phase == .recording else {
      if phase == .idle { finishResult = nil }
      completion()
      return
    }
    finish(discard: true)
    finishWaiters.append { _ in completion() }
  }

  private func finish(discard: Bool) {
    guard phase == .recording else { return }
    phase = .finishing
    timer?.invalidate()
    timer = nil
    let seconds = elapsed
    emit?(BugWalkStatePayload(state: "processing", elapsedS: seconds))
    let raw = BugWalkFiles.directory().appendingPathComponent("raw-\(UUID().uuidString).mp4")
    rawURL = raw
    RPScreenRecorder.shared().stopRecording(withOutput: raw) { [weak self] error in
      DispatchQueue.main.async {
        guard let self else { return }
        if let error {
          try? FileManager.default.removeItem(at: raw)
          self.complete(.failure(BugWalkError("Screen recording failed: \(error.localizedDescription)")), seconds: seconds)
          return
        }
        if discard {
          try? FileManager.default.removeItem(at: raw)
          self.complete(.failure(BugWalkError("Screen recording was cancelled")), seconds: seconds, cache: false)
          return
        }
        BugWalkExporter.export(source: raw, suggestedName: nil, maxDurationS: Self.maxDurationS + Self.recordingSlackS, deleteSource: true) { result in
          DispatchQueue.main.async { self.complete(result, seconds: seconds) }
        }
      }
    }
  }

  private func complete(_ result: Result<BugWalkVideoResult, BugWalkError>, seconds: Int, cache: Bool = true) {
    phase = .idle
    startedAt = nil
    rawURL = nil
    finishResult = cache ? result : nil
    emit?(BugWalkStatePayload(state: "idle", elapsedS: 0))
    let waiters = finishWaiters
    finishWaiters = []
    for waiter in waiters { waiter(result) }
  }

  // MARK: Photos picker

  func pick(completion: @escaping (Result<BugWalkVideoResult?, BugWalkError>) -> Void) {
    guard pickCompletion == nil else { completion(.failure(BugWalkError("A video picker is already open"))); return }
    guard var top = presenter?() else { completion(.failure(BugWalkError("The native shell is not ready"))); return }
    while let next = top.presentedViewController, !next.isBeingDismissed { top = next }
    var config = PHPickerConfiguration(photoLibrary: .shared())
    config.filter = .videos
    config.selectionLimit = 1
    config.preferredAssetRepresentationMode = .current
    let picker = PHPickerViewController(configuration: config)
    picker.delegate = self
    pickCompletion = completion
    top.present(picker, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    let completion = pickCompletion
    pickCompletion = nil
    guard let result = results.first else { completion?(.success(nil)); return }
    let provider = result.itemProvider
    let suggested = provider.suggestedName
    provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, error in
      guard let url else {
        DispatchQueue.main.async { completion?(.failure(BugWalkError("Couldn't read that video: \(error?.localizedDescription ?? "unknown error")"))) }
        return
      }
      // The system deletes `url` when this handler returns, so copy it now.
      let copy = BugWalkFiles.directory().appendingPathComponent("pick-\(UUID().uuidString).\(url.pathExtension.isEmpty ? "mov" : url.pathExtension)")
      do { try FileManager.default.copyItem(at: url, to: copy) } catch {
        DispatchQueue.main.async { completion?(.failure(BugWalkError("Couldn't copy that video: \(error.localizedDescription)"))) }
        return
      }
      BugWalkExporter.export(source: copy, suggestedName: suggested, maxDurationS: Self.maxDurationS, deleteSource: true) { result in
        DispatchQueue.main.async { completion?(result.map { Optional($0) }) }
      }
    }
  }
}

enum BugWalkFiles {
  static func directory() -> URL {
    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("freddai-bugwalk", isDirectory: true)
    try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
  }

  /// Deletes bug-walk files older than 24 hours.
  static func cleanupOld() {
    let dir = directory()
    let cutoff = Date().addingTimeInterval(-24 * 3600)
    let keys: [URLResourceKey] = [.contentModificationDateKey]
    guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys) else { return }
    for file in files {
      let modified = (try? file.resourceValues(forKeys: Set(keys)).contentModificationDate) ?? .distantPast
      if modified < cutoff { try? FileManager.default.removeItem(at: file) }
    }
  }
}

enum BugWalkExporter {
  /// Compresses `source` to a 720p MP4. Falls back to the medium preset, then to copying the original.
  /// Rejects videos longer than `maxDurationS` before exporting. Completion may run on any queue.
  static func export(source: URL, suggestedName: String?, maxDurationS: Double, deleteSource: Bool, completion: @escaping (Result<BugWalkVideoResult, BugWalkError>) -> Void) {
    let asset = AVURLAsset(url: source)
    let duration = CMTimeGetSeconds(asset.duration)
    func cleanup() { if deleteSource { try? FileManager.default.removeItem(at: source) } }
    guard duration.isFinite, duration > 0 else {
      cleanup()
      completion(.failure(BugWalkError("That video couldn't be read")))
      return
    }
    guard duration <= maxDurationS else {
      cleanup()
      completion(.failure(BugWalkError("That video is too long (max 10 minutes)")))
      return
    }
    let id = UUID().uuidString
    let output = BugWalkFiles.directory().appendingPathComponent("\(id).mp4")
    let name = displayName(suggestedName, fallback: "\(id).mp4")

    func finish(_ file: URL) {
      let bytes = ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber)?.intValue ?? 0
      cleanup()
      completion(.success(BugWalkVideoResult(path: file.path, name: name, mime: "video/mp4", bytes: bytes, durationS: duration)))
    }
    func copyOriginal() {
      do {
        try? FileManager.default.removeItem(at: output)
        try FileManager.default.copyItem(at: source, to: output)
        finish(output)
      } catch {
        cleanup()
        completion(.failure(BugWalkError("Couldn't prepare that video: \(error.localizedDescription)")))
      }
    }
    func run(_ presets: [String]) {
      guard let preset = presets.first else { copyOriginal(); return }
      guard AVAssetExportSession.exportPresets(compatibleWith: asset).contains(preset), let session = AVAssetExportSession(asset: asset, presetName: preset) else {
        run(Array(presets.dropFirst()))
        return
      }
      try? FileManager.default.removeItem(at: output)
      session.outputURL = output
      session.outputFileType = .mp4
      session.shouldOptimizeForNetworkUse = true
      session.exportAsynchronously {
        if session.status == .completed { finish(output) } else { run(Array(presets.dropFirst())) }
      }
    }
    run([AVAssetExportPreset1280x720, AVAssetExportPresetMediumQuality])
  }

  private static func displayName(_ suggested: String?, fallback: String) -> String {
    guard var base = suggested?.trimmingCharacters(in: .whitespacesAndNewlines), !base.isEmpty else { return fallback }
    base = base.replacingOccurrences(of: "/", with: "-")
    let ext = (base as NSString).pathExtension
    if !ext.isEmpty { base = (base as NSString).deletingPathExtension }
    return base.isEmpty ? fallback : "\(base).mp4"
  }
}
