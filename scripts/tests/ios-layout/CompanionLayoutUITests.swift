import XCTest
import UIKit

/// Runs against the separately installed offline fixture app. Never use this against a paired device.
final class CompanionLayoutUITests: XCTestCase {
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
    let row = list.cells.matching(NSPredicate(format: "label == %@", "Native drawer for thread list")).firstMatch
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
