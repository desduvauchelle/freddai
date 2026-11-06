import XCTest
import UIKit

final class CompanionLayoutTests: XCTestCase {
  @MainActor
  func testDashboardCompactControlsShareTitleRows() throws {
    let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: 393, height: 700))
    let data = Data(##"{"connected":true,"busy":false,"agent":"Project defaults","projects":[{"id":"sample","name":"Sample","color":"#123456","assistant":"","activity":"No activity","model":"Model default","canStart":false}]}"##.utf8)
    dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: data))
    dashboard.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let views = descendants(dashboard)
    let create = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-new-sample" } as? UIButton)
    let mic = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-mic-sample" } as? UIButton)
    XCTAssertTrue(dashboard.touchesShouldCancel(in: create))
    XCTAssertNil(create.configuration?.title)
    XCTAssertNil(mic.configuration?.title)
    XCTAssertLessThanOrEqual(create.bounds.width, 48)
    XCTAssertEqual(create.convert(create.bounds, to: dashboard).midY, mic.convert(mic.bounds, to: dashboard).midY, accuracy: 1)
    let agent = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-agent" })
    let heading = try XCTUnwrap(views.first { ($0 as? UILabel)?.text == "Your projects" })
    XCTAssertEqual(agent.convert(agent.bounds, to: dashboard).midY, heading.convert(heading.bounds, to: dashboard).midY, accuracy: 1)
  }

  @MainActor
  func testDashboardProjectsPrecedeSummariesAndRefreshIsCompact() throws {
    let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: 393, height: 900))
    let data = Data(##"{"connected":true,"busy":false,"agent":"Project defaults","projects":[{"id":"sample","name":"Sample","color":"#123456","assistant":"","activity":"No activity","model":"Model default","canStart":false}],"summaries":[{"date":"2026-11-05","label":"Today","text":"Cached summary","action":"Refresh","busy":false}]}"##.utf8)
    dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: data))
    dashboard.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let views = descendants(dashboard)
    let project = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-new-sample" })
    let summary = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-summary-2026-11-05" })
    let refresh = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-summary-action-2026-11-05" } as? UIButton)
    XCTAssertLessThan(dashboard.workspace.convert(dashboard.workspace.bounds, to: dashboard).maxY, project.convert(project.bounds, to: dashboard).minY)
    XCTAssertLessThan(project.convert(project.bounds, to: dashboard).maxY, summary.convert(summary.bounds, to: dashboard).minY)
    XCTAssertNil(refresh.configuration?.title)
    XCTAssertEqual(refresh.bounds.width, 44, accuracy: 1)
    XCTAssertEqual(refresh.accessibilityLabel, "Refresh Today summary")
  }

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
