import AVFoundation
import UIKit

struct CompanionCallEvent: Encodable {
  let type: String
  var state: String? = nil
  var error: String? = nil
  var path: String? = nil
}

/// Foreground hands-free capture. Audio stays on the companion until each utterance
/// is handed to the existing authenticated Mac transcription path.
final class CompanionVoiceCall: NSObject, AVSpeechSynthesizerDelegate {
  var emit: ((CompanionCallEvent) -> Void)?
  private let recorder = VoiceRecorder()
  private let speaker = AVSpeechSynthesizer()
  private var active = false
  private var generation = 0
  private var heardAt: TimeInterval?
  private var speechStarted = false
  private var background: NSObjectProtocol?
  private var interruption: NSObjectProtocol?

  override init() {
    super.init()
    speaker.delegate = self
    recorder.onTick = { [weak self] elapsed in self?.tick(elapsed) }
    recorder.onLimit = { [weak self] in self?.segment() }
    background = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in self?.interrupt("Call paused while Freddai is in the background. End the call and start again to resume.") }
    interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
      if (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue {
        self?.interrupt("Microphone interrupted. End the call and start again to resume.")
      }
    }
  }
  deinit {
    if let background = background { NotificationCenter.default.removeObserver(background) }
    if let interruption = interruption { NotificationCenter.default.removeObserver(interruption) }
  }
  private func state(_ value: String, error: String? = nil) { emit?(CompanionCallEvent(type: "state", state: value, error: error)) }
  private func interrupt(_ message: String) {
    guard active else { return }
    generation += 1; active = false; recorder.cancel(); speaker.stopSpeaking(at: .immediate)
    state("error", error: message)
  }
  func control(_ action: String, text: String?, completion: @escaping (String?) -> Void) {
    switch action {
    case "start":
      generation += 1
      let token = generation
      VoiceRecorder.requestPermission { [weak self] allowed in
        guard let self = self, token == self.generation else { completion("Call cancelled"); return }
        guard allowed else { completion(VoiceRecorder.deniedMessage); return }
        self.active = true
        do { try self.record(); completion(nil) }
        catch { self.active = false; completion(error.localizedDescription) }
      }
    case "stop":
      generation += 1; active = false; recorder.cancel(); speaker.stopSpeaking(at: .immediate); state("idle"); completion(nil)
    case "pause": recorder.cancel(); state("paused"); completion(nil)
    case "resume":
      do { if active { try record() }; completion(nil) } catch { completion(error.localizedDescription) }
    case "speak":
      recorder.cancel()
      do {
        try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
        try AVAudioSession.sharedInstance().setActive(true)
        speaker.speak(AVSpeechUtterance(string: text ?? "")); completion(nil)
      } catch { completion(error.localizedDescription) }
    case "stopSpeaking": speaker.stopSpeaking(at: .immediate); completion(nil)
    default: completion("Unknown call action")
    }
  }
  private func record() throws {
    guard !recorder.isRecording else { return }
    heardAt = nil; speechStarted = false
    try recorder.start(); state("listening")
  }
  private func tick(_ elapsed: TimeInterval) {
    if recorder.level > 0.18 {
      heardAt = elapsed
      if !speechStarted { speechStarted = true; emit?(CompanionCallEvent(type: "speech-start")); state("speech") }
    }
    if let last = heardAt, elapsed - last >= 0.8 { segment() }
    else if elapsed >= 20 { segment() }
  }
  private func segment() {
    let heard = speechStarted
    let result = recorder.stop()
    if let result = result {
      if heard { emit?(CompanionCallEvent(type: "recording", path: result.url.path)) }
      else { AttachmentStore.discard([result.url.path]) }
    }
    if active {
      do { try record() } catch { interrupt(error.localizedDescription) }
    }
  }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) { emit?(CompanionCallEvent(type: "tts-start")) }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { emit?(CompanionCallEvent(type: "tts-end")) }
  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { emit?(CompanionCallEvent(type: "tts-end")) }
}
