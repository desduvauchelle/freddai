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
    // An exiting process does NOT tear down its SCStream: replayd keeps the capture session alive (menu bar "Sharing").
    activeRecorder?.teardownStreamSync()
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

func screenDisplayID(_ screen: NSScreen) -> CGDirectDisplayID {
    (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? CGMainDisplayID()
}

/// One pickable window for `select --mode window`. `frame` is global Quartz points (top-left origin), like SCWindow.frame.
struct PickWindow {
    let id: CGWindowID
    let frame: CGRect
    let app: String
    let bundleID: String
    let title: String
}

/// Shared by every per-screen overlay in window mode: the candidate windows (front to back) and the hovered one.
@MainActor final class WindowPicker {
    var windows: [PickWindow] = []
    var loaded = false
    var hovered: PickWindow?
    var views: [OverlayView] = []
    func hover(at global: CGPoint) {
        let hit = windows.first { $0.frame.contains(global) }
        if hit?.id != hovered?.id { hovered = hit; views.forEach { $0.needsDisplay = true } }
    }
    /// SCShareableContent does not document an order, so z-order comes from CGWindowList (front to back).
    func load() async {
        defer { loaded = true; views.forEach { $0.needsDisplay = true } }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
            let me = ProcessInfo.processInfo.processIdentifier
            let order = (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? [])
                .compactMap { ($0[kCGWindowNumber as String] as? NSNumber)?.uint32Value }
            let rank = Dictionary(order.enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
            windows = content.windows
                .filter { w in
                    guard w.windowLayer == 0, w.frame.width > 1, w.frame.height > 1, let app = w.owningApplication else { return false }
                    return app.processID != me // only the helper's own overlays are hidden; Freddai and Scout windows stay pickable
                }
                .sorted { (rank[$0.windowID] ?? Int.max) < (rank[$1.windowID] ?? Int.max) }
                .map { PickWindow(id: $0.windowID, frame: $0.frame, app: $0.owningApplication?.applicationName ?? "", bundleID: $0.owningApplication?.bundleIdentifier ?? "", title: $0.title ?? "") }
            logStage("select.windows", ["count": windows.count])
        } catch {
            logStage("select.windows-failed", ["detail": "\(error)"])
            fail("window-list-failed", "\(error)", exit: 5)
        }
        if let w = NSApp.keyWindow, let v = w.contentView as? OverlayView { v.hoverAtMouse() }
    }
}

final class OverlayView: NSView {
    let screen: NSScreen
    let picker: WindowPicker? // nil: region (drag) mode
    var start: CGPoint?
    var current: CGPoint?
    var onDone: (NSScreen, CGRect) -> Void
    var onPick: (NSScreen, PickWindow) -> Void
    var onCancel: () -> Void
    init(screen: NSScreen, picker: WindowPicker?, onDone: @escaping (NSScreen, CGRect) -> Void, onPick: @escaping (NSScreen, PickWindow) -> Void, onCancel: @escaping () -> Void) {
        self.screen = screen; self.picker = picker; self.onDone = onDone; self.onPick = onPick; self.onCancel = onCancel
        super.init(frame: CGRect(origin: .zero, size: screen.frame.size))
        if picker != nil {
            addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self, userInfo: nil))
        }
    }
    required init?(coder: NSCoder) { fatalError() }
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func resetCursorRects() { addCursorRect(bounds, cursor: picker == nil ? .crosshair : .pointingHand) }
    /// Quartz global origin of this screen (top-left).
    var displayOrigin: CGPoint { CGDisplayBounds(screenDisplayID(screen)).origin }
    func global(_ local: CGPoint) -> CGPoint { CGPoint(x: displayOrigin.x + local.x, y: displayOrigin.y + local.y) }
    var selection: CGRect? {
        guard let s = start, let c = current else { return nil }
        return CGRect(x: min(s.x, c.x), y: min(s.y, c.y), width: abs(s.x - c.x), height: abs(s.y - c.y)).intersection(bounds)
    }
    func drawLabel(_ text: String, for r: CGRect, inside: Bool) {
        let attrs: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: NSColor.white]
        var label = text as NSString
        if label.size(withAttributes: attrs).width > 480 { label = (String(text.prefix(70)) + "…") as NSString }
        let size = label.size(withAttributes: attrs)
        var box = inside ? CGRect(x: r.minX + 8, y: r.minY + 8, width: size.width + 12, height: size.height + 6)
                         : CGRect(x: r.maxX - size.width - 14, y: r.maxY + 6, width: size.width + 12, height: size.height + 6)
        if box.maxY > bounds.maxY { box.origin.y = r.maxY - box.height - 6 }
        if box.minY < 0 { box.origin.y = 4 }
        if box.minX < 0 { box.origin.x = 4 }
        NSColor.black.withAlphaComponent(0.7).setFill()
        NSBezierPath(roundedRect: box, xRadius: 4, yRadius: 4).fill()
        label.draw(at: CGPoint(x: box.minX + 6, y: box.minY + 3), withAttributes: attrs)
    }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.black.withAlphaComponent(0.25).setFill()
        bounds.fill()
        if let picker {
            if !picker.loaded { drawLabel("Loading windows…", for: CGRect(x: bounds.midX - 60, y: 40, width: 0, height: 0), inside: true); return }
            guard let w = picker.hovered else { return }
            let o = displayOrigin
            let r = w.frame.offsetBy(dx: -o.x, dy: -o.y)
            guard r.intersects(bounds) else { return }
            let ctx = NSGraphicsContext.current
            ctx?.compositingOperation = .copy
            NSColor.systemBlue.withAlphaComponent(0.18).setFill()
            r.fill()
            ctx?.compositingOperation = .sourceOver
            NSColor.systemBlue.setStroke()
            let border = NSBezierPath(rect: r.insetBy(dx: 1, dy: 1)); border.lineWidth = 2; border.stroke()
            drawLabel(w.title.isEmpty ? w.app : "\(w.app) — \(w.title)", for: r.intersection(bounds), inside: true)
            return
        }
        guard let r = selection, r.width > 0, r.height > 0 else { return }
        let ctx = NSGraphicsContext.current
        ctx?.compositingOperation = .copy
        NSColor(white: 0, alpha: 0.004).setFill() // near-clear but still hit-testable
        r.fill()
        ctx?.compositingOperation = .sourceOver
        NSColor.white.setStroke()
        let border = NSBezierPath(rect: r.insetBy(dx: 0.5, dy: 0.5)); border.lineWidth = 1; border.stroke()
        let label = "\(Int(r.width)) × \(Int(r.height))"
        drawLabel(label, for: r, inside: false)
    }
    func hoverAtMouse() {
        guard let window else { return }
        let p = convert(window.mouseLocationOutsideOfEventStream, from: nil)
        if bounds.contains(p) { picker?.hover(at: global(p)) }
    }
    override func mouseMoved(with event: NSEvent) {
        picker?.hover(at: global(convert(event.locationInWindow, from: nil)))
    }
    override func mouseDown(with event: NSEvent) {
        if let picker {
            picker.hover(at: global(convert(event.locationInWindow, from: nil)))
            return
        }
        start = convert(event.locationInWindow, from: nil); current = start; needsDisplay = true
    }
    override func mouseDragged(with event: NSEvent) {
        if picker != nil { mouseMoved(with: event); return }
        current = convert(event.locationInWindow, from: nil); needsDisplay = true
    }
    override func mouseUp(with event: NSEvent) {
        if let picker {
            picker.hover(at: global(convert(event.locationInWindow, from: nil)))
            if let w = picker.hovered { onPick(screen, w) }
            return
        }
        current = convert(event.locationInWindow, from: nil)
        guard let s = start, let c = current else { return }
        if hypot(s.x - c.x, s.y - c.y) < 4 { onDone(screen, bounds); return } // click: whole display
        if let r = selection, r.width >= 4, r.height >= 4 { onDone(screen, r) } else { start = nil; current = nil; needsDisplay = true }
    }
    override func keyDown(with event: NSEvent) {
        if event.keyCode == 53 { onCancel() } else { super.keyDown(with: event) }
    }
}

/// `select [--mode region|window]`. Prints one JSON object with `kind`: region fields stay at the top level as before;
/// window mode adds `window_id`, `bundle_id`, `app_name`, `title` (x/y are display-local, may be negative when the window
/// starts on another display).
@MainActor func runSelect(_ a: [String: String]) -> Never {
    let mode = a["mode"] ?? "region"
    guard mode == "region" || mode == "window" else { fail("bad-arguments", "--mode must be region or window", exit: 64) }
    ensurePermissions()
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    var windows: [OverlayWindow] = []
    let done: (NSScreen, CGRect) -> Void = { screen, r in
        let id = screenDisplayID(screen)
        let origin = CGDisplayBounds(id).origin // Quartz: global, top-left origin
        emit(["kind": "region", "display_id": id, "global_x": (origin.x + r.minX).rounded(), "global_y": (origin.y + r.minY).rounded(), "x": r.minX.rounded(), "y": r.minY.rounded(), "width": r.width.rounded(), "height": r.height.rounded(), "scale": screen.backingScaleFactor])
        exit(0)
    }
    let pick: (NSScreen, PickWindow) -> Void = { screen, w in
        let id = screenDisplayID(screen)
        let origin = CGDisplayBounds(id).origin
        emit(["kind": "window", "window_id": w.id, "bundle_id": w.bundleID, "app_name": w.app, "title": w.title, "display_id": id,
              "global_x": w.frame.minX.rounded(), "global_y": w.frame.minY.rounded(), "x": (w.frame.minX - origin.x).rounded(), "y": (w.frame.minY - origin.y).rounded(),
              "width": w.frame.width.rounded(), "height": w.frame.height.rounded(), "scale": screen.backingScaleFactor])
        exit(0)
    }
    let cancel: () -> Void = { exit(2) }
    let picker: WindowPicker? = mode == "window" ? WindowPicker() : nil
    for screen in NSScreen.screens {
        let w = OverlayWindow(contentRect: screen.frame, styleMask: .borderless, backing: .buffered, defer: false)
        w.level = .screenSaver
        w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false
        w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        w.acceptsMouseMovedEvents = picker != nil
        let v = OverlayView(screen: screen, picker: picker, onDone: done, onPick: pick, onCancel: cancel)
        picker?.views.append(v)
        w.contentView = v
        w.setFrame(screen.frame, display: true)
        w.makeKeyAndOrderFront(nil)
        w.makeFirstResponder(v)
        windows.append(w)
    }
    let mouse = NSEvent.mouseLocation
    if let w = windows.first(where: { $0.frame.contains(mouse) }) ?? windows.first { w.makeKey() }
    app.activate(ignoringOtherApps: true) // overlay must receive keys; unavoidable for Esc
    if let picker { Task { @MainActor in await picker.load() } }
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
    /// Set for `record --window-id`: capture that window instead of `region` on `displayID`.
    let windowID: CGWindowID?
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
    var streamTornDown = false
    var held: (sb: CMSampleBuffer, pts: CMTime)? // newest frame, not yet appended: its duration is unknown until the next frame arrives
    var writerFailureDetail: String? // first failure, with the time it was noticed
    let videoQ = DispatchQueue(label: "bugwalk.video")
    var outline: NSWindow?
    var levelTimer: Timer?

    init(displayID: CGDirectDisplayID, region: CGRect, windowID: CGWindowID? = nil, dir: URL) { self.displayID = displayID; self.region = region; self.windowID = windowID; self.dir = dir }

    @MainActor func start() async {
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            // Window mode: look the window up again now; it may have closed since `select`.
            var target: SCWindow?
            if let windowID {
                let all = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let found = all.windows.first(where: { $0.windowID == windowID }) else {
                    fail("window-gone", "The window you picked (\(windowID)) was closed before recording started", exit: 5)
                }
                target = found
            }
            // Quartz global (top-left) -> Cocoa global (bottom-left of the primary screen).
            let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
            let screen: NSScreen
            if let target {
                let center = CGPoint(x: target.frame.midX, y: primaryHeight - target.frame.midY)
                screen = NSScreen.screens.first(where: { $0.frame.contains(center) })
                    ?? NSScreen.screens.first(where: { screenDisplayID($0) == displayID }) ?? NSScreen.main ?? NSScreen.screens[0]
            } else {
                guard let s = NSScreen.screens.first(where: { screenDisplayID($0) == displayID }) else { fail("display-not-found", "display \(displayID)") }
                screen = s
            }
            let scale = screen.backingScaleFactor
            // Red outline sits 2 pt outside the region (or the window's frame at start; it does not follow the window).
            let f = screen.frame
            let rect = target.map { CGRect(x: $0.frame.minX - 2, y: primaryHeight - $0.frame.maxY - 2, width: $0.frame.width + 4, height: $0.frame.height + 4) }
                ?? CGRect(x: f.minX + region.minX - 2, y: f.minY + f.height - region.maxY - 2, width: region.width + 4, height: region.height + 4)
            let w = NSWindow(contentRect: rect, styleMask: .borderless, backing: .buffered, defer: false)
            w.level = .screenSaver; w.isOpaque = false; w.backgroundColor = .clear; w.hasShadow = false
            w.ignoresMouseEvents = true; w.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
            w.contentView = OutlineView(frame: CGRect(origin: .zero, size: rect.size))
            w.orderFrontRegardless()
            outline = w

            let filter: SCContentFilter
            let cfg = SCStreamConfiguration()
            let size: CGSize
            if let target {
                // Only this window is captured (the outline is excluded by construction). No sourceRect: SCK scales the
                // window into the fixed size below even if it is resized later.
                filter = SCContentFilter(desktopIndependentWindow: target)
                size = target.frame.size
                logStage("record.window", ["window_id": Int(target.windowID), "width": size.width, "height": size.height, "scale": scale])
            } else {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
                guard let display = content.displays.first(where: { $0.displayID == displayID }) else { fail("display-not-found", "ScreenCaptureKit has no display \(displayID)") }
                let excluded = content.windows.filter { $0.windowID == CGWindowID(w.windowNumber) }
                filter = SCContentFilter(display: display, excludingWindows: excluded)
                cfg.sourceRect = region
                size = region.size
            }
            let pw = max(2, Int((size.width * scale).rounded()) & ~1), ph = max(2, Int((size.height * scale).rounded()) & ~1)
            cfg.width = pw; cfg.height = ph
            cfg.minimumFrameInterval = CMTime(value: 1, timescale: 15)
            cfg.showsCursor = true
            cfg.pixelFormat = kCVPixelFormatType_32BGRA
            cfg.queueDepth = 6

            // Fragmented QuickTime (stays playable after SIGKILL); fragmented .mp4 failed with -16341 at the 2nd fragment flush.
            // Frames carry explicit durations via `held` (see the frame handler), so a static screen still yields a full-length movie.
            // AVVideoMaxKeyFrameIntervalKey counts frames, so sparse SCK delivery (idle screen) could go many seconds without a keyframe
            // and a fragment cannot be cut without one; the Duration key caps it in seconds.
            writer = try AVAssetWriter(url: dir.appendingPathComponent(Recorder.videoName), fileType: .mov)
            writer.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)
            vInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: pw, AVVideoHeightKey: ph,
                AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: max(1_500_000, pw * ph * 2), AVVideoExpectedSourceFrameRateKey: 15, AVVideoMaxKeyFrameIntervalKey: 30, AVVideoMaxKeyFrameIntervalDurationKey: 1, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
            ])
            vInput.expectsMediaDataInRealTime = true
            writer.add(vInput)
            guard writer.startWriting() else { fail("writer-failed", writerFailure(at: 0).detail) }

            wav = try WavWriter(url: dir.appendingPathComponent("audio.wav"))
            try startAudio()

            let s = SCStream(filter: filter, configuration: cfg, delegate: self)
            try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: videoQ)
            stream = s // before startCapture: a failing/aborted start must still be able to stopCapture
            try await s.startCapture()
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

    /// Blocking, idempotent stopCapture for exit paths (fail, atexit). Never holds `lock` while waiting.
    func teardownStreamSync() {
        let s: SCStream? = lock.withLock { if streamTornDown { return nil }; streamTornDown = true; return stream }
        guard let s else { return }
        let sem = DispatchSemaphore(value: 0)
        var err: Error?
        s.stopCapture { e in err = e; sem.signal() }
        let ok = sem.wait(timeout: .now() + 2) == .success
        logStage("stop.capture-teardown", ["ok": ok && err == nil, "timed_out": !ok, "error": err.map { "\($0)" } ?? ""])
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

    static let videoName = "recording.mov"

    /// One readable line plus structured fields for a failed AVAssetWriter, e.g.
    /// "Video writer failed (AVFoundation -11800, OSStatus -16341) at 4.2s".
    func writerFailure(at seconds: Double) -> (detail: String, fields: [String: Any]) {
        let err = writer?.error as NSError?
        let under = err?.userInfo[NSUnderlyingErrorKey] as? NSError
        var codes: [String] = []
        if let err { codes.append("\(err.domain == AVFoundationErrorDomain ? "AVFoundation" : err.domain) \(err.code)") }
        if let under { codes.append("\(under.domain == NSOSStatusErrorDomain ? "OSStatus" : under.domain) \(under.code)") }
        let status = writer?.status.rawValue ?? -1
        if codes.isEmpty { codes.append("writer status \(status)") }
        let at = (seconds * 10).rounded() / 10
        let detail = "Video writer failed (\(codes.joined(separator: ", "))) at \(at)s"
        var fields: [String: Any] = ["detail": detail, "writer_status": status, "at_s": at, "error": err.map { "\($0)" } ?? ""]
        if let err { fields["av_code"] = err.code }
        if let under { fields["os_status"] = under.code }
        return (detail, fields)
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferIsValid(sb), CMSampleBufferGetImageBuffer(sb) != nil else { return }
        guard let atts = CMSampleBufferGetSampleAttachmentsArray(sb, createIfNecessary: false) as? [[SCStreamFrameInfo: Any]],
              let st = atts.first?[.status] as? Int, st == SCFrameStatus.complete.rawValue else { return }
        let pts = CMSampleBufferGetPresentationTimeStamp(sb)
        lock.lock()
        if stopping { lock.unlock(); return }
        // Fragmented movies need every sample's duration up front: SCK's buffers carry an invalid duration, and the writer cannot
        // infer the last sample of a fragment, so it writes a tfdt that disagrees with the next fragment and fails (-16341) at
        // the 2nd+ flush, or silently truncates (a static screen delivers ONE frame: the file ended up 0.07 s long). Hence `held`: each frame is
        // appended only once the next arrives, with duration = next pts - pts (integer 1/600 s ticks). Time also starts at 0.
        // Non-fragmented output rewrites the timing table at the end, which hid this in the old self-test.
        if t0 == nil { t0 = pts.seconds; writer.startSession(atSourceTime: .zero); logStage("record.first-frame", ["pts": pts.seconds]) }
        let base = t0 ?? pts.seconds
        lastVideoPTS = pts.seconds
        lock.unlock()
        if writer.status == .failed {
            let warn: Bool = lock.withLock { let w = !warnedWriter; warnedWriter = true; return w }
            if warn {
                let failure = writerFailure(at: pts.seconds - base)
                lock.withLock { writerFailureDetail = failure.detail }
                logStage("record.writer-failed", failure.fields)
                emit(["event": "warning", "code": "writer-failed", "detail": failure.detail])
            }
            return
        }
        // Hold each frame until the next one arrives so it gets an explicit duration (next pts - its pts, integer ticks).
        lock.lock(); defer { lock.unlock() }
        if stopping { return } // stop() flushes `held` and finishes the input; nothing may be appended after that
        let cur = CMTime(seconds: pts.seconds - base, preferredTimescale: 600)
        guard let h = held else { held = (sb, cur); return }
        guard cur > h.pts else { return } // two frames in one tick: drop the newer one
        if vInput.isReadyForMoreMediaData { appendVideo(h.sb, pts: h.pts, duration: cur - h.pts); held = (sb, cur) } // else keep holding the old frame, drop this one
    }

    /// Retime to the movie timeline and append; caller holds `lock`.
    func appendVideo(_ sb: CMSampleBuffer, pts: CMTime, duration: CMTime) {
        var timing = CMSampleTimingInfo(duration: duration, presentationTimeStamp: pts, decodeTimeStamp: .invalid)
        var shifted: CMSampleBuffer?
        let status = CMSampleBufferCreateCopyWithNewTiming(allocator: nil, sampleBuffer: sb, sampleTimingEntryCount: 1, sampleTimingArray: &timing, sampleBufferOut: &shifted)
        if status == noErr, let shifted { vInput.append(shifted) } else { logStage("record.retime-failed", ["status": Int(status)]) }
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
        lock.withLock { streamTornDown = true }
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
            lock.withLock { // the last frame lasts until the end of the recording
                if let h = held, writer.status == .writing, vInput.isReadyForMoreMediaData {
                    let endT = CMTime(seconds: duration, preferredTimescale: 600)
                    appendVideo(h.sb, pts: h.pts, duration: max(CMTime(value: 1, timescale: 600), endT - h.pts))
                }
                held = nil
            }
            vInput.markAsFinished()
            writer.endSession(atSourceTime: CMTime(seconds: duration, preferredTimescale: 600))
            // If the movie never finishes, still finalize the wav and report instead of hanging until Rust SIGKILLs us.
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
        let video = dir.appendingPathComponent(Recorder.videoName)
        let videoSize = ((try? FileManager.default.attributesOfItem(atPath: video.path))?[.size] as? NSNumber)?.intValue ?? 0
        var o: [String: Any] = ["event": "stopped", "duration_s": (duration * 1000).rounded() / 1000]
        if writer.status == .completed {
            if let reason { o["reason"] = reason }
            if let detail { o["detail"] = detail }
        } else if videoSize > 0 { // fragmented movie is still playable: continue with what exists
            o["reason"] = "writer-failed"; o["partial"] = true
            o["detail"] = lock.withLock { writerFailureDetail } ?? writerFailure(at: duration).detail
            if let reason { o["stop_reason"] = reason }
        } else {
            fail("writer-failed", writerFailure(at: duration).detail, exit: 5)
        }
        logStage("stop.emit", ["event": o])
        emit(o)
        exit(0)
    }
}

var activeRecorder: Recorder?
var signalSources: [DispatchSourceSignal] = []

@MainActor func runRecord(_ a: [String: String]) -> Never {
    let dir = URL(fileURLWithPath: require(a, "out"))
    let windowID: CGWindowID? = a["window-id"].map { v in
        guard let n = UInt32(v) else { fail("bad-arguments", "--window-id must be a window number", exit: 64) }
        return n
    }
    let id: CGDirectDisplayID, r: CGRect
    if windowID != nil {
        id = a["display-id"].flatMap { UInt32($0) } ?? CGMainDisplayID() // only a hint for the scale
        r = .zero
    } else {
        id = CGDirectDisplayID(requireNum(a, "display-id"))
        r = CGRect(x: requireNum(a, "x"), y: requireNum(a, "y"), width: requireNum(a, "width"), height: requireNum(a, "height"))
        guard r.width >= 2, r.height >= 2 else { fail("bad-arguments", "region too small", exit: 64) }
    }
    ensurePermissions()
    NSApplication.shared.setActivationPolicy(.accessory)
    let rec = Recorder(displayID: id, region: r, windowID: windowID, dir: dir)
    activeRecorder = rec
    atexit { activeRecorder?.teardownStreamSync() }
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

// MARK: audio (companion uploads: phone video -> 16 kHz mono pcm16 WAV)

func wavHeader(dataBytes: UInt32) -> Data {
    var h = Data()
    func u32(_ v: UInt32) { var x = v.littleEndian; h.append(Data(bytes: &x, count: 4)) }
    func u16(_ v: UInt16) { var x = v.littleEndian; h.append(Data(bytes: &x, count: 2)) }
    h.append(contentsOf: Array("RIFF".utf8)); u32(36 &+ dataBytes); h.append(contentsOf: Array("WAVE".utf8))
    h.append(contentsOf: Array("fmt ".utf8)); u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
    h.append(contentsOf: Array("data".utf8)); u32(dataBytes)
    return h
}

func runAudio(_ a: [String: String]) async -> Never {
    let video = URL(fileURLWithPath: require(a, "video"))
    let out = URL(fileURLWithPath: require(a, "out"))
    do {
        guard FileManager.default.fileExists(atPath: video.path) else { fail("video-missing", video.path, exit: 5) }
        let asset = AVURLAsset(url: video)
        let duration = try await asset.load(.duration).seconds
        guard let vtrack = try await asset.loadTracks(withMediaType: .video).first else { fail("no-video-track", video.path, exit: 5) }
        let natural = try await vtrack.load(.naturalSize)
        let transform = try await vtrack.load(.preferredTransform)
        let rect = CGRect(origin: .zero, size: natural).applying(transform)
        let width = abs(rect.width).rounded(), height = abs(rect.height).rounded()
        logStage("audio-start", ["video": video.path, "duration_s": duration, "width": width, "height": height])
        FileManager.default.createFile(atPath: out.path, contents: nil)
        let handle = try FileHandle(forWritingTo: out)
        try handle.write(contentsOf: wavHeader(dataBytes: 0))
        var dataBytes: UInt64 = 0
        let atrack = try await asset.loadTracks(withMediaType: .audio).first
        if let atrack {
            let reader = try AVAssetReader(asset: asset)
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
            ]
            let output = AVAssetReaderTrackOutput(track: atrack, outputSettings: settings)
            guard reader.canAdd(output) else { fail("audio-failed", "cannot read audio track", exit: 5) }
            reader.add(output)
            guard reader.startReading() else { fail("audio-failed", reader.error?.localizedDescription ?? "startReading failed", exit: 5) }
            while let sb = output.copyNextSampleBuffer() {
                guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
                let n = CMBlockBufferGetDataLength(block)
                var chunk = Data(count: n)
                let status = chunk.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: n, destination: $0.baseAddress!) }
                if status != kCMBlockBufferNoErr { fail("audio-failed", "block copy status \(status)", exit: 5) }
                try handle.write(contentsOf: chunk)
                dataBytes += UInt64(n)
            }
            if reader.status == .failed { fail("audio-failed", reader.error?.localizedDescription ?? "read failed", exit: 5) }
        }
        try handle.seek(toOffset: 0)
        try handle.write(contentsOf: wavHeader(dataBytes: UInt32(clamping: dataBytes)))
        try handle.close()
        logStage("audio-done", ["data_bytes": dataBytes])
        emit(["duration_s": duration, "width": width, "height": height, "audio": atrack != nil])
        exit(0)
    } catch { fail("audio-failed", "\(error)", exit: 5) }
}

// MARK: selftest (hidden): writes a ~7 s fragmented mov with irregular frame gaps, the way Recorder does

func runSelfTest(_ path: String) async -> Never {
    do {
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.removeItem(at: url)
        let w = try AVAssetWriter(url: url, fileType: .mov)
        w.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600) // same as Recorder: a non-fragmented writer hid the real bug
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: 640, AVVideoHeightKey: 400, AVVideoCompressionPropertiesKey: [AVVideoMaxKeyFrameIntervalKey: 30, AVVideoMaxKeyFrameIntervalDurationKey: 1]])
        input.expectsMediaDataInRealTime = true
        w.add(input); w.startWriting(); w.startSession(atSourceTime: .zero)
        // Sparse, irregular SCK-like timing in 600 Hz ticks (1/15 s = 40, 1/3 s = 200, 1.2 s = 720); total >= 7 s of media time.
        let gaps: [Int64] = [40, 40, 200, 40, 720, 40, 200, 40, 40, 720, 200, 40, 40, 200, 720, 40, 40, 200, 720, 40]
        var pts: [Int64] = [0]
        for g in gaps { pts.append(pts.last! + g) }
        let end = pts.last! + 40
        var fmt: CMVideoFormatDescription?
        for (i, t) in pts.enumerated() {
            var pb: CVPixelBuffer?
            CVPixelBufferCreate(nil, 640, 400, kCVPixelFormatType_32BGRA, nil, &pb)
            guard let buf = pb else { continue }
            CVPixelBufferLockBaseAddress(buf, [])
            let base = CVPixelBufferGetBaseAddress(buf)!.assumingMemoryBound(to: UInt8.self), stride = CVPixelBufferGetBytesPerRow(buf)
            for y in 0..<400 { for x in 0..<640 {
                let o = y * stride + x * 4
                let inBox = abs(x - (20 + i * 25)) < 30 && abs(y - 200) < 30
                base[o] = inBox ? 255 : UInt8(x / 3); base[o + 1] = inBox ? 255 : UInt8(y / 2); base[o + 2] = inBox ? 255 : UInt8((i % 32) * 8); base[o + 3] = 255
            } }
            CVPixelBufferUnlockBaseAddress(buf, [])
            if fmt == nil { CMVideoFormatDescriptionCreateForImageBuffer(allocator: nil, imageBuffer: buf, formatDescriptionOut: &fmt) }
            // Explicit duration = next pts - pts, like Recorder.appendVideo.
            var timing = CMSampleTimingInfo(duration: CMTime(value: (i + 1 < pts.count ? pts[i + 1] : end) - t, timescale: 600), presentationTimeStamp: CMTime(value: t, timescale: 600), decodeTimeStamp: .invalid)
            var sb: CMSampleBuffer?
            CMSampleBufferCreateReadyWithImageBuffer(allocator: nil, imageBuffer: buf, formatDescription: fmt!, sampleTiming: &timing, sampleBufferOut: &sb)
            while !input.isReadyForMoreMediaData { try await Task.sleep(nanoseconds: 2_000_000) }
            if let sb { input.append(sb) }
            try await Task.sleep(nanoseconds: 100_000_000) // let the fragment timer run while media time advances
            if w.status == .failed { break }
        }
        input.markAsFinished()
        w.endSession(atSourceTime: CMTime(value: end, timescale: 600))
        await w.finishWriting()
        if w.status != .completed { fail("selftest-failed", w.error?.localizedDescription, exit: 5) }
        let got = try await AVURLAsset(url: url).load(.duration).seconds, want = Double(end) / 600
        if abs(got - want) > 0.5 { fail("selftest-failed", "duration \(got) s, expected \(want) s (truncated fragments?)", exit: 5) }
        emit(["selftest": path, "duration_s": got]); exit(0)
    } catch { fail("selftest-failed", "\(error)", exit: 5) }
}

// MARK: entry

let usage = """
bugwalk-helper \(helperVersion)
  select [--mode region|window]
  record --display-id N --x X --y Y --width W --height H --out DIR
  record --window-id N [--display-id N] --out DIR
  frames --video PATH --out DIR --times 1.5,2.0 [--max-width 2560]
  audio --video PATH --out WAV   extract 16 kHz mono pcm16 audio + print duration/size JSON
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
case "select": MainActor.assumeIsolated { runSelect(flags) }
case "record": MainActor.assumeIsolated { runRecord(flags) }
case "frames": Task { await runFrames(flags) }; dispatchMain()
case "audio": Task { await runAudio(flags) }; dispatchMain()
case "--selftest": Task { await runSelfTest(argv.count > 1 ? argv[1] : "/tmp/bugwalk-selftest.mov") }; dispatchMain()
default: fail("bad-arguments", "unknown command \(argv[0])\n\(usage)", exit: 64)
}
