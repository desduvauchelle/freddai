import XCTest
import UIKit

final class CompanionLayoutTests: XCTestCase {
  func testVoiceRecordingAllowsTenMinutesOfSpeech() {
    XCTAssertEqual(VoiceRecorder.maxSeconds, 600)
  }

  @MainActor
  func testCommanderDrawerAvatarIsCircularAndFolderReuseResetsClipping() throws {
    let cell = ProjectHeaderCell(frame: CGRect(x: 0, y: 0, width: 300, height: 44))
    cell.configure(group: ThreadGroupModel(project: "commander", label: "Commander", threads: [], kind: "commander"), collapsed: false, onAdd: {})
    cell.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let icon = try XCTUnwrap(descendants(cell).first { $0.accessibilityIdentifier == "drawer-commander-icon" } as? UIImageView)
    XCTAssertGreaterThan(icon.bounds.width, 0)
    XCTAssertEqual(icon.bounds.width, icon.bounds.height, accuracy: 0.5)
    XCTAssertTrue(icon.clipsToBounds)
    XCTAssertEqual(icon.layer.cornerRadius, icon.bounds.width / 2, accuracy: 0.5)
    cell.configure(group: ThreadGroupModel(project: "ordinary", label: "Project", threads: []), collapsed: false, onAdd: {})
    cell.layoutIfNeeded()
    XCTAssertFalse(icon.clipsToBounds)
    XCTAssertEqual(icon.layer.cornerRadius, 0)
  }

  @MainActor
  func testRecordingFeedbackFitsPhoneAndTabletControlRow() throws {
    let animationsEnabled = UIView.areAnimationsEnabled
    UIView.setAnimationsEnabled(false)
    defer { UIView.setAnimationsEnabled(animationsEnabled) }
    for dark in [false, true] {
    for width: CGFloat in [320, 393, 744] {
      let composer = ComposerView()
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 200))
      let root = UIViewController()
      window.rootViewController = root
      window.overrideUserInterfaceStyle = dark ? .dark : .light
      root.view.addSubview(composer)
      window.isHidden = false
      defer { window.isHidden = true }
      composer.setVoice(enabled: true, state: "idle")
      composer.frame = CGRect(x: 0, y: 0, width: width, height: 150)
      func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
      let label = try XCTUnwrap(descendants(composer).first { $0 is RecordingStatusLabel } as? RecordingStatusLabel)
      label.isHidden = false
      label.showWaveform = true
      for index in 0..<32 { label.level = 0.12 + abs(sin(CGFloat(index) * 0.7)) * 0.7 }
      label.elapsed = 12
      label.text = "0:12"
      composer.presentRecording(true, armed: false)
      composer.layoutIfNeeded()
      XCTAssertGreaterThanOrEqual(label.bounds.width, label.intrinsicContentSize.width - 1)
      XCTAssertGreaterThanOrEqual(label.bounds.height, label.intrinsicContentSize.height - 1)
      let cue = try XCTUnwrap(descendants(composer).first { $0.accessibilityIdentifier == "recording-send-cue" })
      XCTAssertEqual(cue.alpha, 1)
      XCTAssertTrue(cue.isUserInteractionEnabled)
      let cancel = try XCTUnwrap(descendants(composer).first { $0.accessibilityIdentifier == "recording-cancel" })
      XCTAssertFalse(cancel.isHidden)
      XCTAssertEqual(cancel.bounds.width, 44)
      XCTAssertTrue(composer.hitTest(cue.convert(CGPoint(x: 22, y: 22), to: composer), with: nil) === cue)
      let mic = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Dictate" })
      XCTAssertEqual(cue.convert(cue.bounds, to: composer).midX, mic.convert(mic.bounds, to: composer).midX, accuracy: 1)
      XCTAssertEqual(mic.convert(mic.bounds, to: composer).midY - cue.convert(cue.bounds, to: composer).midY, 64, accuracy: 1)
      let renderer = UIGraphicsImageRenderer(bounds: composer.bounds)
      var image: UIImage!
      composer.traitCollection.performAsCurrent {
        image = renderer.image { context in composer.layer.render(in: context.cgContext) }
      }
      let attachment = XCTAttachment(image: image)
      attachment.name = "Recording pill \(Int(width))pt \(dark ? "dark" : "light")"
      attachment.lifetime = .keepAlways
      add(attachment)
      composer.presentRecording(true, armed: false, progress: 0.5)
      XCTAssertEqual(cue.transform.a, 1.09, accuracy: 0.001)
      if !Motion.reduced { XCTAssertEqual(cue.transform.ty, -4, accuracy: 0.001) }
      composer.presentRecording(true, armed: true)
      XCTAssertEqual(cue.transform.a, 1.18, accuracy: 0.001)
      if !Motion.reduced { XCTAssertEqual(cue.transform.ty, -8, accuracy: 0.001) }
      let actual = try XCTUnwrap(cue.backgroundColor?.cgColor.components)
      let expected = try XCTUnwrap(composer.tintColor.resolvedColor(with: composer.traitCollection).cgColor.components)
      XCTAssertEqual(actual.count, expected.count)
      for (a, e) in zip(actual, expected) { XCTAssertEqual(a, e, accuracy: 0.0001) }
      if width == 393 {
        composer.traitCollection.performAsCurrent {
          image = renderer.image { context in composer.layer.render(in: context.cgContext) }
        }
        let active = XCTAttachment(image: image)
        active.name = "Recording active target \(dark ? "dark" : "light")"
        active.lifetime = .keepAlways
        add(active)
      }
      composer.presentRecording(false, armed: false)
      XCTAssertEqual(cue.alpha, 0)
    }
    }
  }

  func testTapLatchesAndHoldReleaseSends() {
    XCTAssertFalse(RecordingSwipe.sendsOnRelease(duration: 0.1, armed: false))
    XCTAssertFalse(RecordingSwipe.sendsOnRelease(duration: 0.299, armed: false))
    XCTAssertTrue(RecordingSwipe.sendsOnRelease(duration: 0.3, armed: false))
    XCTAssertTrue(RecordingSwipe.sendsOnRelease(duration: 2, armed: false))
    XCTAssertTrue(RecordingSwipe.sendsOnRelease(duration: 0.1, armed: true))
  }

  func testRecordingUpwardSwipeFeedback() {
    let origin = CGPoint(x: 160, y: 400)
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: origin))
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 160, y: 337)))
    XCTAssertTrue(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 160, y: 336)))
    XCTAssertTrue(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 200, y: 280)))
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 257, y: 280)))
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 160, y: 450)))
    // Returning below the threshold cancels even after previously reaching send.
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 160, y: 390)))
  }

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
