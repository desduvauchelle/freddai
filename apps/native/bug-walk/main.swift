// bugwalk-helper: region selection overlay, screen+mic recording, and frame extraction for Tucky's bug walk.
// stdout: one JSON object per line. Errors: JSON on stderr + non-zero exit. See docs/spec.md "Bug walk".
import AppKit
import AVFoundation
import ScreenCaptureKit
import CoreMedia
import CoreVideo
import ImageIO
import UniformTypeIdentifiers
import Darwin

let helperVersion = "1.0.0"

func writeLine(_ handle: FileHandle, _ object: [String: Any]) {
    guard var data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
    data.append(0x0A)
    handle.write(data)
}
func emit(_ object: [String: Any]) { writeLine(.standardOutput, object) }
/// Diagnostic breadcrumb on stderr (`{"log": stage, ...}`). Rust keeps stderr and logs it when the helper exits;
/// `error_from_stderr` ignores lines without an `error` key, so these never turn into user-facing errors.
func logStage(_ stage: String, _ extra: [String: Any] = [:]) {
    var o = extra; o["log"] = stage; o["t"] = (Date().timeIntervalSince1970 * 1000).rounded() / 1000
    writeLine(.standardError, o)
}
func fail(_ code: String, _ detail: String? = nil, exit status: Int32 = 1) -> Never {
    var o: [String: Any] = ["error": code]
    if let detail { o["detail"] = detail }
    writeLine(.standardError, o)
    exit(status)
}
func parseArgs(_ args: [String]) -> [String: String] {
    var out: [String: String] = [:]
    var i = 0
    while i < args.count {
        if args[i].hasPrefix("--") {
            let key = String(args[i].dropFirst(2))
            if i + 1 < args.count, !args[i + 1].hasPrefix("--") { out[key] = args[i + 1]; i += 2 } else { out[key] = "true"; i += 1 }
        } else { i += 1 }
    }
    return out
}
func require(_ a: [String: String], _ key: String) -> String {
    guard let v = a[key] else { fail("bad-arguments", "missing --\(key)", exit: 64) }
    return v
}
func requireNum(_ a: [String: String], _ key: String) -> Double {
    guard let v = Double(require(a, key)) else { fail("bad-arguments", "--\(key) must be a number", exit: 64) }
    return v
}

// MARK: permissions

/// Screen recording is checked (and requested) first, then the microphone.
func ensurePermissions(needMic: Bool = true) {
    if !CGPreflightScreenCaptureAccess() {
        _ = CGRequestScreenCaptureAccess()
        fail("screen-recording-permission", exit: 3)
    }
    guard needMic else { return }
    var status = AVCaptureDevice.authorizationStatus(for: .audio)
    if status == .notDetermined {
        let sem = DispatchSemaphore(value: 0)
        AVCaptureDevice.requestAccess(for: .audio) { _ in sem.signal() }
        sem.wait()
        status = AVCaptureDevice.authorizationStatus(for: .audio)
    }
    if status != .authorized { fail("microphone-permission", exit: 4) }
}

// MARK: select

final class OverlayWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

final class OverlayView: NSView {
    let screen: NSScreen
    var start: CGPoint?
    var current: CGPoint?
    var onDone: (NSScreen, CGRect) -> Void
    var onCancel: () -> Void
    init(screen: NSScreen, onDone: @escaping (NSScreen, CGRect) -> Void, onCancel: @escaping () -> Void) {
        self.screen = screen; self.onDone = onDone; self.onCancel = onCancel
        super.init(frame: CGRect(origin: .zero, size: screen.frame.size))
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: .crosshair) }
    var selection: CGRect? {
        guard let s = start, let c = current else { return nil }
        return CGRect(x: min(s.x, c.x), y: min(s.y, c.y), width: abs(s.x - c.x), height: abs(s.y - c.y)).intersection(bounds)
    }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.25).setFill()
        bounds.fill()
        guard let r = selection, r.width > 0, r.height > 0 else { return }
        let ctx = NSGraphicsContext.current
        ctx?.compositingOperation = .copy
        NSColor(white: 0, alpha: 0.004).setFill() // near-clear but still hit-testable
        r.fill()
        ctx?.compositingOperation = .sourceOver
        NSColor.white.setStroke()
        let border = NSBezierPath(rect: r.insetBy(dx: 0.5, dy: 0.5)); border.lineWidth = 1; border.stroke()
        let label = "\(Int(r.width)) × \(Int(r.height))" as NSString
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .medium), .foregroundColor: NSColor.white]
        let size = label.size(withAttributes: attrs)
        var box = CGRect(x: r.maxX - size.width - 14, y: r.maxY + 6, width: size.width + 12, height: size.height + 6)
        if box.maxY > bounds.maxY { box.origin.y = r.maxY - box.height - 6 }
        if box.minX < 0 { box.origin.x = 4 }
        NSColor.black.withAlphaComponent(0.7).setFill()
        NSBezierPath(roundedRect: box, xRadius: 4, yRadius: 4).fill()
        label.draw(at: CGPoint(x: box.minX + 6, y: box.minY + 3), withAttributes: attrs)
    }
    override func mouseDown(with event: NSEvent) {
        start = convert(event.locationInWindow, from: nil); current = start; needsDisplay = true
    }
    override func mouseDragged(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil); needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) {
        current = convert(event.locationInWindow, from: nil)
        guard let s = start, let c = current else { return }
        if hypot(s.x - c.x, s.y - c.y) < 4 { onDone(screen, bounds); return } // click: whole display
        if let r = selection, r.width >= 4, r.height >= 4 { onDone(screen, r) } else { start = nil; current = nil; needsDisplay = true }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onCancel() } else { super.keyDown(with: event) }
    }
}

@MainActor func runSelect() -> Never {
    ensurePermissions()
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    var windows: [OverlayWindow] = []
    let done: (NSScreen, CGRect) -> Void = { screen, r in
        let id = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
        let origin = CGDisplayBounds(id).origin // Quartz: global, top-left origin
        emit(["display_id": id, "global_x": (origin.x + r.minX).rounded(), "global_y": (origin.y + r.minY).rounded(), "x": r.minX.rounded(), "y": r.minY.rounded(), "width": r.width.rounded(), "height": r.height.rounded(), "scale": screen.backingScaleFactor])
        exit(0)
    }
    let cancel: () -> Void = { exit(2) }
    for screen in NSScreen.screens {
        let w = OverlayWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        w.level = .screenSaver
        w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        let v = OverlayView(screen: screen, onDone: done, onCancel: cancel)
        w.contentView = v
        w.setFrame(screen.frame, display: true)
        w.makeKeyAndOrderFront(nil)
        w.makeFirstResponder(v)
        windows.append(w)
    }
    let mouse = NSEvent.mouseLocation
    if let w = windows.first(where: { $0.frame.contains(mouse) }) ?? windows.first { w.makeKey() }
    app.activate(ignoringOtherApps: true) // overlay must receive keys; unavoidable for Esc
    app.run()
    exit(0)
}

// MARK: record

/// Incremental 16 kHz mono 16-bit PCM wav. Header sizes are patched every ~2 s so a crash leaves a playable file.
final class WavWriter {
    let handle: FileHandle
    private(set) var samples = 0
    private var lastPatch = 0
    init(url: URL) throws {
        FileManager.default.createFile(atPath: url.path, contents: nil)
        handle = try FileHandle(forWritingTo: url)
        handle.write(header(dataBytes: 0))
    }
    private func header(dataBytes: Int) -> Data {
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(truncatingIfNeeded: v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(truncatingIfNeeded: v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(36 + dataBytes); d.append("WAVEfmt ".data(using: .ascii)!)
        u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(dataBytes)
        return d
    }
    func append(_ p: UnsafePointer<Int16>, count: Int) {
        guard count > 0 else { return }
        handle.write(Data(bytes: p, count: count * 2)); samples += count
        if samples - lastPatch >= 32000 { patch() }
    }
    func appendSilence(_ count: Int) {
        guard count > 0 else { return }
        handle.write(Data(count: count * 2)); samples += count
    }
    func patch() {
        lastPatch = samples
        let end = handle.offsetInFile
        handle.seek(toFileOffset: 0); handle.write(header(dataBytes: samples * 2)); handle.seek(toFileOffset: end)
    }
    func finish() { patch(); try? handle.close() }
}

final class OutlineView: NSView {
    override var isFlipped: Bool { true }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.systemRed.setStroke()
        let p = NSBezierPath(rect: bounds.insetBy(dx: 1, dy: 1)); p.lineWidth = 2; p.stroke()
    }
}

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let displayID: CGDirectDisplayID
    let region: CGRect
    let dir: URL
    var stream: SCStream?
    var writer: AVAssetWriter!
    var vInput: AVAssetWriterInput!
    var wav: WavWriter!
    let engine = AVAudioEngine()
    let lock = NSLock()
    var t0: Double?            // host-clock seconds of first video frame == time 0 of both files
    var lastVideoPTS: Double = 0
    var sumSquares = 0.0, sampleCount = 0
    var stopping = false
    var warnedWriter = false
    let videoQ = DispatchQueue(label: "bugwalk.video")
    var outline: NSWindow?
    var levelTimer: Timer?

    init(displayID: CGDirectDisplayID, region: CGRect, dir: URL) { self.displayID = displayID; self.region = region; self.dir = dir }

    @MainActor func start() async {
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            guard let screen = NSScreen.screens.first(where: { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == displayID }) else {
                fail("display-not-found", "display \(displayID)")
            }
            let scale = screen.backingScaleFactor
            // Red outline sits 2 pt outside the region and is excluded from the stream.
            let f = screen.frame
            let rect = CGRect(x: f.minX + region.minX - 2, y: f.minY + f.height - region.maxY - 2, width: region.width + 4, height: region.height + 4)
            let w = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = .screenSaver; w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false
            w.ignoresMouseEvents = true; w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            w.contentView = OutlineView(frame: CGRect(origin: .zero, size: rect.size))
            w.orderFrontRegardless()
            outline = w

            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
            guard let display = content.displays.first(where: { $0.displayID == displayID }) else { fail("display-not-found", "ScreenCaptureKit has no display \(displayID)") }
            let excluded = content.windows.filter { $0.windowID == CGWindowID(w.windowNumber) }
            let filter = SCContentFilter(display: display, excludingWindows: excluded)
            let cfg = SCStreamConfiguration()
            cfg.sourceRect = region
            let pw = max(2, Int((region.width * scale).rounded()) & ~1), ph = max(2, Int((region.height * scale).rounded()) & ~1)
            cfg.width = pw; cfg.height = ph
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 15)
            cfg.showsCursor = true
            cfg.pixelFormat = kCVPixelFormatType_32BGRA
            cfg.queueDepth = 6

            writer = try AVAssetWriter(url: dir.appendingPathComponent("recording.mp4"), fileType: .mp4)
            writer.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)
            vInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: pw, AVVideoHeightKey: ph,
                AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: max(1_500_000, pw * ph * 2), AVVideoExpectedSourceFrameRateKey: 15, AVVideoMaxKeyFrameIntervalKey: 30, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
            ])
            vInput.expectsMediaDataInRealTime = true
            writer.add(vInput)
            guard writer.startWriting() else { fail("writer-failed", writer.error?.localizedDescription) }

            wav = try WavWriter(url: dir.appendingPathComponent("audio.wav"))
            try startAudio()

            let s = SCStream(filter: filter, configuration: cfg, delegate: self)
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQ)
            try await s.startCapture()
            stream = s
            emit(["event": "started"])

            levelTimer = Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.lock.lock()
                let rms = self.sampleCount > 0 ? min(1, (self.sumSquares / Double(self.sampleCount)).squareRoot()) : 0
                self.sumSquares = 0; self.sampleCount = 0
                self.lock.unlock()
                emit(["event": "level", "rms": (rms * 1000).rounded() / 1000])
            }
            Timer.scheduledTimer(withTimeInterval: 30 * 60, repeats: false) { [weak self] _ in Task { await self?.stop(reason: "max-duration") } }
            Thread.detachNewThread { [weak self] in
                while let line = readLine() { if line.trimmingCharacters(in: .whitespaces) == "stop" { break } }
                Task { await self?.stop(reason: nil) } // "stop" or stdin EOF (parent gone)
            }
        } catch {
            fail("record-failed", "\(error)", exit: 5)
        }
    }

    func startAudio() throws {
        let input = engine.inputNode
        let inFmt = input.outputFormat(forBus: 0)
        guard inFmt.sampleRate > 0, let outFmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let conv = AVAudioConverter(from: inFmt, to: outFmt) else { fail("microphone-unavailable", "no usable input device", exit: 5) }
        input.installTap(onBus: 0, bufferSize: 4096, format: inFmt) { [weak self] buf, when in
            self?.handleAudio(buf, when, conv, outFmt, inFmt.sampleRate)
        }
        try engine.start()
    }

    func handleAudio(_ buf: AVAudioPCMBuffer, _ when: AVAudioTime, _ conv: AVAudioConverter, _ outFmt: AVAudioFormat, _ inRate: Double) {
        lock.lock(); defer { lock.unlock() }
        guard !stopping, let t0 else { return } // before the first video frame: dropped, padded as silence later
        guard let out = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: AVAudioFrameCount(Double(buf.frameLength) * 16000 / inRate) + 64) else { return }
        var fed = false
        var err: NSError?
        conv.convert(to: out, error: &err) { _, status in
            if fed { status.pointee = .noDataNow; return nil }
            fed = true; status.pointee = .haveData; return buf
        }
        guard err == nil, out.frameLength > 0, let ptr = out.int16ChannelData?[0] else { return }
        var p = UnsafePointer(ptr), n = Int(out.frameLength)
        // Align to the video clock: expected sample index of this buffer's first sample.
        if when.isHostTimeValid {
            let expected = Int(((AVAudioTime.seconds(forHostTime: when.hostTime) - t0) * 16000).rounded())
            let diff = expected - wav.samples
            if diff > 320 { wav.appendSilence(diff) }              // gap > 20 ms: pad
            else if diff < -320 { let skip = min(n, -diff); p += skip; n -= skip } // overlap: drop
        } else if wav.samples == 0 { return }
        for i in 0..<n { let v = Double(p[i]) / 32768; sumSquares += v * v }
        sampleCount += n
        wav.append(p, count: n)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sb), CMSampleBufferGetImageBuffer(sb) != nil else { return }
        guard let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let st = atts.first?[.status] as? Int, st == SCFrameStatus.complete.rawValue else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        lock.lock()
        if stopping { lock.unlock(); return }
        // The movie timeline starts at 0: with fragmented output AVAssetWriter fails (MovieHeaderMaker -16341, writer
        // status .failed ~4 s in, mp4 never finalized) when sample times are the raw host clock.
        if t0 == nil { t0 = pts.seconds; writer.startSession(atSourceTime: .zero); logStage("record.first-frame", ["pts": pts.seconds]) }
        let base = t0 ?? pts.seconds
        lastVideoPTS = pts.seconds
        lock.unlock()
        if writer.status == .failed {
            let warn: Bool = lock.withLock { let w = !warnedWriter; warnedWriter = true; return w }
            if warn {
                let detail = "\(String(describing: writer.error))"
                logStage("record.writer-failed", ["detail": detail])
                emit(["event": "warning", "code": "writer-failed", "detail": detail])
            }
            return
        }
        if vInput.isReadyForMoreMediaData {
            var timing = CMSampleTimingInfo(duration: CMSampleBufferGetDuration(sb), presentationTimeStamp: CMTime(seconds: pts.seconds - base, preferredTimescale: 600_000), decodeTimeStamp: .invalid)
            var shifted: CMSampleBuffer?
            let status = CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sb, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &shifted)
            if status == noErr, let shifted { vInput.append(shifted) } else { logStage("record.retime-failed", ["status": Int(status)]) }
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        // User clicked "Stop sharing", display went away, or SCStream errored: that is a stop, not a failure.
        Task { await self.stop(reason: "stream-stopped", detail: error.localizedDescription, streamAlreadyStopped: true) }
    }

    /// Idempotent: the first caller finalizes, later callers (stdin `stop`, signals, stream delegate) return immediately.
    func stop(reason: String?, detail: String? = nil, streamAlreadyStopped: Bool = false) async {
        let (already, start): (Bool, Double?) = lock.withLock { let was = stopping; stopping = true; return (was, t0) }
        if already { return }
        logStage("stop.begin", ["reason": reason ?? "requested", "detail": detail ?? ""])
        await MainActor.run { levelTimer?.invalidate(); outline?.orderOut(nil) }
        engine.inputNode.removeTap(onBus: 0); engine.stop()
        if !streamAlreadyStopped { try? await stream?.stopCapture() }
        logStage("stop.capture-stopped", ["writer_status": writer.status.rawValue])
        guard let start else {
            writer.cancelWriting()
            lock.withLock { wav?.finish() }
            fail("no-frames", "no video frames were captured", exit: 5)
        }
        let nowT = CMClockGetTime(CMClockGetHostTimeClock()).seconds
        let end = streamAlreadyStopped ? lastVideoPTS : max(nowT, lastVideoPTS)
        let duration = max(0, end - start)
        if writer.status == .writing {
            vInput.markAsFinished()
            writer.endSession(atSourceTime: CMTime(seconds: duration, preferredTimescale: 600))
            // If the mp4 never finishes, still finalize the wav and report instead of hanging until Rust SIGKILLs us.
            DispatchQueue.global().asyncAfter(deadline: .now() + 15) { [self] in
                logStage("stop.finish-writing-timeout")
                lock.withLock { wav.appendSilence(Int((duration * 16000).rounded()) - wav.samples); wav.finish() }
                emit(["event": "stopped", "duration_s": (duration * 1000).rounded() / 1000, "reason": "writer-failed", "partial": true, "detail": "finishWriting did not complete within 15 s"])
                exit(0)
            }
            await writer.finishWriting()
            logStage("stop.mp4-finished", ["writer_status": writer.status.rawValue, "error": writer.error.map { "\($0)" } ?? ""])
        }
        lock.withLock {
            wav.appendSilence(Int((duration * 16000).rounded()) - wav.samples) // trailing pad so wav length == video length
            wav.finish()
        }
        logStage("stop.wav-finished", ["samples": wav.samples])
        let mp4 = dir.appendingPathComponent("recording.mp4")
        let mp4Size = ((try? FileManager.default.attributesOfItem(atPath: mp4.path))?[.size] as? NSNumber)?.intValue ?? 0
        var o: [String: Any] = ["event": "stopped", "duration_s": (duration * 1000).rounded() / 1000]
        if writer.status == .completed {
            if let reason { o["reason"] = reason }
            if let detail { o["detail"] = detail }
        } else if mp4Size > 0 { // fragmented mp4 is still playable: continue with what exists
            o["reason"] = "writer-failed"; o["partial"] = true
            o["detail"] = writer.error?.localizedDescription ?? detail ?? "writer status \(writer.status.rawValue)"
            if let reason { o["stop_reason"] = reason }
        } else {
            fail("writer-failed", writer.error?.localizedDescription, exit: 5)
        }
        logStage("stop.emit", ["event": o])
        emit(o)
        exit(0)
    }
}

var activeRecorder: Recorder?
var signalSources: [DispatchSourceSignal] = []

@MainActor func runRecord(_ a: [String: String]) -> Never {
    let id = CGDirectDisplayID(requireNum(a, "display-id"))
    let r = CGRect(x: requireNum(a, "x"), y: requireNum(a, "y"), width: requireNum(a, "width"), height: requireNum(a, "height"))
    let dir = URL(fileURLWithPath: require(a, "out"))
    guard r.width >= 2, r.height >= 2 else { fail("bad-arguments", "region too small", exit: 64) }
    ensurePermissions()
    NSApplication.shared.setActivationPolicy(.accessory)
    let rec = Recorder(displayID: id, region: r, dir: dir)
    activeRecorder = rec
    for sig in [SIGINT, SIGTERM, SIGHUP] {
        signal(sig, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        src.setEventHandler { logStage("signal", ["signo": Int(sig)]); Task { await rec.stop(reason: nil) } }
        src.resume(); signalSources.append(src)
    }
    Task { @MainActor in await rec.start() }
    NSApplication.shared.run()
    exit(0)
}

// MARK: frames

func pngName(_ t: Double) -> String { String(format: "frame-%08.3f.png", t) }

func runFrames(_ a: [String: String]) async -> Never {
    let video = URL(fileURLWithPath: require(a, "video"))
    let outDir = URL(fileURLWithPath: require(a, "out"))
    let maxWidth = Double(a["max-width"] ?? "") ?? 2560
    let times = require(a, "times").split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard !times.isEmpty else { fail("bad-arguments", "--times has no numbers", exit: 64) }
    do {
        try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        let asset = AVURLAsset(url: video)
        let duration = try await asset.load(.duration).seconds
        guard let track = try await asset.loadTracks(withMediaType: .video).first else { fail("no-video-track", video.path, exit: 5) }
        let size = try await track.load(.naturalSize)
        let fps = try await track.load(.nominalFrameRate)
        let frameDur = fps > 0 ? 1.0 / Double(fps) : 1.0 / 15
        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        gen.requestedTimeToleranceBefore = .zero
        gen.requestedTimeToleranceAfter = .zero
        if size.width > maxWidth { gen.maximumSize = CGSize(width: maxWidth, height: (maxWidth * size.height / size.width).rounded()) }
        var results: [[String: Any]] = []
        for t in times {
            let last = max(0, duration - frameDur)
            let use = min(max(0, t), last)
            let image: CGImage
            do { image = try await gen.image(at: CMTime(seconds: use, preferredTimescale: 600)).image }
            catch { // tolerance zero can miss a sparse tail frame: allow one frame of slack
                gen.requestedTimeToleranceBefore = CMTime(seconds: frameDur, preferredTimescale: 600)
                gen.requestedTimeToleranceAfter = CMTime(seconds: frameDur, preferredTimescale: 600)
                image = try await gen.image(at: CMTime(seconds: use, preferredTimescale: 600)).image
            }
            let url = outDir.appendingPathComponent(pngName(t))
            guard let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { fail("png-failed", url.path, exit: 5) }
            CGImageDestinationAddImage(dest, image, nil)
            guard CGImageDestinationFinalize(dest) else { fail("png-failed", url.path, exit: 5) }
            var item: [String: Any] = ["time": t, "path": url.path]
            if use != t { item["clamped"] = true; item["actual_time"] = (use * 1000).rounded() / 1000 }
            results.append(item)
        }
        emit(["frames": results])
        exit(0)
    } catch { fail("frames-failed", "\(error)", exit: 5) }
}

// MARK: selftest (hidden): writes a 2 s synthetic 15 fps mp4

func runSelfTest(_ path: String) async -> Never {
    do {
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.removeItem(at: url)
        let w = try AVAssetWriter(url: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 640, AVVideoHeightKey: 400])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: 640, kCVPixelBufferHeightKey as String: 400])
        w.add(input); w.startWriting(); w.startSession(atSourceTime: .zero)
        for i in 0..<30 {
            var pb: CVPixelBuffer?
            CVPixelBufferCreate(nil, 640, 400, kCVPixelFormatType_32BGRA, nil, &pb)
            guard let buf = pb else { continue }
            CVPixelBufferLockBaseAddress(buf, [])
            let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self), stride = CVPixelBufferGetBytesPerRow(buf)
            for y in 0..<400 { for x in 0..<640 {
                let o = y * stride + x * 4
                let inBox = abs(x - (20 + i * 20)) < 30 && abs(y - 200) < 30
                base[o] = inBox ? 255 : UInt8(x / 3); base[o + 1] = inBox ? 255 : UInt8(y / 2); base[o + 2] = inBox ? 255 : UInt8(i * 8); base[o + 3] = 255
            } }
            CVPixelBufferUnlockBaseAddress(buf, [])
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
            adaptor.append(buf, withPresentationTime: CMTime(value: Int64(i), timescale: 15))
        }
        input.markAsFinished()
        w.endSession(atSourceTime: CMTime(value: 30, timescale: 15))
        await w.finishWriting()
        if w.status != .completed { fail("selftest-failed", w.error?.localizedDescription, exit: 5) }
        emit(["selftest": path]); exit(0)
    } catch { fail("selftest-failed", "\(error)", exit: 5) }
}

// MARK: entry

let usage = """
bugwalk-helper \(helperVersion)
  select
  record --display-id N --x X --y Y --width W --height H --out DIR
  frames --video PATH --out DIR --times 1.5,2.0 [--max-width 2560]
  status            print permission state (no prompts)
  --version
"""
let argv = Array(CommandLine.arguments.dropFirst())
let flags = parseArgs(Array(argv.dropFirst()))
switch argv.first {
case "--version", "version": print(helperVersion); exit(0)
case "--help", "-h", "help", nil: print(usage); exit(0)
case "status":
    let mic = AVCaptureDevice.authorizationStatus(for: .audio)
    emit(["screen_recording": CGPreflightScreenCaptureAccess(), "microphone": mic == .authorized ? "granted" : mic == .notDetermined ? "undetermined" : "denied"])
    exit(0)
case "select": MainActor.assumeIsolated { runSelect() }
case "record": MainActor.assumeIsolated { runRecord(flags) }
case "frames": Task { await runFrames(flags) }; dispatchMain()
case "--selftest": Task { await runSelfTest(argv.count > 1 ? argv[1] : "/tmp/bugwalk-selftest.mp4") }; dispatchMain()
default: fail("bad-arguments", "unknown command \(argv[0])\n\(usage)", exit: 64)
}
