import AppKit
let p=CGEvent(source:nil)!.location
let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String:Any]] ?? []
let overlays = windows.filter { $0[kCGWindowName as String] as? String == "Freddai Agent Cursor" }.compactMap { $0[kCGWindowNumber as String] as? Int }
let data=try! JSONSerialization.data(withJSONObject:["pid":NSWorkspace.shared.frontmostApplication!.processIdentifier,"mouse":[p.x,p.y],"overlays":overlays])
print(String(decoding:data,as:UTF8.self))
