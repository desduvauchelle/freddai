import XCTest
import UIKit

final class CompanionLayoutTests: XCTestCase {
  func testSidebarUsesWindowSizeAndDeviceRatherThanScreenSize() {
    for size in [CGSize(width: 1133, height: 744), CGSize(width: 1194, height: 834), CGSize(width: 1366, height: 1024)] {
      XCTAssertTrue(CompanionLayout.showsSidebar(size: size, isPad: true, regularWidth: true))
      XCTAssertFalse(CompanionLayout.showsSidebar(size: size, isPad: false, regularWidth: true))
      XCTAssertFalse(CompanionLayout.showsSidebar(size: size, isPad: true, regularWidth: false))
    }
    for size in [CGSize(width: 834, height: 1194), CGSize(width: 744, height: 1133), CGSize(width: 600, height: 500), CGSize(width: 899, height: 600)] {
      XCTAssertFalse(CompanionLayout.showsSidebar(size: size, isPad: true, regularWidth: true))
    }
  }

  @MainActor
  private func shell(size: CGSize, idiom: UIUserInterfaceIdiom = .pad) -> (UIViewController, DrawerContainerViewController) {
    let parent = UIViewController()
    parent.loadViewIfNeeded()
    let container = DrawerContainerViewController(content: UIViewController(), drawer: UIViewController())
    parent.addChild(container)
    parent.setOverrideTraitCollection(UITraitCollection(traitsFrom: [
      UITraitCollection(userInterfaceIdiom: idiom), UITraitCollection(horizontalSizeClass: .regular),
    ]), forChild: container)
    parent.view.addSubview(container.view)
    container.didMove(toParent: parent)
    container.view.frame = CGRect(origin: .zero, size: size)
    container.drawerEnabled = true
    container.view.setNeedsLayout()
    container.view.layoutIfNeeded()
    return (parent, container)
  }

  @MainActor
  func testLandscapeHasTwoInteractivePanesAndSelectionKeepsListOpen() {
    let (parent, container) = shell(size: CGSize(width: 1194, height: 834))
    defer { _ = parent }
    XCTAssertTrue(container.usesSidebar)
    XCTAssertTrue(container.isOpen)
    XCTAssertEqual(container.drawer.view.bounds.width, 320)
    XCTAssertEqual(container.content.view.frame, CGRect(x: 320, y: 0, width: 874, height: 834))
    XCTAssertFalse(container.content.view.accessibilityElementsHidden)
    XCTAssertFalse(container.edgePanRecognizer.isEnabled)
    container.dismissAfterSelection()
    XCTAssertTrue(container.isOpen)
    // Snapshot refreshes call setMode repeatedly; these must not reopen a manually hidden sidebar.
    container.toggleThreadList()
    container.drawerEnabled = true
    container.view.setNeedsLayout()
    container.view.layoutIfNeeded()
    XCTAssertFalse(container.isOpen)
    XCTAssertEqual(container.content.view.frame.minX, 0)
    XCTAssertEqual(container.content.view.bounds.width, 1194)
    container.toggleThreadList()
    XCTAssertTrue(container.isOpen)
  }

  @MainActor
  func testRotationAndWindowResizeReuseControllersAndCloseOverlay() {
    let (parent, container) = shell(size: CGSize(width: 1194, height: 834))
    defer { _ = parent }
    let content = container.content, drawer = container.drawer
    for size in [CGSize(width: 834, height: 1194), CGSize(width: 600, height: 500)] {
      container.view.frame.size = size
      container.view.setNeedsLayout()
      container.view.layoutIfNeeded()
      XCTAssertFalse(container.usesSidebar)
      XCTAssertFalse(container.isOpen)
      XCTAssertEqual(container.content.view.frame, CGRect(origin: .zero, size: size))
      XCTAssertTrue(container.edgePanRecognizer.isEnabled)
      XCTAssertTrue(container.content === content)
      XCTAssertTrue(container.drawer === drawer)
    }
    container.view.frame.size = CGSize(width: 1194, height: 834)
    container.view.setNeedsLayout()
    container.view.layoutIfNeeded()
    XCTAssertTrue(container.isOpen)
    container.drawerEnabled = false // Pairing/settings must occupy the whole window.
    XCTAssertFalse(container.usesSidebar)
    XCTAssertFalse(container.isOpen)
    XCTAssertEqual(container.content.view.bounds.width, 1194)
    container.setOpen(true, animated: false)
    XCTAssertFalse(container.isOpen)
  }

  @MainActor
  func testPhoneKeepsRevealDrawerAndModalAccessibility() {
    let (parent, container) = shell(size: CGSize(width: 430, height: 932), idiom: .phone)
    defer { _ = parent }
    XCTAssertFalse(container.usesSidebar)
    XCTAssertFalse(container.isOpen)
    container.setOpen(true, animated: false)
    XCTAssertEqual(container.content.view.transform.tx, 387)
    XCTAssertEqual(container.content.view.bounds.width, 430)
    XCTAssertTrue(container.content.view.accessibilityElementsHidden)
    container.setOpen(false, animated: false)
    XCTAssertFalse(container.content.view.accessibilityElementsHidden)
  }
}
