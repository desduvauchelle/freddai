import AppKit
final class Fixture: NSObject, NSApplicationDelegate {
    var window: NSWindow!
    let label = NSTextField(labelWithString: "Count: 0")
    var count = 0
    func applicationDidFinishLaunching(_ note: Notification) {
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 440, height: 240), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        window.title = CommandLine.arguments.contains("--witness") ? "Freddai Focus Witness" : "Freddai Computer Test Fixture"
        if CommandLine.arguments.contains("--witness") { window.setFrameOrigin(NSPoint(x: 650, y: 100)) }
        let button = NSButton(title: "Increment", target: self, action: #selector(increment))
        button.frame = NSRect(x: 30, y: 130, width: 150, height: 40)
        label.frame = NSRect(x: 30, y: 180, width: 200, height: 24)
        let input = NSTextField(frame: NSRect(x: 30, y: 60, width: 350, height: 30))
        input.placeholderString = "Test text"
        window.contentView!.addSubview(label); window.contentView!.addSubview(button); window.contentView!.addSubview(input)
        window.makeKeyAndOrderFront(nil)
        window.makeFirstResponder(CommandLine.arguments.contains("--editing") ? input : button)
        NSApp.activate(ignoringOtherApps: true)
    }
    @objc func increment() { count += 1; label.stringValue = "Count: \(count)" }
}
let app = NSApplication.shared
let delegate = Fixture()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
