import XCTest
import UIKit

final class CompanionLayoutTests: XCTestCase {
  @MainActor
  func testComposerAgentAndDifficultyRemainVisibleAtPhoneAndTabletWidths() throws {
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    for width: CGFloat in [320, 393, 744, 1024] {
      let composer = ComposerView()
      composer.frame = CGRect(x: 0, y: 0, width: width, height: 180)
      composer.setSettings(agent: "Codex · Work", model: "Smart", access: "Ask", disabled: false)
      composer.setText("Keep my draft")
      composer.layoutIfNeeded()
      let agent = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Agent: Codex · Work" } as? UIButton)
      let level = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Difficulty: Smart" } as? UIButton)
      XCTAssertFalse(agent.isHidden); XCTAssertFalse(level.isHidden)
      XCTAssertEqual(level.configuration?.title, "Smart")
      let agentFrame = agent.convert(agent.bounds, to: composer)
      let levelFrame = level.convert(level.bounds, to: composer)
      XCTAssertLessThanOrEqual(agentFrame.maxX, levelFrame.minX)
      XCTAssertLessThanOrEqual(levelFrame.maxX, width)
      composer.setSettings(agent: "Claude · Work", model: "Custom", access: "Ask", disabled: false)
      XCTAssertEqual(level.configuration?.title, "Custom")
      XCTAssertTrue(descendants(composer).contains { ($0 as? UITextView)?.text == "Keep my draft" })
    }
  }

  @MainActor
  func testRecordingCuesStayOnTheirAxesAndReturnHome() {
    for width: CGFloat in [390, 744, 1024, 1366] {
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 1000))
      let bar = DashboardRecordingBar(frame: CGRect(x: 0, y: 400, width: width, height: 160))
      window.addSubview(bar); bar.layoutIfNeeded()
      UIView.setAnimationsEnabled(false)
      defer { UIView.setAnimationsEnabled(true) }
      bar.update(active: true, destination: "Project")
      let finger = CGPoint(x: width - 80, y: 490)
      bar.update(active: true, destination: "Project", sendProgress: 0.5, fingerInWindow: finger)
      XCTAssertEqual(bar.sendCue.transform.tx, 0, accuracy: 0.01, "Send must stay on its vertical rail")
      bar.update(active: true, destination: "Project", cancelProgress: 0.5, fingerInWindow: finger)
      XCTAssertEqual(bar.cancelButton.transform.ty, 0, accuracy: 0.01, "Cancel must stay on its horizontal rail")
      XCTAssertEqual(bar.sendCue.transform.tx, 0, accuracy: 0.01)
      XCTAssertEqual(bar.sendCue.transform.ty, 0, accuracy: 0.01)
      bar.update(active: true, destination: "Project")
      XCTAssertEqual(bar.cancelButton.transform, .identity)
      XCTAssertEqual(bar.sendCue.transform, .identity)
    }
  }

  @MainActor
  func testDrawerNavigationHierarchyAtPhoneWidths() throws {
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    for width: CGFloat in [280, 353, 430, 768, 1024] {
      let drawer = ThreadDrawerViewController()
      drawer.loadViewIfNeeded()
      drawer.view.frame = CGRect(x: 0, y: 0, width: width, height: 800)
      drawer.view.layoutIfNeeded()
      let views = descendants(drawer.view)
      let dashboard = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "companion-dashboard" } as? UIButton)
      let settings = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "companion-settings" } as? UIButton)
      let addProject = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "companion-add-project" } as? UIButton)
      let commander = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "drawer-commander" } as? UIButton)
      let search = try XCTUnwrap(views.compactMap { $0 as? UISearchTextField }.first)
      XCTAssertTrue(views.compactMap { $0 as? UISegmentedControl }.isEmpty)
      let filter = try XCTUnwrap(views.compactMap { $0 as? UIButton }.first { $0.accessibilityLabel == "Filter threads" })
      let title = try XCTUnwrap(views.compactMap { $0 as? UILabel }.first { $0.text == "Freddai" })
      func rect(_ view: UIView) -> CGRect { view.convert(view.bounds, to: drawer.view) }
      // Title row: add project then settings, trailing, same size, centred on the title.
      XCTAssertEqual(addProject.accessibilityLabel, "Add project")
      XCTAssertEqual(settings.accessibilityLabel, "Settings")
      for button in [addProject, settings] {
        XCTAssertEqual(rect(button).midY, rect(title).midY, accuracy: 1)
        XCTAssertEqual(rect(button).width, 44, accuracy: 0.5)
        XCTAssertGreaterThanOrEqual(rect(button).height, 44)
        XCTAssertLessThanOrEqual(rect(button).maxX, width)
      }
      XCTAssertEqual(rect(addProject).height, rect(settings).height, accuracy: 0.5)
      XCTAssertLessThan(rect(addProject).maxX, rect(settings).minX + 0.5)
      XCTAssertGreaterThan(rect(addProject).minX, rect(title).maxX)
      // Navigation row: Dashboard alone at full width while the model has no commander group.
      XCTAssertTrue(commander.isHidden)
      XCTAssertGreaterThanOrEqual(rect(dashboard).minY, rect(settings).maxY)
      XCTAssertGreaterThanOrEqual(rect(search).minY, rect(dashboard).maxY)
      XCTAssertEqual(rect(dashboard).minX, rect(search).minX, accuracy: 0.5)
      XCTAssertEqual(rect(dashboard).maxX, rect(filter).maxX, accuracy: 0.5)
      XCTAssertEqual(rect(filter).midY, rect(search).midY, accuracy: 1)
      XCTAssertNil(views.first { ($0.accessibilityIdentifier ?? "").hasPrefix("drawer-filter-chip-") }.flatMap { $0.isHidden ? nil : $0 })
      var opened = false
      drawer.onDashboard = { opened = true }
      dashboard.sendActions(for: .touchUpInside)
      XCTAssertTrue(opened)
      var settingsOpened = false
      drawer.onSettings = { settingsOpened = true }
      settings.sendActions(for: .touchUpInside)
      XCTAssertTrue(settingsOpened)

      // With a Commander group: two equal tiles, 8pt apart; Commander is not repeated in the list.
      let json = """
      {"groups":[{"project":"commander","label":"Commander","color":"","canStart":true,"threads":[],"olderRemaining":0,"olderLabel":"","olderExpanded":false,"kind":"commander"},
        {"project":"freddai","label":"Freddai","color":"#777777","canStart":true,"threads":[],"olderRemaining":0,"olderLabel":"","olderExpanded":false}],
       "canReorderProjects":false,"selectedId":"","view":"projects",
       "recent":{"threads":[],"remaining":0,"expanded":false},"recentSection":{"threads":[],"remaining":0,"expanded":false},
       "filters":{"workspace":"","project":"freddai","status":"working","query":""},
       "commander":{"id":"commander","name":"Chief"},
       "projectOptions":[{"id":"","label":"All projects"},{"id":"freddai","label":"Freddai App"}],
       "statusOptions":[{"id":"all","label":"All"},{"id":"working","label":"Working"}]}
      """
      let model = try JSONDecoder().decode(ThreadsModel.self, from: Data(json.utf8))
      let baseline = rect(search).minY
      drawer.apply(model)
      drawer.view.layoutIfNeeded()
      // Decoded from the filter-independent `commander` field, even with the group filtered out of `groups`.
      XCTAssertEqual(model.commander?.name, "Chief")
      XCTAssertFalse(commander.isHidden)
      XCTAssertEqual(commander.accessibilityLabel, "Chief")
      XCTAssertEqual((commander as? NavTileButton)?.titleText.text, "Commander")
      // Titles never truncate: at worst they shrink to the 0.85 minimum scale.
      for tile in [dashboard, commander].compactMap({ $0 as? NavTileButton }) {
        let label = tile.titleText
        XCTAssertGreaterThanOrEqual(label.bounds.width + 0.5, ceil(label.intrinsicContentSize.width * 0.85), "\(label.text ?? "") truncates at width \(width)")
      }
      XCTAssertEqual(rect(dashboard).width, rect(commander).width, accuracy: 0.5)
      XCTAssertEqual(rect(commander).minX - rect(dashboard).maxX, 8, accuracy: 0.5)
      XCTAssertEqual(rect(dashboard).midY, rect(commander).midY, accuracy: 0.5)
      XCTAssertGreaterThanOrEqual(rect(commander).height, 44)
      XCTAssertEqual(rect(dashboard).minX, rect(search).minX, accuracy: 0.5)
      var selected: String?
      drawer.onSelectThread = { selected = $0 }
      commander.sendActions(for: .touchUpInside)
      XCTAssertEqual(selected, "commander:open")
      // Chips: project then status, below the search row, header grows; the filter button is active.
      let chips = descendants(drawer.view).compactMap { $0 as? FilterChipView }
      XCTAssertEqual(chips.map(\.accessibilityIdentifier), ["drawer-filter-chip-project", "drawer-filter-chip-status"])
      XCTAssertEqual(chips.first?.accessibilityLabel, "Remove project filter Freddai App")
      XCTAssertGreaterThanOrEqual(rect(chips[0]).minY, rect(search).maxY)
      XCTAssertGreaterThanOrEqual(rect(chips[0]).height, 32)
      XCTAssertEqual(filter.accessibilityValue, "Projects, filters on")
      var cleared: [String] = []
      drawer.onSetFilter = { project, status, workspace in cleared = [project, status, workspace ?? "nil"] }
      chips[0].sendActions(for: .touchUpInside)
      XCTAssertEqual(cleared, ["", "working", "nil"])
      chips[1].sendActions(for: .touchUpInside)
      XCTAssertEqual(cleared, ["freddai", "all", "nil"])
      // Filter active and the commander group absent from `groups`: tile stays visible via `commander`.
      var filteredOut = model
      filteredOut.groups = model.groups.filter { $0.kind != "commander" }
      drawer.apply(filteredOut)
      drawer.view.layoutIfNeeded()
      XCTAssertFalse(commander.isHidden)
      // Clearing every filter collapses the chip row and restores the header height.
      var clean = model
      clean.filters = ThreadFiltersModel()
      drawer.apply(clean)
      drawer.view.layoutIfNeeded()
      XCTAssertTrue(descendants(drawer.view).compactMap { $0 as? FilterChipView }.allSatisfy { $0.isHidden || $0.superview?.superview?.isHidden == true })
      XCTAssertEqual(rect(search).minY, baseline, accuracy: 1)
      XCTAssertEqual(filter.accessibilityValue, "Projects")
    }
  }

  @MainActor
  func testThreadSelectionFillsRowAtPhoneAndTabletWidths() throws {
    for width: CGFloat in [280, 353, 430, 600] {
      let cell = ThreadCell(frame: CGRect(x: 0, y: 0, width: width, height: 48))
      let row = try JSONDecoder().decode(ThreadRowModel.self, from: Data(#"{"id":"t","title":"Short","status":"done","unread":false,"updatedAt":1}"#.utf8))
      cell.configure(row)
      var state = cell.configurationState
      state.isSelected = true
      cell.updateConfiguration(using: state)
      let background = try XCTUnwrap(cell.backgroundConfiguration)
      XCTAssertNotNil(background.backgroundColor)
      XCTAssertEqual(background.backgroundInsets, .zero)
      XCTAssertEqual(background.cornerRadius, 0)
      state.isSelected = false
      state.isHighlighted = true
      cell.updateConfiguration(using: state)
      XCTAssertEqual(cell.backgroundConfiguration?.backgroundInsets, .zero)
    }
  }

  @MainActor
  func testScheduledThreadIconTrailsTitleAndClearsOnReuse() throws {
    let cell = ThreadCell(frame: CGRect(x: 0, y: 0, width: 280, height: 56))
    var row = try JSONDecoder().decode(ThreadRowModel.self, from: Data(#"{"id":"t","title":"A long scheduled thread title that must truncate","status":"done","unread":false,"updatedAt":1,"scheduled":true}"#.utf8))
    cell.configure(row)
    cell.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let icon = try XCTUnwrap(descendants(cell.contentView).compactMap { $0 as? UIImageView }.first)
    let title = try XCTUnwrap(descendants(cell.contentView).compactMap { $0 as? UILabel }.first { $0.text == row.title })
    XCTAssertFalse(icon.isHidden)
    XCTAssertGreaterThanOrEqual(icon.frame.minX, title.convert(title.bounds, to: cell.contentView).maxX)
    XCTAssertTrue(cell.accessibilityValue?.contains("Scheduled task") == true)
    row.scheduled = false
    cell.configure(row)
    cell.layoutIfNeeded()
    XCTAssertTrue(icon.isHidden)
    XCTAssertFalse(cell.accessibilityValue?.contains("Scheduled task") == true)
  }

  // Presentation-only quota samples: no connected accounts or provider calls.
  @MainActor
  func testUsageFooterIsReadableAndBoundedAtPhoneWidths() throws {
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let cards = [
      ProductUsageModel(id: "low", name: "Work", product: "Codex", remaining: 13, capacity: "13% left", reset: "Resets in 2d", stale: false, details: "Quota window details"),
      ProductUsageModel(id: "high", name: "Personal", product: "Codex", remaining: 88, capacity: "88% left", reset: "Resets in 5d", stale: false, details: "Quota window details"),
      ProductUsageModel(id: "stale", name: "Research", product: "Claude", remaining: 23, capacity: "23% left", reset: "Last known reading", stale: true, details: "Last known quota window details"),
      ProductUsageModel(id: "unknown", name: "Other", product: "Claude", remaining: nil, capacity: "Unavailable", reset: "Check on your Mac", stale: false, details: "Unavailable quota window details"),
    ]
    for width: CGFloat in [280, 353, 390] {
      for style in [UIUserInterfaceStyle.dark, .light] {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: width, height: 220))
        let root = UIViewController()
        window.rootViewController = root
        window.overrideUserInterfaceStyle = style
        let footer = ProductUsageFooterView()
        footer.overrideUserInterfaceStyle = style
        root.view.addSubview(footer)
        window.isHidden = false
        defer { window.isHidden = true }
        footer.traitCollection.performAsCurrent { footer.update(cards) }
        let size = footer.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
        footer.frame = CGRect(origin: .zero, size: size)
        footer.layoutIfNeeded()
        XCTAssertEqual(size.height, 104, accuracy: 1)
        let labels = descendants(footer).compactMap { $0 as? UILabel }
        XCTAssertTrue(labels.contains { $0.text == "13% left" && $0.font.pointSize >= 12 })
        XCTAssertTrue(labels.contains { $0.attributedText?.string == "Claude · Other" })
        for label in labels where !(label.text ?? "").isEmpty {
          let frame = label.convert(label.bounds, to: footer)
          XCTAssertGreaterThanOrEqual(frame.minX, -1)
          XCTAssertLessThanOrEqual(frame.maxX, width + 1)
          XCTAssertGreaterThan(label.bounds.height, 10)
          if label.text != nil { XCTAssertLessThanOrEqual(label.intrinsicContentSize.width, label.bounds.width + 1, label.text ?? "") }
        }
        let bars = descendants(footer).compactMap { $0 as? UIProgressView }
        XCTAssertEqual(bars.count, 4)
        XCTAssertEqual(bars[0].progress, 0.13, accuracy: 0.001)
        XCTAssertEqual(bars[3].progress, 0)
        var opened = false
        footer.onDetails = { opened = true }
        let details = try XCTUnwrap(descendants(footer).compactMap { $0 as? UIButton }.first)
        details.sendActions(for: .touchUpInside)
        XCTAssertTrue(opened)
        let renderer = UIGraphicsImageRenderer(bounds: footer.bounds)
        var image: UIImage!
        footer.traitCollection.performAsCurrent {
          image = renderer.image { context in
            UIColor.systemBackground.setFill()
            context.fill(footer.bounds)
            footer.layer.render(in: context.cgContext)
          }
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = "Usage footer \(Int(width))pt \(style == .dark ? "dark" : "light")"
        attachment.lifetime = .keepAlways
        add(attachment)
        footer.update(cards + cards.map { card in ProductUsageModel(id: card.id + "-extra", name: card.name, product: card.product, remaining: card.remaining, capacity: card.capacity, reset: card.reset, stale: card.stale, details: card.details) })
        let expandedSize = footer.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel)
        XCTAssertEqual(expandedSize.height, size.height)
        footer.update([])
        XCTAssertTrue(footer.isHidden)
        XCTAssertEqual(footer.systemLayoutSizeFitting(CGSize(width: width, height: 0), withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height, 0)
      }
    }
  }

  @MainActor
  func testComposerPrimaryActionSwitchesWithText() throws {
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let composer = ComposerView()
    composer.frame = CGRect(x: 0, y: 0, width: 393, height: 150)
    composer.setVoice(enabled: true, state: "idle")
    composer.layoutIfNeeded()
    let mic = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Dictate" })
    let send = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Send" } as? UIButton)
    XCTAssertFalse(mic.isHidden)
    XCTAssertTrue(send.isHidden)
    XCTAssertEqual(mic.bounds.width, 34, accuracy: 1)
    XCTAssertEqual(mic.convert(mic.bounds, to: composer).midX, send.convert(send.bounds, to: composer).midX, accuracy: 1)
    composer.setText("Hello")
    XCTAssertTrue(mic.isHidden)
    XCTAssertFalse(send.isHidden)
    XCTAssertTrue(send.isEnabled)
    composer.setText(" \n")
    XCTAssertFalse(mic.isHidden)
    XCTAssertTrue(send.isHidden)
    composer.appendText("Dictated draft")
    XCTAssertTrue(mic.isHidden)
    XCTAssertFalse(send.isHidden)
    composer.setText("")
    composer.setVoice(enabled: false, state: "idle")
    XCTAssertTrue(mic.isHidden)
    XCTAssertFalse(send.isHidden)
    XCTAssertFalse(send.isEnabled)
  }

  @MainActor
  func testTranscriptionBadgeLiftsAndNewTranscriptionInterruptsItsExit() async throws {
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 250))
    let root = UIViewController()
    window.rootViewController = root
    let composer = ComposerView()
    root.view.addSubview(composer)
    composer.frame = CGRect(x: 0, y: 0, width: 393, height: 150)
    window.isHidden = false
    defer { window.isHidden = true }
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    composer.setVoice(enabled: true, state: "transcribing")
    composer.layoutIfNeeded()
    let badge = try XCTUnwrap(descendants(composer).first { $0.accessibilityIdentifier == "transcription-badge" })
    composer.setVoice(enabled: true, state: "idle")
    XCTAssertEqual(badge.alpha, 0)
    XCTAssertEqual(badge.transform.ty, Motion.reduced ? 0 : -22, accuracy: 0.01)
    composer.setVoice(enabled: true, state: "transcribing")
    try await Task.sleep(nanoseconds: 400_000_000)
    XCTAssertFalse(badge.isHidden)
    XCTAssertEqual(badge.alpha, 1)
    XCTAssertTrue(badge.transform.isIdentity)
  }

  @MainActor
  func testTranscriptionKeepsAColoredCapsuleAndResetsForNextJob() throws {
    let animations = UIView.areAnimationsEnabled
    UIView.setAnimationsEnabled(false)
    defer { UIView.setAnimationsEnabled(animations) }
    for width: CGFloat in [320, 393, 744] {
      let composer = ComposerView()
      composer.frame = CGRect(x: 0, y: 0, width: width, height: 150)
      composer.setVoice(enabled: true, state: "transcribing")
      composer.layoutIfNeeded()
      func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
      let badge = try XCTUnwrap(descendants(composer).first { $0.accessibilityIdentifier == "transcription-badge" })
      let mic = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Dictate" })
      let spinner = try XCTUnwrap(descendants(badge).first { $0 is UIActivityIndicatorView } as? UIActivityIndicatorView)
      XCTAssertFalse(badge.isHidden)
      XCTAssertTrue(spinner.isAnimating)
      XCTAssertEqual(badge.layer.cornerRadius, badge.bounds.height / 2, accuracy: 1)
      XCTAssertGreaterThan(badge.backgroundColor?.cgColor.alpha ?? 0, 0)
      let recordingPill = try XCTUnwrap(descendants(composer).first { $0 is RecordingStatusLabel })
      XCTAssertEqual(badge.frame, recordingPill.frame)
      XCTAssertEqual(badge.bounds.height, 44)
      let caption = try XCTUnwrap(descendants(badge).first { $0 is UILabel } as? UILabel)
      XCTAssertEqual(caption.text, "Transcribing…")
      XCTAssertEqual(caption.textColor, RecordingStatusLabel.recordingGreen)
      XCTAssertEqual(spinner.color, RecordingStatusLabel.recordingGreen)
      XCTAssertTrue(mic.isUserInteractionEnabled)
      if width == 393 {
        for style in [UIUserInterfaceStyle.light, .dark] {
          composer.overrideUserInterfaceStyle = style
          let renderer = UIGraphicsImageRenderer(bounds: composer.bounds)
          let attachment = XCTAttachment(image: renderer.image { context in composer.layer.render(in: context.cgContext) })
          attachment.name = style == .dark ? "Green transcription pill dark" : "Green transcription pill light"
          attachment.lifetime = .keepAlways
          add(attachment)
        }
      }
      XCTAssertGreaterThanOrEqual(badge.bounds.height, 32)
      composer.setVoice(enabled: true, state: "idle")
      XCTAssertTrue(badge.isHidden)
      XCTAssertFalse(spinner.isAnimating)
      composer.setVoice(enabled: true, state: "transcribing")
      XCTAssertFalse(badge.isHidden)
      XCTAssertEqual(badge.alpha, 1)
      XCTAssertTrue(badge.transform.isIdentity)
    }
  }

  @MainActor
  func testMicrophoneRemainsAvailableWhileTranscribing() throws {
    let composer = ComposerView()
    composer.setVoice(enabled: true, state: "transcribing")
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let mic = try XCTUnwrap(descendants(composer).first { $0.accessibilityLabel == "Dictate" } as? UIButton)
    XCTAssertTrue(mic.isEnabled)
    XCTAssertFalse(mic.isHidden)
  }

  func testCommanderDashboardDecodesMissingAndNullCounts() throws {
    for counts in ["", #", "needsYou":1, "running":2"#, #", "needsYou":null, "running":null, "doneToday":null"#, #", "needsYou":3, "running":4, "doneToday":5"#] {
      let json = """
      {"connected":true,"busy":false,"agent":"","projects":[],"commander":{"id":"c","name":"Commander"\(counts)}}
      """
      let model = try JSONDecoder().decode(DashboardModel.self, from: Data(json.utf8))
      let commander = try XCTUnwrap(model.commander)
      XCTAssertEqual(commander.doneToday, counts.contains("5") ? 5 : 0)
      XCTAssertEqual(commander.needsYou, counts.contains("3") ? 3 : counts.contains("1") ? 1 : 0)
      XCTAssertEqual(commander.running, counts.contains("4") ? 4 : counts.contains("2") ? 2 : 0)
    }
  }

  func testVoiceRecordingAllowsTenMinutesOfSpeech() {
    XCTAssertEqual(VoiceRecorder.maxSeconds, 600)
  }

  @MainActor
  func testProjectHeaderControlsRemainVisibleAcrossWidthsAndReuse() throws {
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    for width: CGFloat in [240, 280, 353, 430, 744] {
      let cell = ProjectHeaderCell(frame: CGRect(x: 0, y: 0, width: width, height: 46))
      for name in [String(repeating: "Long project name ", count: 12), "tucky", "youtuber-video-recorder"] {
        cell.configure(group: ThreadGroupModel(project: "commander", label: "Commander", threads: [], kind: "commander"), collapsed: false, onAdd: {})
        cell.layoutIfNeeded()
        var added = false
        cell.configure(group: ThreadGroupModel(project: "p", label: name, threads: []), collapsed: false, onAdd: { added = true })
        let attributes = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: 0, section: 0))
        attributes.size = CGSize(width: width, height: 46)
        let fitted = cell.preferredLayoutAttributesFitting(attributes)
        XCTAssertEqual(fitted.size.width, width, accuracy: 0.5)
        cell.frame.size = fitted.size
        cell.layoutIfNeeded()
        let views = descendants(cell.contentView)
        let stack = try XCTUnwrap(views.compactMap { $0 as? UIStackView }.first)
        let chevron = try XCTUnwrap(stack.arrangedSubviews.first as? UIImageView)
        let add = try XCTUnwrap(views.compactMap { $0 as? UIButton }.first)
        let title = try XCTUnwrap(views.compactMap { $0 as? UILabel }.first)
        func rect(_ view: UIView) -> CGRect { view.convert(view.bounds, to: cell.contentView) }
        XCTAssertFalse(chevron.isHidden)
        XCTAssertGreaterThanOrEqual(rect(chevron).width, 10, "Chevron compressed for \(name) at \(width)")
        XCTAssertGreaterThanOrEqual(rect(chevron).minX, 0)
        XCTAssertFalse(add.isHidden)
        XCTAssertEqual(rect(add).width, 40, accuracy: 0.5)
        XCTAssertLessThanOrEqual(rect(add).maxX, cell.contentView.bounds.width)
        XCTAssertLessThanOrEqual(rect(title).maxX, rect(add).minX)
        add.sendActions(for: .touchUpInside)
        XCTAssertTrue(added)
      }
    }
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
  func testRecordingArrowStaysInsideTabletWindowDuringSwipe() {
    for size in [CGSize(width: 744, height: 1133), CGSize(width: 1133, height: 744)] {
      let window = UIWindow(frame: CGRect(origin: .zero, size: size))
      let root = UIViewController()
      window.rootViewController = root
      window.isHidden = false
      defer { window.isHidden = true }
      let bar = DashboardRecordingBar(frame: CGRect(x: 0, y: size.height - 120, width: size.width, height: 120))
      root.view.addSubview(bar)
      bar.update(active: true, destination: "Sample")
      bar.layoutIfNeeded()
      for finger in [CGPoint(x: size.width - 2, y: 2), CGPoint(x: -20, y: -20), CGPoint(x: size.width + 20, y: size.height + 20)] {
        bar.update(active: true, destination: "Sample", sendProgress: 1, fingerInWindow: finger)
        let rect = bar.sendCue.convert(bar.sendCue.bounds, to: window)
        XCTAssertTrue(window.bounds.inset(by: window.safeAreaInsets).contains(rect), "Arrow left visible window: \(rect)")
      }
      bar.update(active: false, destination: "Sample")
    }
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
      XCTAssertEqual(cue.transform.a, 1.5, accuracy: 0.001)
      if !Motion.reduced { XCTAssertEqual(cue.transform.ty, -4, accuracy: 0.001) }
      composer.presentRecording(true, armed: true)
      XCTAssertEqual(cue.transform.a, 2, accuracy: 0.001)
      if !Motion.reduced { XCTAssertEqual(cue.transform.ty, -8, accuracy: 0.001) }
      if !Motion.reduced {
        composer.presentRecording(true, armed: false, progress: 0)
        let rest = cue.superview!.convert(cue.center, to: nil)
        composer.presentRecording(true, armed: false, progress: 0, fingerInWindow: CGPoint(x: rest.x + 30, y: rest.y - 80))
        XCTAssertEqual(cue.superview!.convert(cue.center, to: nil).y, rest.y, accuracy: 0.5)
        let finger = CGPoint(x: rest.x + 30, y: rest.y - 80)
        composer.presentRecording(true, armed: true, progress: 1, fingerInWindow: finger)
        let armedCentre = cue.convert(CGPoint(x: cue.bounds.midX, y: cue.bounds.midY), to: nil)
        let safe = window.bounds.inset(by: window.safeAreaInsets)
        XCTAssertEqual(armedCentre.x, rest.x, accuracy: 0.5)
        let halfHeight = cue.bounds.height * cue.transform.d / 2
        XCTAssertEqual(armedCentre.y, max(safe.minY + halfHeight, min(safe.maxY - halfHeight, finger.y)), accuracy: 0.5)
        composer.presentRecording(true, armed: true)
      }
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
      composer.presentRecording(true, armed: false, cancelProgress: 1)
      XCTAssertEqual(cancel.transform.a, 1.5, accuracy: 0.001)
      let cancelComponents = try XCTUnwrap(cancel.tintColor.cgColor.components)
      let redComponents = try XCTUnwrap(UIColor.systemRed.resolvedColor(with: composer.traitCollection).cgColor.components)
      XCTAssertEqual(cancelComponents.count, redComponents.count)
      for (a, e) in zip(cancelComponents, redComponents) { XCTAssertEqual(a, e, accuracy: 0.0001) }
      composer.presentRecording(false, armed: false)
      XCTAssertEqual(cancel.transform.a, 1, accuracy: 0.001)
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
    XCTAssertTrue(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 257, y: 280)))
    XCTAssertTrue(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 300, y: -800)))
    XCTAssertTrue(RecordingSwipe.shouldCancel(origin: origin, end: CGPoint(x: -100, y: 350)))
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: -100, y: 350)))
    XCTAssertFalse(RecordingSwipe.shouldCancel(origin: origin, end: CGPoint(x: -100, y: -800)))
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 160, y: 450)))
    // Returning below the threshold cancels even after previously reaching send.
    XCTAssertFalse(RecordingSwipe.shouldSend(origin: origin, end: CGPoint(x: 160, y: 390)))
  }

  @MainActor
  func testDashboardRecordingControlsStayAbovePressedMic() {
    for size in [CGSize(width: 393, height: 852), CGSize(width: 768, height: 1024), CGSize(width: 1194, height: 834)] {
      let dashboard = DashboardView(frame: CGRect(origin: .zero, size: size))
      let mic = UIButton(frame: CGRect(x: size.width / 2, y: 300, width: 48, height: 48))
      dashboard.addSubview(mic)
      dashboard.presentRecordingBar(active: true, destination: "Sample", anchor: mic)
      let bar = dashboard.subviews.compactMap { $0 as? DashboardRecordingBar }.first!
      XCTAssertLessThanOrEqual(bar.frame.maxY, mic.frame.minY - 8)
      XCTAssertLessThan(abs(bar.frame.maxX - 38 - mic.frame.midX), 50)
      XCTAssertGreaterThanOrEqual(bar.frame.minX, dashboard.bounds.minX)
      XCTAssertLessThanOrEqual(bar.frame.maxX, dashboard.bounds.maxX)
    }
  }

  func testDashboardRecordingBarPinsToBottomAndMatchesComposerControls() throws {
    let animationsEnabled = UIView.areAnimationsEnabled
    UIView.setAnimationsEnabled(false)
    defer { UIView.setAnimationsEnabled(animationsEnabled) }
    var sent: [String] = []
    for dark in [false, true] {
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 393, height: 852))
      window.overrideUserInterfaceStyle = dark ? .dark : .light
      let root = UIViewController()
      let dashboard = DashboardView(frame: window.bounds)
      root.view.addSubview(dashboard)
      window.rootViewController = root
      window.isHidden = false
      defer { window.isHidden = true }
      dashboard.onAction = { sent.append($0.action) }
      let data = Data(##"{"connected":true,"busy":false,"agent":"Project defaults","projects":[{"id":"sample","name":"Sample","color":"#123456","assistant":"","activity":"","model":"","canStart":true}]}"##.utf8)
      dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: data))
      dashboard.layoutIfNeeded()
      func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
      let bar = try XCTUnwrap(descendants(dashboard).first { $0.accessibilityIdentifier == "dashboard-recording-bar" } as? DashboardRecordingBar)
      XCTAssertTrue(bar.isHidden)
      dashboard.presentRecordingBar(active: true, destination: "Sample")
      for index in 0..<32 { bar.pill.level = 0.12 + abs(sin(CGFloat(index) * 0.7)) * 0.7 }
      bar.tick(elapsed: 12, level: 0.5)
      dashboard.contentOffset = CGPoint(x: 0, y: 0)
      dashboard.layoutIfNeeded()
      XCTAssertFalse(bar.isHidden)
      XCTAssertEqual(bar.destination.text, "To Sample")
      XCTAssertEqual(bar.frame.maxY, dashboard.bounds.maxY, accuracy: 0.5)
      XCTAssertEqual(bar.pill.bounds.width, 224, accuracy: 0.5)
      XCTAssertLessThan(bar.sendCue.frame.maxY, bar.pill.frame.minY)
      XCTAssertEqual(bar.cancelButton.frame.minX, bar.pill.frame.minX, accuracy: 0.5)
      XCTAssertEqual(bar.cancelButton.bounds.width, 44)
      XCTAssertEqual(bar.sendCue.bounds.width, 44)
      XCTAssertEqual(bar.cancelButton.accessibilityLabel, "Cancel recording")
      let renderer = UIGraphicsImageRenderer(bounds: dashboard.bounds)
      var image: UIImage!
      dashboard.traitCollection.performAsCurrent {
        image = renderer.image { context in dashboard.layer.render(in: context.cgContext) }
      }
      let shot = XCTAttachment(image: image)
      shot.name = "Dashboard recording bar \(dark ? "dark" : "light")"
      shot.lifetime = .keepAlways
      add(shot)
      dashboard.presentRecordingBar(active: true, destination: "Sample", sendProgress: 1)
      XCTAssertEqual(bar.sendCue.transform.a, 2, accuracy: 0.001)
      if !Motion.reduced {
        dashboard.presentRecordingBar(active: true, destination: "Sample", sendProgress: 0, fingerInWindow: CGPoint(x: 50, y: 50))
        let rest = bar.sendCue.superview!.convert(bar.sendCue.center, to: nil)
        let finger = CGPoint(x: rest.x - 40, y: rest.y - 200)
        dashboard.presentRecordingBar(active: true, destination: "Sample", sendProgress: 1, fingerInWindow: finger)
        let centre = bar.sendCue.convert(CGPoint(x: bar.sendCue.bounds.midX, y: bar.sendCue.bounds.midY), to: nil)
        XCTAssertEqual(centre.x, rest.x, accuracy: 0.5)
        XCTAssertEqual(centre.y, finger.y, accuracy: 0.5)
      }
      dashboard.presentRecordingBar(active: true, destination: "Sample", cancelProgress: 1)
      XCTAssertEqual(bar.cancelButton.transform.a, 1.5, accuracy: 0.001)
      if !Motion.reduced {
        let rest = bar.cancelButton.superview!.convert(bar.cancelButton.center, to: nil)
        let finger = CGPoint(x: rest.x - 80, y: rest.y - 30)
        dashboard.presentRecordingBar(active: true, destination: "Sample", cancelProgress: 1, fingerInWindow: finger)
        let centre = bar.cancelButton.convert(CGPoint(x: 22, y: 22), to: nil)
        XCTAssertEqual(centre.x, finger.x, accuracy: 0.5)
        XCTAssertEqual(centre.y, rest.y, accuracy: 0.5)
      }
      dashboard.presentRecordingBar(active: false, destination: "Sample")
      XCTAssertFalse(bar.presented)
    }
    let payload = try JSONEncoder().encode(DashboardActionPayload(action: "voice", project: "p", path: "/x", send: true))
    XCTAssertTrue(String(decoding: payload, as: UTF8.self).contains("\"send\":true"))
    let plain = try JSONEncoder().encode(DashboardActionPayload(action: "open"))
    XCTAssertFalse(String(decoding: plain, as: UTF8.self).contains("send"))
  }

  @MainActor
  func testDashboardSendingDoesNotMoveCards() throws {
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    for width: CGFloat in [393, 768, 1024, 1366] {
      let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: width, height: 1000))
      func apply(_ sending: Bool) throws {
        let json = """
        {"connected":true,"busy":false,"agent":"Project defaults","projects":[
        {"id":"a","name":"A","color":"#777777","assistant":"","activity":"","model":"","canStart":true,"sending":\(sending)},
        {"id":"b","name":"Second","color":"#777777","assistant":"","activity":"","model":"","canStart":true}]}
        """
        dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: Data(json.utf8)))
        dashboard.layoutIfNeeded(); dashboard.layoutIfNeeded()
      }
      func frames() -> [CGRect] { descendants(dashboard).filter { $0 is DashboardCardView }.map { $0.convert($0.bounds, to: dashboard) } }
      try apply(false)
      let idle = frames()
      XCTAssertEqual(idle.count, 2)
      try apply(true)
      XCTAssertEqual(frames(), idle, "Sending changed card geometry at width \(width)")
      XCTAssertTrue(descendants(dashboard).contains { ($0 as? UIActivityIndicatorView)?.isAnimating == true })
      try apply(false)
      XCTAssertEqual(frames(), idle)
    }
  }

  @MainActor
  func testDashboardRendersScreenshotsAcrossDevices() throws {
    let animationsEnabled = UIView.areAnimationsEnabled
    UIView.setAnimationsEnabled(false)
    defer { UIView.setAnimationsEnabled(animationsEnabled) }
    func thread(_ n: Int, _ title: String) -> String { ##"{"status":"running","unread":false,"id":"t\##(n)","title":"\##(title)"}"## }
    let long = "Investigate why the nightly export job silently drops attachments larger than ten megabytes on retry"
    let json = ##"""
    {"connected":true,"busy":false,"agent":"Project defaults","workspace":"Personal",
     "projects":[
      {"id":"a","name":"Lucy Platform","color":"#4f8cff","assistant":"","activity":"","model":"","canStart":true,"recent":[\##(thread(1, "Fix onboarding email bounce")),\##(thread(2, long)),\##(thread(3, "Refactor pipeline view"))]},
      {"id":"b","name":"Lucy Website","color":"#34c759","assistant":"","activity":"","model":"","canStart":true,"recent":[\##(thread(4, "Update pricing page copy"))]},
      {"id":"c","name":"Lucy Mobile","color":"#ff9f0a","assistant":"","activity":"","model":"","canStart":true},
      {"id":"d","name":"AI Juicing","color":"#bf5af2","assistant":"","activity":"","model":"","canStart":true,"recent":[\##(thread(5, "Recipe ranking prompt")),\##(thread(6, "Customer interview synthesis")),\##(thread(7, "Landing page A/B test plan"))]},
      {"id":"e","name":"A Very Long Project Name That Must Truncate Cleanly","color":"#ff453a","assistant":"","activity":"","model":"","canStart":true,"recent":[\##(thread(8, "Short"))]},
      {"id":"f","name":"Freddai","color":"#64d2ff","assistant":"","activity":"","model":"","canStart":true}],
     "projectGroups":[{"id":"g1","name":"Lucy","projects":["a","b","c"]},{"id":"g2","name":"AI Juicing","projects":["d","e"]},{"id":"g3","name":"Personal","projects":["f"]}]}
    """##
    let model = try JSONDecoder().decode(DashboardModel.self, from: Data(json.utf8))
    let out = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("output/dashboard-screens")
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    let sizes: [(String, CGSize)] = [("ipad-landscape", CGSize(width: 1366, height: 1024)), ("ipad-portrait", CGSize(width: 1024, height: 1366)), ("iphone", CGSize(width: 393, height: 852))]
    for (name, size) in sizes {
      let window = UIWindow(frame: CGRect(origin: .zero, size: size))
      window.overrideUserInterfaceStyle = .dark
      let root = UIViewController()
      root.view.backgroundColor = ComposerView.threadBackground
      let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: size.width, height: size.height))
      root.view.addSubview(dashboard)
      window.rootViewController = root
      window.isHidden = false
      defer { window.isHidden = true }
      dashboard.setVoice(true)
      dashboard.apply(model)
      dashboard.layoutIfNeeded()
      dashboard.layoutIfNeeded()
      func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
      let views = descendants(dashboard)
      let cards = views.filter { $0 is DashboardCardView }
      XCTAssertEqual(cards.count, 6)
      // Controls share the header baseline and keep 44 pt targets.
      for id in ["a", "b", "c", "d", "e", "f"] {
        let create = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-new-\(id)" })
        let mic = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-mic-\(id)" })
        let card = try XCTUnwrap(cards.first { create.isDescendant(of: $0) })
        XCTAssertEqual(create.bounds.size, CGSize(width: 44, height: 44))
        XCTAssertEqual(create.convert(create.bounds, to: card).minY, mic.convert(mic.bounds, to: card).minY, accuracy: 0.5)
        if size.width >= 600 { XCTAssertEqual(create.convert(create.bounds, to: card).minY, 4, accuracy: 0.5) }
      }
      let row = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-thread-t1" })
      XCTAssertEqual(row.bounds.height, 34, accuracy: 0.5)
      let longRow = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-thread-t2" })
      let longTitle = try XCTUnwrap(descendants(longRow).compactMap { $0 as? UILabel }.first { $0.text == long })
      XCTAssertEqual(longTitle.numberOfLines, 1)
      XCTAssertEqual(longTitle.lineBreakMode, .byTruncatingTail)
      let status = try XCTUnwrap(descendants(longRow).first { $0 is StatusIndicatorView })
      XCTAssertEqual(status.convert(status.bounds, to: longRow).maxX, longRow.bounds.width, accuracy: 1)
      XCTAssertEqual(longTitle.convert(longTitle.bounds, to: longRow).maxX + 4, status.convert(status.bounds, to: longRow).minX, accuracy: 1)
      XCTAssertEqual(descendants(longRow).filter { $0 is StatusIndicatorView }.count, 1)

      XCTAssertNotNil(views.first { ($0 as? UILabel)?.text == "No threads yet" })
      let renderer = UIGraphicsImageRenderer(bounds: root.view.bounds)
      var image: UIImage!
      window.traitCollection.performAsCurrent {
        image = renderer.image { context in root.view.layer.render(in: context.cgContext) }
      }
      try XCTUnwrap(image.pngData()).write(to: out.appendingPathComponent("dashboard-\(name).png"))
      let shot = XCTAttachment(image: image); shot.name = "Dashboard \(name)"; shot.lifetime = .keepAlways; add(shot)
    }
  }

  @MainActor
  func testDashboardSharedDefaultsAreCompactAndResponsive() throws {
    for width: CGFloat in [393, 744, 834, 1194] {
      let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: width, height: 1100))
      let window = UIWindow(frame: dashboard.bounds)
      window.overrideUserInterfaceStyle = .dark
      let root = UIViewController(); root.view.backgroundColor = .systemBackground
      root.view.addSubview(dashboard); window.rootViewController = root; window.isHidden = false
      defer { window.isHidden = true }
      let data = Data(##"{"connected":true,"busy":false,"agent":"Codex","hasControls":true,"model":"Smart","difficulty":"Smart","projects":[{"id":"sample","name":"Sample","color":"#123456","assistant":"a","activity":"","model":"Old per-project model","canStart":true}]}"##.utf8)
      dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: data)); dashboard.layoutIfNeeded()
      func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
      let views = descendants(dashboard)
      let heading = try XCTUnwrap(views.first { ($0 as? UILabel)?.text == "Your projects" })
      let provider = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-agent" } as? UIButton)
      let effort = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-difficulty" } as? UIButton)
      func rect(_ view: UIView) -> CGRect { view.convert(view.bounds, to: dashboard) }
      if width >= 620 {
        XCTAssertGreaterThan(rect(provider).minX, rect(heading).maxX)
        XCTAssertEqual(rect(provider).midY, rect(heading).midY, accuracy: 1)
      } else {
        XCTAssertGreaterThanOrEqual(rect(provider).minY, rect(heading).maxY)
      }
      XCTAssertEqual(rect(effort).midY, rect(provider).midY, accuracy: 1)
      XCTAssertLessThanOrEqual(rect(provider).height, 48)
      XCTAssertGreaterThan(rect(effort).minX, rect(provider).minX)
      XCTAssertFalse(views.contains { $0.accessibilityIdentifier == "dashboard-model-sample" })
      for view in [provider, effort] { XCTAssertGreaterThanOrEqual(rect(view).minX, 0); XCTAssertLessThanOrEqual(rect(view).maxX, width) }
      var actions: [String] = []; dashboard.onAction = { actions.append($0.action) }
      effort.sendActions(for: .touchUpInside)
      XCTAssertEqual(actions, ["dashboard-effort"])
      let out = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("output/dashboard-screens")
      try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
      let image = UIGraphicsImageRenderer(bounds: dashboard.bounds).image { context in dashboard.layer.render(in: context.cgContext) }
      try XCTUnwrap(image.pngData()).write(to: out.appendingPathComponent("shared-defaults-\(Int(width)).png"))
    }
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
    XCTAssertEqual(mic.bounds.width, mic.bounds.height, accuracy: 0.5)
    XCTAssertEqual(mic.bounds.size, create.bounds.size)
    XCTAssertEqual(mic.configuration?.baseForegroundColor, create.configuration?.baseForegroundColor)
    XCTAssertEqual(mic.configuration?.background.backgroundColor, create.configuration?.background.backgroundColor)
    let title = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-project-sample" } as? UIButton)
    XCTAssertEqual(title.configuration?.baseForegroundColor, .label)
    let dot = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-dot-sample" })
    XCTAssertEqual(dot.backgroundColor, UIColor(red: 18.0 / 255, green: 52.0 / 255, blue: 86.0 / 255, alpha: 1))
    XCTAssertEqual(create.convert(create.bounds, to: dashboard).midY, mic.convert(mic.bounds, to: dashboard).midY, accuracy: 1)
    XCTAssertFalse(views.contains { ($0 as? UILabel)?.text == "No activity" })
    XCTAssertFalse(views.contains { ($0 as? UIButton)?.configuration?.title == "Model default" })
    XCTAssertFalse(views.contains { $0.accessibilityIdentifier == "dashboard-model-sample" })
    let agent = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-agent" })
    let heading = try XCTUnwrap(views.first { ($0 as? UILabel)?.text == "Your projects" })
    XCTAssertGreaterThanOrEqual(agent.convert(agent.bounds, to: dashboard).minY, heading.convert(heading.bounds, to: dashboard).maxY)

  }

  @MainActor
  func testDashboardPhoneHasTwoColumnsAndThreadLinks() throws {
    let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: 393, height: 900))
    let data = Data(##"{"connected":true,"busy":false,"agent":"Defaults","projects":[{"id":"a","name":"Alpha","color":"","assistant":"","activity":"","model":"","canStart":false,"recent":[{"id":"t1","title":"Recent task"}]},{"id":"b","name":"Beta","color":"","assistant":"","activity":"","model":"","canStart":false}]}"##.utf8)
    var action: DashboardActionPayload?
    dashboard.onAction = { action = $0 }
    dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: data))
    dashboard.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    XCTAssertEqual(dashboard.workspace.bounds.width, 393, accuracy: 1)
    XCTAssertEqual(dashboard.workspace.convert(dashboard.workspace.bounds, to: dashboard).minX, 0, accuracy: 1)
    let views = descendants(dashboard)
    let a = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-project-a" })
    let b = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-project-b" })
    XCTAssertEqual(a.convert(a.bounds, to: dashboard).minY, b.convert(b.bounds, to: dashboard).minY, accuracy: 1)
    XCTAssertLessThan(a.convert(a.bounds, to: dashboard).maxX, b.convert(b.bounds, to: dashboard).minX)
    let link = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-thread-t1" } as? UIButton)
    link.sendActions(for: .touchUpInside)
    XCTAssertEqual(action?.action, "thread")
    XCTAssertEqual(action?.project, "a")
    XCTAssertEqual(action?.thread, "t1")
  }

  @MainActor
  func testDashboardWorkspaceFillsTabletWidthAndHasNoRedundantPicker() throws {
    let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: 900, height: 1000))
    dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: Data(#"{"connected":true,"busy":false,"agent":"Project defaults","workspace":"All workspaces","workspaceHeight":607,"projects":[]}"#.utf8)))
    dashboard.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    XCTAssertFalse(descendants(dashboard).contains { $0.accessibilityIdentifier == "dashboard-workspace-picker" })
    XCTAssertEqual(dashboard.workspace.bounds.width, 900, accuracy: 1)
    do {
      XCTAssertEqual(dashboard.workspace.bounds.height, 607, accuracy: 1)
      dashboard.frame.size.width = 500
      dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: Data(#"{"connected":true,"busy":false,"agent":"Project defaults","workspaceHeight":345,"projects":[]}"#.utf8)))
      dashboard.setNeedsLayout()
      dashboard.layoutIfNeeded()
      XCTAssertEqual(dashboard.workspace.bounds.height, 345, accuracy: 1)
    }
  }

  @MainActor
  func testDashboardWorkspaceHeadingsPrecedeTheirShortcuts() throws {
    let dashboard = DashboardView(frame: CGRect(x: 0, y: 0, width: 393, height: 1100))
    let data = Data(##"{"connected":true,"busy":false,"agent":"Project defaults","projects":[{"id":"a","name":"Alpha","color":"#123456","assistant":"","activity":"","model":"","canStart":true},{"id":"b","name":"Beta","color":"#123456","assistant":"","activity":"","model":"","canStart":true}],"projectGroups":[{"id":"work","name":"Work","projects":["a"]},{"id":"home","name":"Home","projects":["b"]}]}"##.utf8)
    dashboard.apply(try JSONDecoder().decode(DashboardModel.self, from: data))
    dashboard.layoutIfNeeded()
    func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
    let views = descendants(dashboard)
    let work = try XCTUnwrap(views.first { ($0 as? UILabel)?.text == "WORK" })
    let home = try XCTUnwrap(views.first { ($0 as? UILabel)?.text == "HOME" })
    let alpha = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-new-a" })
    let beta = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "dashboard-new-b" })
    XCTAssertLessThan(work.convert(work.bounds, to: dashboard).midY, alpha.convert(alpha.bounds, to: dashboard).midY)
    XCTAssertLessThan(alpha.convert(alpha.bounds, to: dashboard).midY, home.convert(home.bounds, to: dashboard).midY)
    XCTAssertLessThan(home.convert(home.bounds, to: dashboard).midY, beta.convert(beta.bounds, to: dashboard).midY)
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

  @MainActor
  func testPreviewControllerRendersBannerAndScreenshot() throws {
    let out = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("output/preview-screens")
    try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
    for (name, style, error) in [("preview-light-error", UIUserInterfaceStyle.light, true), ("preview-dark-status", .dark, false)] {
      let preview = PreviewViewController(url: URL(string: "about:blank")!, title: "localhost:3000")
      let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 430, height: 932))
      window.overrideUserInterfaceStyle = style
      window.rootViewController = preview
      window.isHidden = false
      defer { window.isHidden = true }
      preview.loadViewIfNeeded()
      preview.setStatus(message: error ? "Preview failed to load: Could not connect to the server. (NSURLErrorDomain -1004)" : "Connecting to your Mac...", error: error)
      preview.view.layoutIfNeeded()
      func descendants(_ view: UIView) -> [UIView] { view.subviews.flatMap { [$0] + descendants($0) } }
      let views = descendants(preview.view)
      XCTAssertNotNil(views.compactMap { $0 as? UIButton }.first { $0.accessibilityLabel == "Close preview" })
      let banner = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "preview-banner" })
      XCTAssertEqual(banner.superview?.isHidden, false)
      var png = Data()
      window.traitCollection.performAsCurrent { png = UIGraphicsImageRenderer(bounds: window.bounds).pngData { c in preview.view.layer.render(in: c.cgContext) } }
      try png.write(to: out.appendingPathComponent("\(name).png"))
      var closed = false
      preview.onDismissed = { closed = true }
      preview.setStatus(message: "", error: false)
      XCTAssertEqual(banner.superview?.isHidden, true)
      _ = closed
    }
  }

  @MainActor
  func testCallIndicatorShowsTimerAndControlsAndDecodesDefensively() throws {
    let view = CallIndicatorView()
    let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 100))
    window.addSubview(view); window.isHidden = false
    defer { window.isHidden = true }
    var actions: [String] = []
    view.onMute = { actions.append("mute") }
    view.onHangup = { actions.append("hangup") }
    view.apply(CallState(active: true, startedAt: Date().timeIntervalSince1970 * 1000 - 83_000, muted: false, phase: "listening"))
    view.frame.size = view.systemLayoutSizeFitting(UIView.layoutFittingCompressedSize)
    view.layoutIfNeeded()
    XCTAssertLessThanOrEqual(view.frame.width, 200, "group must fit beside the other bar items")
    XCTAssertEqual(view.timerLabel.text, "1:23")
    XCTAssertEqual(view.hangupButton.accessibilityLabel, "End call")
    XCTAssertEqual(view.muteButton.accessibilityLabel, "Mute")
    XCTAssertGreaterThanOrEqual(view.hangupButton.bounds.width, 44)
    XCTAssertTrue(view.accessibilityLabel?.hasPrefix("Commander call, listening, 1:2") ?? false)
    // No UIApplication in the unit-test host, so sendActions is a no-op: fire the wired selectors directly.
    for (button, name) in [(view.muteButton, "muteTapped"), (view.hangupButton, "hangupTapped")] {
      XCTAssertTrue(button.actions(forTarget: view, forControlEvent: .touchUpInside)?.contains(name) ?? false)
      view.perform(Selector(name))
    }
    XCTAssertEqual(actions, ["mute", "hangup"])
    view.apply(CallState(active: true, startedAt: nil, muted: true, phase: "paused"))
    XCTAssertEqual(view.muteButton.accessibilityLabel, "Unmute")
    view.compact = true
    XCTAssertTrue(view.waveform.isHidden)
    let ok = try JSONDecoder().decode(CallState.self, from: Data(#"{"active":true,"startedAt":1000,"muted":true,"phase":"hearing"}"#.utf8))
    XCTAssertEqual(ok.phase, "hearing")
    XCTAssertTrue(ok.muted)
    let bad = try JSONDecoder().decode(CallState.self, from: Data(#"{"active":"yes","phase":7}"#.utf8))
    XCTAssertFalse(bad.active)
    XCTAssertEqual(bad.phase, "idle")
  }
}
