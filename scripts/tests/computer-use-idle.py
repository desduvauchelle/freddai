"""Exercise production idle/takeover guards with deterministic desktop input samples.
No global input, accounts, or provider turns. Run: python3 scripts/tests/computer-use-idle.py
"""
import pathlib, re, subprocess, tempfile
source = pathlib.Path('apps/native/computer-use/main.swift').read_text()
idle = source.split('func foregroundIsIdle() -> Bool {', 1)[1].split('\n}', 1)[0]
guard = re.search(r'guard (.*?) else \{\s*throw Failure\("Foreground control paused:', source).group(1)
program = '''import CoreGraphics
struct Desktop { var editing: Bool }
var desktop = Desktop(editing: true)
enum Input {
 static var ages: [CGEventType: Double] = [:]
 static var held = false
 static func secondsSinceLastEventType(_ state: CGEventSourceStateID, eventType: CGEventType) -> Double { ages[eventType] ?? 60 }
 static func buttonState(_ state: CGEventSourceStateID, button: CGMouseButton) -> Bool { held }
}
func foregroundIsIdle() -> Bool { IDLE
}
func permitted() -> Bool {
 guard GUARD else { return false }
 return true
}
func check(_ expected: Bool, _ name: String) {
 if permitted() != expected { print("FAIL: " + name); exit(1) }
 print("PASS: " + name)
}
check(true, "idle focused composer does not block authorized takeover")
desktop.editing = false
check(true, "idle non-editor allows takeover")
for event: CGEventType in [.keyDown, .flagsChanged, .leftMouseDown, .rightMouseDown, .mouseMoved, .leftMouseDragged, .scrollWheel] {
 Input.ages = [event: 0.5]
 check(false, "recent input still blocks: \\(event.rawValue)")
}
Input.ages = [:]
Input.held = true
check(false, "held mouse button blocks takeover")
Input.held = false
Input.ages = [.keyDown: 2]
check(true, "cooldown expires without another Ready response")
'''.replace('IDLE', idle.replace('CGEventSource.', 'Input.')).replace('GUARD', guard)
with tempfile.TemporaryDirectory() as directory:
 path = pathlib.Path(directory) / 'idle.swift'
 path.write_text(program)
 subprocess.run(['swift', str(path)], check=True)
