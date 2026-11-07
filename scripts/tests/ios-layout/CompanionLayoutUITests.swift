import XCTest
import UIKit

/// Runs against the separately installed offline fixture app. Never use this against a paired device.
final class CompanionLayoutUITests: XCTestCase {
  @MainActor
  func testDashboardUsesNativeCardsAndProjectAgentSelection() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    menu.tap()
    let dashboard = app.buttons["companion-dashboard"]
    XCTAssertTrue(dashboard.waitForExistence(timeout: 5)); dashboard.tap()
    let expand = app.buttons["Expand office"]
    XCTAssertTrue(expand.waitForExistence(timeout: 5)); expand.tap()
    let close = app.buttons["Close office"]
    XCTAssertTrue(close.waitForExistence(timeout: 5)); close.tap()
    let agent = app.buttons["dashboard-agent"]
    XCTAssertTrue(agent.waitForExistence(timeout: 5))
    let scroll = app.scrollViews["dashboard-scroll"]
    XCTAssertTrue(scroll.exists)
    XCTAssertTrue(app.staticTexts["Daily summaries"].exists)
    XCTAssertTrue(app.staticTexts["dashboard-summary-body"].exists)
    if !agent.isHittable { scroll.swipeUp() }
    XCTAssertTrue(agent.isHittable)
    let create = app.buttons["dashboard-new-freddai"]
    XCTAssertTrue(create.exists)
    if !create.isHittable { scroll.swipeUp() }
    XCTAssertLessThanOrEqual(create.frame.width, 48)
    let microphone = app.buttons["dashboard-mic-freddai"]
    XCTAssertEqual(create.frame.midY, microphone.frame.midY, accuracy: 2)
    XCTAssertGreaterThan(microphone.frame.minX, create.frame.minX)
    if UIDevice.current.userInterfaceIdiom == .pad {
      let second = app.buttons["dashboard-new-lucy-web"]
      XCTAssertTrue(second.exists)
      XCTAssertGreaterThan(second.frame.minX, create.frame.minX)
      XCTAssertEqual(second.frame.minY, create.frame.minY, accuracy: 5)
    }
    // A native accessibility identifier proves these are UIKit controls, not the web fallback.
    XCTAssertTrue(app.buttons["dashboard-mic-freddai"].exists)
    if UIDevice.current.userInterfaceIdiom != .pad {
      let beforeScroll = agent.frame.minY
      scroll.swipeUp()
      XCTAssertLessThan(agent.frame.minY, beforeScroll)
      scroll.swipeDown()
    }
    if !agent.isHittable { scroll.swipeUp() }
    agent.tap()
    let codex = app.buttons["Codex · Work"]
    XCTAssertTrue(codex.waitForExistence(timeout: 5)); codex.tap()
    XCTAssertTrue(agent.waitForExistence(timeout: 5))
    let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    shot.name = "Native dashboard cards"; shot.lifetime = .keepAlways; add(shot)
    create.tap()
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 5))
    XCTAssertTrue(app.buttons["Coding agent: Codex · Work"].waitForExistence(timeout: 5))
  }

  /// Commander-in-Chief: first in the drawer with the mascot, opens its screen (translucent header, tabs, approval above the composer).
  /// Saves light and dark screenshots to output/screenshots/ at the repo root.
  @MainActor
  func testCommanderOpensFromDrawerAndDashboard() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    let isPad = UIDevice.current.userInterfaceIdiom == .pad
    let list = app.collectionViews["thread-drawer-list"]
    if !list.waitForExistence(timeout: 2) { menu.tap() }
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let toggle = app.segmentedControls["thread-view-toggle"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    toggle.buttons["Projects"].tap()
    // First group in the drawer, ahead of every other project.
    let header = list.cells["project-header-commander"]
    XCTAssertTrue(header.waitForExistence(timeout: 5))
    let other = list.cells["project-header-freddai"]
    XCTAssertTrue(other.exists)
    XCTAssertLessThan(header.frame.minY, other.frame.minY)
    XCTAssertTrue(header.images["drawer-commander-icon"].exists || header.label.contains("Commander"))
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let dir = ProcessInfo.processInfo.environment["FREDDAI_SCREENSHOT_DIR"] ?? root.appendingPathComponent("output/screenshots").path
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    func shoot(_ name: String) {
      let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      shot.name = name; shot.lifetime = .keepAlways; add(shot)
      try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
    }
    for dark in [false, true] {
      if #available(iOS 17.0, *) { XCUIDevice.shared.appearance = dark ? .dark : .light }
      let mode = dark ? "dark" : "light"
      shoot("commander-drawer-\(mode)")
      // Selecting it opens the Commander screen instead of collapsing the group.
      header.tap()
      // Compact floating header: avatar on the same row as the native menu button, no tab bar and no pinned approval card.
      let avatar = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "open To-dos, Notes")).firstMatch
      XCTAssertTrue(avatar.waitForExistence(timeout: 10), "Commander avatar did not appear")
      XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Commander-in-Chief")).firstMatch.exists)
      XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND elementType == %d", "Waiting", XCUIElement.ElementType.tab.rawValue)).firstMatch.exists, "Tab bar must be gone")
      XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Start a task in Lucy Web")).firstMatch.exists, "Approval card must not be pinned above the composer")
      if !isPad {
        // Avatar centred on the menu row (not stacked below it); the header takes at most ~15% of the screen.
        XCTAssertLessThan(abs(avatar.frame.midY - menu.frame.midY), 20, "Avatar must sit on the same row as the hamburger")
        XCTAssertLessThan(avatar.frame.maxY, app.frame.height * 0.15, "Header avatar must stay within the top 15% of the screen")
      }
      shoot("commander-chat-\(mode)")
      if !isPad {
        // Keyboard open: the avatar must stay on the hamburger's row (it is anchored to the top edge, not to the resized layout).
        let before = (avatar.frame.midY, menu.frame.midY)
        app.textViews.firstMatch.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Software keyboard must be visible (disable Connect Hardware Keyboard)")
        sleep(1)
        print("FRAMES commander closed avatarMidY=\(before.0) menuMidY=\(before.1) open avatarMidY=\(avatar.frame.midY) menuMidY=\(menu.frame.midY)")
        XCTAssertLessThan(abs(avatar.frame.midY - menu.frame.midY), 12, "Avatar must stay on the hamburger row with the keyboard open")
        XCTAssertLessThan(abs(avatar.frame.midY - before.0), 4, "Avatar must not move when the keyboard opens")
        shoot("commander-keyboard-\(mode)")
        app.typeText("\n")
        if app.keyboards.count > 0 { app.swipeDown() }
      }
      avatar.tap()
      sleep(1)
      XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Expand sheet")).firstMatch.waitForExistence(timeout: 5), "Commander sheet did not open")
      XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Start a task in Lucy Web")).firstMatch.waitForExistence(timeout: 5), "Pending approval belongs in the Waiting tab of the sheet")
      shoot("commander-sheet-\(mode)")
      app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Expand sheet")).firstMatch.tap()
      sleep(1)
      shoot("commander-sheet-large-\(mode)")
      let todos = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH %@ AND (elementType == %d OR elementType == %d)", "To-dos", XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.tab.rawValue)).firstMatch
      if todos.exists { todos.tap(); XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "Review the dark mode pricing page")).firstMatch.waitForExistence(timeout: 5)) }
      shoot("commander-sheet-todos-\(mode)")
      // Tapping the dimmed chat above the sheet closes it.
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
      sleep(1)
      XCTAssertFalse(app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Expand sheet")).firstMatch.exists, "Sheet should close from the backdrop")
      // Back to the drawer for the next appearance (a sidebar on wide layouts, an overlay otherwise).
      if !(list.exists && list.isHittable) { menu.tap() }
      XCTAssertTrue(list.waitForExistence(timeout: 5))
    }
    if #available(iOS 17.0, *) { XCUIDevice.shared.appearance = .light }
  }

  /// Regular threads share the translucent floating header: avatar + title pill on the menu row, transcript scrolling behind it.
  @MainActor
  func testRegularThreadUsesFloatingHeader() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    let list = app.collectionViews["thread-drawer-list"]
    if !list.waitForExistence(timeout: 2) { menu.tap() }
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let toggle = app.segmentedControls["thread-view-toggle"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    toggle.buttons["Recent"].tap()
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    let dir = ProcessInfo.processInfo.environment["FREDDAI_SCREENSHOT_DIR"] ?? root.appendingPathComponent("output/screenshots").path
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    func shoot(_ name: String) {
      let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      shot.name = name; shot.lifetime = .keepAlways; add(shot)
      try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
    }
    // Pick the first Recent row that is not Commander's.
    var opened = false
    for index in 0..<4 where !opened {
      let row = list.cells.element(boundBy: index)
      guard row.waitForExistence(timeout: 3), !row.label.contains("Commander") else { continue }
      row.tap(); opened = true
    }
    XCTAssertTrue(opened)
    let header = app.descendants(matching: .any).matching(NSPredicate(format: "label ENDSWITH %@", " header")).firstMatch
    XCTAssertTrue(header.waitForExistence(timeout: 10), "Regular thread must show the floating header")
    let isPad = UIDevice.current.userInterfaceIdiom == .pad
    let before = header.frame
    if !isPad { XCTAssertLessThan(header.frame.maxY, app.frame.height * 0.18, "Header must stay within the top 18% of the screen") }
    for dark in [false, true] {
      if #available(iOS 17.0, *) { XCUIDevice.shared.appearance = dark ? .dark : .light }
      let mode = dark ? "dark" : "light"
      sleep(1)
      shoot("thread-header-\(mode)")
      if !isPad && !dark {
        // Queue a follow-up (replies are stalled in the fixture) so the queued-message strip shows, then open the SOFTWARE keyboard.
        let field = app.textViews.firstMatch
        field.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Software keyboard must be visible (disable Connect Hardware Keyboard)")
        field.typeText("Queued follow-up while the keyboard is open")
        app.buttons["Send"].tap()
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "queued on this device")).firstMatch.waitForExistence(timeout: 10), "Queued-message strip must be shown")
        if !app.keyboards.firstMatch.exists { field.tap() }
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Software keyboard must be visible")
        sleep(1)
        let strip = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "queued on this device")).firstMatch
        print("FRAMES thread keyboard=\(app.keyboards.firstMatch.frame) header closed=\(before) open=\(header.frame) menuMidY=\(menu.frame.midY) strip=\(strip.frame)")
        XCTAssertEqual(header.frame.minY, before.minY, accuracy: 1, "Header must not move when the keyboard opens")
        XCTAssertEqual(header.frame.height, before.height, accuracy: 1)
        XCTAssertLessThan(abs(header.frame.midY - before.midY), 4)
        XCTAssertGreaterThanOrEqual(strip.frame.minY, header.frame.maxY - 1, "Queued strip must start below the header")
        shoot("thread-header-keyboard-\(mode)")
        if app.keyboards.count > 0 { app.swipeDown() }
      }
      // Scroll the transcript up a little so earlier text sits behind the blurred header.
      app.webViews.firstMatch.swipeDown(velocity: .slow)
      sleep(1)
      shoot("thread-header-scrolled-\(mode)")
      app.webViews.firstMatch.swipeUp(velocity: .fast)
    }
    if #available(iOS 17.0, *) { XCUIDevice.shared.appearance = .light }
  }

  @MainActor
  func testCommanderClusterOnNativeDashboard() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    menu.tap()
    let dashboard = app.buttons["companion-dashboard"]
    XCTAssertTrue(dashboard.waitForExistence(timeout: 5)); dashboard.tap()
    let avatar = app.buttons["dashboard-commander-avatar"]
    XCTAssertTrue(avatar.waitForExistence(timeout: 10))
    let mic = app.buttons["dashboard-commander-mic"], plus = app.buttons["dashboard-commander-plus"]
    XCTAssertTrue(mic.exists && plus.exists)
    // Mic overlaps the avatar's bottom-left, plus its bottom-right; both are at least 44pt.
    XCTAssertLessThan(mic.frame.midX, avatar.frame.midX)
    XCTAssertGreaterThan(plus.frame.midX, avatar.frame.midX)
    XCTAssertGreaterThanOrEqual(mic.frame.width, 44); XCTAssertGreaterThanOrEqual(plus.frame.height, 44)
    XCTAssertGreaterThan(mic.frame.midY, avatar.frame.midY)
    XCTAssertLessThan(mic.frame.minY, avatar.frame.maxY)
    XCTAssertTrue(app.buttons["dashboard-commander-pill"].exists)
    avatar.tap()
    // The Commander chat opens with its floating header; the sheet (not a tab bar) holds To-dos, Notes and Waiting.
    XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", "open To-dos, Notes")).firstMatch.waitForExistence(timeout: 10))
  }

  @MainActor
  func testProjectDragReordersEntireGroups() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    let list = app.collectionViews["thread-drawer-list"]
    if !list.waitForExistence(timeout: 2) { menu.tap() }
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let toggle = app.segmentedControls["thread-view-toggle"]
    if !toggle.waitForExistence(timeout: 2) { menu.tap() }
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    toggle.buttons["Projects"].tap()
    let first = list.cells["project-header-freddai"]
    let second = list.cells["project-header-lucy-web"]
    XCTAssertTrue(first.waitForExistence(timeout: 5))
    // Collapse the first group so both targets are visible on a phone.
    first.tap()
    XCTAssertTrue(second.waitForExistence(timeout: 5))
    let start = second.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.5))
    let end = first.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.2))
    start.press(forDuration: 0.8, thenDragTo: end)
    let reordered = NSPredicate { _, _ in second.frame.minY < first.frame.minY }
    expectation(for: reordered, evaluatedWith: nil)
    waitForExpectations(timeout: 5)
    // A model refresh must retain both the saved order and each group's content.
    sleep(3)
    XCTAssertLessThan(second.frame.minY, first.frame.minY)
    XCTAssertTrue(list.cells["project-header-freddai"].exists)
  }

  @MainActor
  func testDrawerProjectsRecentToggle() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .portrait
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    let isPad = UIDevice.current.userInterfaceIdiom == .pad
    // The persistent sidebar is landscape-only (CompanionLayout.showsSidebar); portrait iPad uses the overlay drawer too.
    menu.tap()
    let list = app.collectionViews["thread-drawer-list"]
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let toggle = app.segmentedControls["thread-view-toggle"]
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    // The choice persists across launches (JS-owned preference), so start from a known mode.
    toggle.buttons["Projects"].tap()
    XCTAssertTrue(toggle.buttons["Projects"].isSelected)
    func shoot(_ name: String) {
      let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      shot.name = name
      shot.lifetime = .keepAlways
      add(shot)
      if let dir = ProcessInfo.processInfo.environment["FREDDAI_SCREENSHOT_DIR"] ?? Optional("/tmp/freddai-drawer") {
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        try? XCUIScreen.main.screenshot().pngRepresentation.write(to: URL(fileURLWithPath: dir + "/" + name + ".png"))
      }
    }
    let sectionTitle = list.staticTexts["Recent"]
    func scrollTo(_ element: XCUIElement) {
      var tries = 0
      while !(element.exists && element.isHittable) && tries < 12 { list.swipeUp(); tries += 1 }
    }
    for dark in [false, true] {
      if #available(iOS 17.0, *) { XCUIDevice.shared.appearance = dark ? .dark : .light }
      let mode = dark ? "dark" : "light"
      toggle.buttons["Projects"].tap()
      XCTAssertTrue(toggle.buttons["Projects"].isSelected)
      shoot("drawer-projects-\(mode)")
      // Always-visible Recent section at the bottom of the Projects view: 5 rows, +10, then Show less.
      scrollTo(sectionTitle)
      XCTAssertTrue(sectionTitle.exists)
      let sectionMore = list.cells["Show more"]
      scrollTo(sectionMore)
      XCTAssertTrue(sectionMore.exists)
      list.swipeUp()
      shoot("drawer-projects-bottom-recent-section-\(mode)")
      sectionMore.tap()
      scrollTo(list.cells["Show less"])
      XCTAssertTrue(list.cells["Show less"].exists)
      shoot("drawer-projects-bottom-recent-section-expanded-\(mode)")
      list.cells["Show less"].tap()
      XCTAssertTrue(list.cells["Show more"].waitForExistence(timeout: 3))
      // Recent view: 25 rows, Show more, Show less.
      toggle.buttons["Recent"].tap()
      XCTAssertTrue(toggle.buttons["Recent"].isSelected)
      XCTAssertFalse(list.staticTexts["Recent"].exists)
      shoot("drawer-recent-\(mode)")
      list.swipeUp()
      shoot("drawer-recent-scrolled-\(mode)")
      let more = list.cells["Show more"]
      scrollTo(more)
      if more.exists { more.tap(); shoot("drawer-recent-more-\(mode)"); let less = list.cells["Show less"]; scrollTo(less); XCTAssertTrue(less.waitForExistence(timeout: 3)); less.tap(); XCTAssertTrue(list.cells["Show more"].waitForExistence(timeout: 3)) }
    }
    // Opening a Recent row opens the thread like the project view does.
    toggle.buttons["Recent"].tap()
    let first = list.cells.element(boundBy: 0)
    XCTAssertTrue(first.waitForExistence(timeout: 3))
    first.tap()
    XCTAssertTrue(app.textViews.firstMatch.waitForExistence(timeout: 5))
    // Leave the persisted view on Projects so other tests start from the default.
    menu.tap()
    XCTAssertTrue(toggle.waitForExistence(timeout: 5))
    toggle.buttons["Projects"].tap()
    if #available(iOS 17.0, *) { XCUIDevice.shared.appearance = .light }
  }

  @MainActor
  func testSharedCompanionAcrossRotationAndSidebarSelection() throws {
    let app = XCUIApplication(bundleIdentifier: "com.freddai.companion")
    XCUIDevice.shared.orientation = .landscapeLeft
    app.launch()
    let menu = app.buttons["Threads"]
    XCTAssertTrue(menu.waitForExistence(timeout: 15))
    let list = app.collectionViews["thread-drawer-list"]
    let isPad = UIDevice.current.userInterfaceIdiom == .pad
    if !isPad { menu.tap() }
    XCTAssertTrue(list.waitForExistence(timeout: 5))
    let row = list.cells.matching(NSPredicate(format: "label BEGINSWITH %@", "Native drawer for thread list")).firstMatch
    XCTAssertTrue(row.waitForExistence(timeout: 5))
    row.tap()
    let composer = app.textViews.firstMatch
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    if isPad {
      XCTAssertTrue(list.isHittable)
      XCTAssertLessThanOrEqual(list.frame.maxX, composer.frame.minX)
      let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      shot.name = "iPad landscape shared companion"
      shot.lifetime = .keepAlways
      add(shot)
    } else {
      XCTAssertFalse(list.exists && list.isHittable)
    }
    composer.tap()
    composer.typeText("Draft survives rotation")
    XCUIDevice.shared.orientation = .portrait
    XCTAssertTrue(composer.waitForExistence(timeout: 5))
    XCTAssertEqual(composer.value as? String, "Draft survives rotation")
    XCTAssertFalse(list.exists && list.isHittable)
    let portrait = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
    portrait.name = isPad ? "iPad portrait shared composer" : "iPhone shared composer"
    portrait.lifetime = .keepAlways
    add(portrait)
    XCUIDevice.shared.orientation = .landscapeLeft
    if isPad {
      XCTAssertTrue(list.waitForExistence(timeout: 5))
      XCTAssertTrue(list.isHittable)
      XCTAssertEqual(composer.value as? String, "Draft survives rotation")
      menu.tap()
      XCTAssertFalse(list.exists && list.isHittable)
      menu.tap()
      XCTAssertTrue(list.isHittable)
      // Exercise the shared native picker popover on iPad; dismiss without making changes.
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Model:")).firstMatch.tap()
      XCTAssertTrue(app.buttons["Agent default"].waitForExistence(timeout: 5))
      let picker = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
      picker.name = "iPad native model popover"
      picker.lifetime = .keepAlways
      add(picker)
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.15)).tap()
      XCTAssertFalse(app.buttons["Agent default"].exists)
      app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Model:")).firstMatch.tap()
      XCTAssertTrue(app.buttons["Agent default"].waitForExistence(timeout: 5))
      app.buttons["Agent default"].tap()
      // The shared model flow follows selection with the effort picker.
      XCTAssertTrue(app.buttons["Agent default"].waitForExistence(timeout: 5))
      app.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.15)).tap()
      XCTAssertFalse(app.buttons["Agent default"].exists)
      XCTAssertEqual(composer.value as? String, "Draft survives rotation")
      XCTAssertTrue(list.isHittable)
    }
  }
}
