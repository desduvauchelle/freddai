import UIKit

// MARK: Model (mirrors packages/app/src/mobile/native-threads.ts; JS is the source of truth)

struct ThreadRowModel: Decodable, Equatable {
  let id: String
  let title: String
  var pinned: Bool?
  let status: String
  let faded: Bool?
  let unread: Bool
  let updatedAt: Double
}

struct ThreadGroupModel: Decodable, Equatable {
  let project: String
  let label: String
  var color: String = ""
  var canStart: Bool = true
  let threads: [ThreadRowModel]
  var olderRemaining: Int = 0
  var olderLabel: String = ""
}

struct OptionModel: Decodable, Equatable {
  let id: String
  let label: String
}

struct ThreadFiltersModel: Decodable, Equatable {
  var workspace: String?

  var project: String = ""
  var status: String = "all"
  var query: String = ""
}

struct ThreadsModel: Decodable {
  let groups: [ThreadGroupModel]
  var selectedId: String = ""
  var filters: ThreadFiltersModel = ThreadFiltersModel()
  var workspaceOptions: [OptionModel]?
  var projectOptions: [OptionModel] = []
  var statusOptions: [OptionModel] = []
}

private enum DrawerItem: Hashable {
  case header(String)
  case thread(String)
  case older(String)
  case empty
}

// MARK: Drawer

/// Native thread list: header (title, connection, dashboard), search + filter menu, per-project sections.
final class ThreadDrawerViewController: UIViewController, UICollectionViewDelegate, UITextFieldDelegate {
  var onDashboard: (() -> Void)?
  var onSelectThread: ((String) -> Void)?
  var onSearch: ((String) -> Void)?
  var onSetFilter: ((String, String, String?) -> Void)?
  var onNewThread: ((String) -> Void)?
  var onShowOlder: ((String) -> Void)?

  private var collapsedProjects = Set<String>()
  private var model: ThreadsModel?
  private var rows: [String: ThreadRowModel] = [:]
  private var groups: [String: ThreadGroupModel] = [:]

  private var collectionView: UICollectionView!
  private var dataSource: UICollectionViewDiffableDataSource<String, DrawerItem>!
  private let searchField = UISearchTextField()
  private let filterButton = UIButton(type: .system)
  private let connectionIcon = UIImageView(image: UIImage(systemName: "desktopcomputer"))
  private var searchDebounce: DispatchWorkItem?
  private let emptySection = "__empty__"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let header = makeHeader()
    header.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(header)

    var layout = UICollectionLayoutListConfiguration(appearance: .sidebar)
    layout.showsSeparators = false
    layout.backgroundColor = .clear
    collectionView = UICollectionView(frame: .zero, collectionViewLayout: UICollectionViewCompositionalLayout.list(using: layout))
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    collectionView.backgroundColor = .clear
    collectionView.delegate = self
    collectionView.keyboardDismissMode = .onDrag
    collectionView.allowsSelection = true
    collectionView.accessibilityIdentifier = "thread-drawer-list"
    view.addSubview(collectionView)
    configureDataSource()

    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
      collectionView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 6),
      collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      collectionView.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
    ])
    if let model = model { apply(model) }

    // Floating "New thread" button (not tied to a project).
    var fabConfig = UIButton.Configuration.filled()
    fabConfig.image = UIImage(systemName: "square.and.pencil")
    fabConfig.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
    fabConfig.baseBackgroundColor = .tintColor
    fabConfig.baseForegroundColor = .white
    fabConfig.cornerStyle = .capsule
    let fab = UIButton(configuration: fabConfig)
    fab.translatesAutoresizingMaskIntoConstraints = false
    fab.accessibilityLabel = "New thread"
    fab.layer.shadowColor = UIColor.black.cgColor
    fab.layer.shadowOpacity = 0.25
    fab.layer.shadowRadius = 10
    fab.layer.shadowOffset = CGSize(width: 0, height: 4)
    fab.addAction(UIAction { [weak self] _ in self?.onNewThread?("") }, for: .touchUpInside)
    view.addSubview(fab)
    NSLayoutConstraint.activate([
      fab.widthAnchor.constraint(equalToConstant: 56),
      fab.heightAnchor.constraint(equalToConstant: 56),
      fab.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
      fab.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -16),
    ])
    collectionView.contentInset.bottom = 56 + 16
    collectionView.verticalScrollIndicatorInsets.bottom = 56 + 16
  }

  // MARK: Header

  private func makeHeader() -> UIView {
    let title = UILabel()
    title.text = "Freddai"
    title.font = .systemFont(ofSize: 22, weight: .bold)
    title.accessibilityTraits = .header

    connectionIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
    connectionIcon.tintColor = .systemGray
    connectionIcon.contentMode = .scaleAspectFit
    connectionIcon.isAccessibilityElement = true
    connectionIcon.accessibilityLabel = "Mac connection"
    connectionIcon.accessibilityValue = "Connecting"

    let spacer = UIView()
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)

    let titleRow = UIStackView(arrangedSubviews: [title, connectionIcon, spacer])
    titleRow.axis = .horizontal
    titleRow.alignment = .center
    titleRow.spacing = 8

    searchField.placeholder = "Search projects and threads"
    searchField.returnKeyType = .search
    searchField.autocorrectionType = .no
    searchField.autocapitalizationType = .none
    searchField.delegate = self
    searchField.accessibilityLabel = "Search threads"
    searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)

    filterButton.setImage(UIImage(systemName: "line.3.horizontal.decrease.circle"), for: .normal)
    filterButton.showsMenuAsPrimaryAction = true
    filterButton.accessibilityLabel = "Filter threads"
    filterButton.widthAnchor.constraint(equalToConstant: 40).isActive = true
    filterButton.heightAnchor.constraint(equalToConstant: 40).isActive = true
    filterButton.setPreferredSymbolConfiguration(UIImage.SymbolConfiguration(pointSize: 22, weight: .regular), forImageIn: .normal)

    let searchRow = UIStackView(arrangedSubviews: [searchField, filterButton])
    searchRow.axis = .horizontal
    searchRow.alignment = .center
    searchRow.spacing = 6

    var dashboardConfig = UIButton.Configuration.plain()
    dashboardConfig.title = "Dashboard"
    dashboardConfig.image = UIImage(systemName: "square.grid.2x2")
    dashboardConfig.imagePadding = 10
    let dashboard = UIButton(configuration: dashboardConfig)
    dashboard.contentHorizontalAlignment = .leading
    dashboard.accessibilityIdentifier = "companion-dashboard"
    dashboard.addAction(UIAction { [weak self] _ in self?.onDashboard?() }, for: .touchUpInside)
    let column = UIStackView(arrangedSubviews: [titleRow, dashboard, searchRow])
    column.axis = .vertical
    column.spacing = 10
    return column
  }

  @objc private func searchChanged() {
    searchDebounce?.cancel()
    let text = searchField.text ?? ""
    let work = DispatchWorkItem { [weak self] in self?.onSearch?(text) }
    searchDebounce = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: work)
  }

  func textFieldShouldReturn(_ textField: UITextField) -> Bool { textField.resignFirstResponder(); return true }

  func setConnection(state: String, message: String?) {
    switch state {
    case "ok": connectionIcon.tintColor = .systemGreen; connectionIcon.accessibilityValue = "Connected"
    case "down": connectionIcon.tintColor = .systemRed; connectionIcon.accessibilityValue = message ?? "Disconnected"
    default: connectionIcon.tintColor = .systemGray; connectionIcon.accessibilityValue = "Connecting"
    }
  }

  func dismissKeyboard() { view.endEditing(true) }

  private func rebuildFilterMenu(_ model: ThreadsModel) {
    let projects = model.projectOptions.map { option in
      UIAction(title: option.label, state: option.id == model.filters.project ? .on : .off) { [weak self] _ in
        self?.onSetFilter?(option.id, model.filters.status, nil)
      }
    }
    let statuses = model.statusOptions.map { option in
      UIAction(title: option.label, state: option.id == model.filters.status ? .on : .off) { [weak self] _ in
        self?.onSetFilter?(model.filters.project, option.id, nil)
      }
    }
    let workspaces = (model.workspaceOptions ?? []).map { option in
      UIAction(title: option.label, state: option.id == (model.filters.workspace ?? "") ? .on : .off) { [weak self] _ in
        self?.onSetFilter?("", "all", option.id)
      }
    }
    var menus: [UIMenuElement] = []
    if workspaces.count > 1 { menus.append(UIMenu(title: "Workspace", options: .displayInline, children: workspaces)) }
    filterButton.menu = UIMenu(children: menus + [
      UIMenu(title: "Project", options: .displayInline, children: projects),
      UIMenu(title: "Status", options: .displayInline, children: statuses),
    ])
    let active = !(model.filters.workspace ?? "").isEmpty || !model.filters.project.isEmpty || model.filters.status != "all"
    filterButton.setImage(UIImage(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"), for: .normal)
    filterButton.accessibilityValue = active ? "Filters on" : nil
  }

  // MARK: Data source

  private func configureDataSource() {
    let headerReg = UICollectionView.CellRegistration<ProjectHeaderCell, String> { [weak self] cell, _, project in
      guard let self = self, let group = self.groups[project] else { return }
      cell.configure(group: group, collapsed: self.collapsedProjects.contains(project)) { [weak self] in self?.onNewThread?(project) }
    }
    let threadReg = UICollectionView.CellRegistration<ThreadCell, String> { [weak self] cell, _, id in
      if let row = self?.rows[id] { cell.configure(row) }
    }
    let olderReg = UICollectionView.CellRegistration<TextRowCell, String> { [weak self] cell, _, project in
      let label = self?.groups[project]?.olderLabel ?? "Show older threads"
      cell.configure(text: label, color: .tintColor, centered: false, button: true)
    }
    let emptyReg = UICollectionView.CellRegistration<TextRowCell, String> { [weak self] cell, _, _ in
      let filtered = (self?.model?.filters).map { !$0.query.isEmpty || !$0.project.isEmpty || $0.status != "all" } ?? false
      cell.configure(text: filtered ? "No threads match your filters." : "No threads yet. Start one with the compose button.", color: .secondaryLabel, centered: true, button: false)
    }
    dataSource = UICollectionViewDiffableDataSource<String, DrawerItem>(collectionView: collectionView) { cv, indexPath, item in
      switch item {
      case .header(let p): return cv.dequeueConfiguredReusableCell(using: headerReg, for: indexPath, item: p)
      case .thread(let id): return cv.dequeueConfiguredReusableCell(using: threadReg, for: indexPath, item: id)
      case .older(let p): return cv.dequeueConfiguredReusableCell(using: olderReg, for: indexPath, item: p)
      case .empty: return cv.dequeueConfiguredReusableCell(using: emptyReg, for: indexPath, item: "")
      }
    }
  }

  /// Applies a new model with a diff keyed by thread id, so updates do not reload the list or reset its scroll offset.
  func apply(_ new: ThreadsModel) {
    let previousRows = rows, previousGroups = groups
    model = new
    rows = Dictionary(new.groups.flatMap { $0.threads }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    groups = Dictionary(new.groups.map { ($0.project, $0) }, uniquingKeysWith: { a, _ in a })
    guard isViewLoaded, dataSource != nil else { return }

    var snapshot = NSDiffableDataSourceSnapshot<String, DrawerItem>()
    var seen = Set<DrawerItem>()
    var sections = Set<String>()
    for group in new.groups where sections.insert(group.project).inserted {
      snapshot.appendSections([group.project])
      var items: [DrawerItem] = [.header(group.project)]
      if !collapsedProjects.contains(group.project) {
        items += group.threads.map { .thread($0.id) }
        if group.olderRemaining > 0 { items.append(.older(group.project)) }
      }
      snapshot.appendItems(items.filter { seen.insert($0).inserted }, toSection: group.project)
    }
    if new.groups.allSatisfy({ $0.threads.isEmpty }) {
      snapshot.appendSections([emptySection])
      snapshot.appendItems([.empty], toSection: emptySection)
    }
    var changed: [DrawerItem] = []
    for item in snapshot.itemIdentifiers {
      switch item {
      case .thread(let id): if previousRows[id] != rows[id] { changed.append(item) }
      case .header(let p):
        changed.append(item)
      case .older(let p): if previousGroups[p]?.olderLabel != groups[p]?.olderLabel { changed.append(item) }
      case .empty: changed.append(item)
      }
    }
    let existing = Set(dataSource.snapshot().itemIdentifiers)
    let toReconfigure = changed.filter { existing.contains($0) }
    if !toReconfigure.isEmpty { snapshot.reconfigureItems(toReconfigure) }
    dataSource.apply(snapshot, animatingDifferences: view.window != nil && !existing.isEmpty) { [weak self] in self?.syncSelection() }

    rebuildFilterMenu(new)
    if !searchField.isFirstResponder, (searchField.text ?? "") != new.filters.query { searchField.text = new.filters.query }
  }

  /// Re-renders visible rows so relative times ("5 min ago") are fresh whenever the drawer opens.
  func refreshTimes() {
    guard isViewLoaded, dataSource != nil else { return }
    var snapshot = dataSource.snapshot()
    let threads = snapshot.itemIdentifiers.filter { if case .thread = $0 { return true } else { return false } }
    guard !threads.isEmpty else { return }
    snapshot.reconfigureItems(threads)
    dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in self?.syncSelection() }
  }

  private func syncSelection() {
    guard let selected = model?.selectedId, !selected.isEmpty, let path = dataSource.indexPath(for: .thread(selected)) else {
      collectionView.indexPathsForSelectedItems?.forEach { collectionView.deselectItem(at: $0, animated: false) }
      return
    }
    if collectionView.indexPathsForSelectedItems != [path] { collectionView.selectItem(at: path, animated: false, scrollPosition: []) }
  }

  // MARK: UICollectionViewDelegate

  func collectionView(_ collectionView: UICollectionView, shouldSelectItemAt indexPath: IndexPath) -> Bool {
    switch dataSource.itemIdentifier(for: indexPath) {
    case .header, .thread, .older: return true
    default: return false
    }
  }

  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    switch dataSource.itemIdentifier(for: indexPath) {
    case .header(let project):
      collectionView.deselectItem(at: indexPath, animated: false)
      if !collapsedProjects.insert(project).inserted { collapsedProjects.remove(project) }
      if let model = model { apply(model) }
    case .thread(let id): onSelectThread?(id)
    case .older(let project):
      collectionView.deselectItem(at: indexPath, animated: true)
      syncSelection()
      onShowOlder?(project)
    default: break
    }
  }
}

// MARK: Cells

private func color(fromHex hex: String) -> UIColor? {
  var h = hex.trimmingCharacters(in: .whitespaces)
  if h.hasPrefix("#") { h.removeFirst() }
  if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
  guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
  return UIColor(red: CGFloat((v >> 16) & 0xff) / 255, green: CGFloat((v >> 8) & 0xff) / 255, blue: CGFloat(v & 0xff) / 255, alpha: 1)
}

private extension UIFont {
  func bold() -> UIFont {
    guard let descriptor = fontDescriptor.withSymbolicTraits(.traitBold) else { return self }
    return UIFont(descriptor: descriptor, size: pointSize)
  }
}

final class ProjectHeaderCell: UICollectionViewListCell {
  private let icon = UIImageView(image: UIImage(systemName: "folder.fill"))
  private let label = UILabel()
  private let chevron = UIImageView()
  private let addButton = UIButton(type: .system)
  private var onAdd: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    icon.contentMode = .scaleAspectFit
    icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
    icon.setContentHuggingPriority(.required, for: .horizontal)
    label.font = UIFont.preferredFont(forTextStyle: .subheadline).bold()
    label.textColor = .secondaryLabel
    label.accessibilityTraits = .header
    label.lineBreakMode = .byTruncatingTail
    var config = UIButton.Configuration.plain()
    config.image = UIImage(systemName: "plus")
    config.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 14, weight: .semibold)
    addButton.configuration = config
    addButton.addAction(UIAction { [weak self] _ in self?.onAdd?() }, for: .touchUpInside)
    addButton.widthAnchor.constraint(equalToConstant: 40).isActive = true
    addButton.heightAnchor.constraint(equalToConstant: 40).isActive = true
    let spacer = UIView()
    spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
    let stack = UIStackView(arrangedSubviews: [chevron, icon, label, spacer, addButton])
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 4),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -2),
      stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 4),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -2),
    ])
    var background = UIBackgroundConfiguration.clear()
    background.backgroundColor = .clear
    backgroundConfiguration = background
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func configure(group: ThreadGroupModel, collapsed: Bool, onAdd: @escaping () -> Void) {
    self.onAdd = onAdd
    chevron.image = UIImage(systemName: collapsed ? "chevron.right" : "chevron.down")
    chevron.tintColor = .secondaryLabel
    chevron.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
    accessibilityLabel = group.label
    accessibilityValue = collapsed ? "Collapsed" : "Expanded"
    accessibilityHint = "Double tap to toggle threads"
    accessibilityTraits = [.button, .header]
    label.text = group.label
    let projectColor = color(fromHex: group.color) ?? .secondaryLabel
    icon.tintColor = projectColor
    label.textColor = projectColor
    addButton.isEnabled = group.canStart
    addButton.accessibilityLabel = "New thread in \(group.label)"
  }
}

final class StatusIndicatorView: UIView {
  static let slotWidth: CGFloat = 20
  /// Mirrors the desktop running dot (`.state-dot.state-In-progress`): #afb3bc, 1.8s ease-in-out cycle, opacity 1 -> 0.4 with a soft halo.
  private static let pulseColor = UIColor(red: 0xaf / 255, green: 0xb3 / 255, blue: 0xbc / 255, alpha: 1)
  private static let pulseKey = "freddai.running-pulse"
  private let dot = UIView()
  private var pulsing = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    dot.layer.cornerRadius = 4
    dot.translatesAutoresizingMaskIntoConstraints = false
    addSubview(dot)
    NSLayoutConstraint.activate([
      widthAnchor.constraint(equalToConstant: StatusIndicatorView.slotWidth),
      dot.widthAnchor.constraint(equalToConstant: 8), dot.heightAnchor.constraint(equalToConstant: 8),
      dot.centerXAnchor.constraint(equalTo: centerXAnchor), dot.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
    // Core Animation removes animations when the app is backgrounded or the view leaves a window, so re-add them.
    let center = NotificationCenter.default
    center.addObserver(self, selector: #selector(refreshPulse), name: UIApplication.willEnterForegroundNotification, object: nil)
    center.addObserver(self, selector: #selector(refreshPulse), name: UIApplication.didBecomeActiveNotification, object: nil)
    center.addObserver(self, selector: #selector(refreshPulse), name: UIAccessibility.reduceMotionStatusDidChangeNotification, object: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
  deinit { NotificationCenter.default.removeObserver(self) }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    refreshPulse()
  }

  @objc private func refreshPulse() {
    dot.layer.removeAnimation(forKey: StatusIndicatorView.pulseKey)
    guard pulsing, window != nil, !UIAccessibility.isReduceMotionEnabled else { return }
    let fade = CABasicAnimation(keyPath: "opacity")
    fade.fromValue = 1.0
    fade.toValue = 0.4
    let grow = CABasicAnimation(keyPath: "transform.scale")
    grow.fromValue = 1.0
    grow.toValue = 1.3
    let group = CAAnimationGroup()
    group.animations = [fade, grow]
    group.duration = 0.9
    group.autoreverses = true
    group.repeatCount = .infinity
    group.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
    group.isRemovedOnCompletion = false
    dot.layer.add(group, forKey: StatusIndicatorView.pulseKey)
  }

  /// Returns a spoken description of the status ("" when there is nothing to announce).
  @discardableResult
  func configure(status: String, unread: Bool) -> String {
    var dotColor: UIColor?
    var spoken = ""
    pulsing = status == "running" || status == "starting"
    switch status {
    case "running", "starting": dotColor = StatusIndicatorView.pulseColor; spoken = status == "running" ? "Running" : "Starting"
    case "waiting": dotColor = .systemOrange; spoken = "Needs you"
    case "interrupted": dotColor = .systemOrange; spoken = "Interrupted"
    case "failed", "error": dotColor = .systemRed; spoken = "Failed"
    default: if unread { dotColor = .systemBlue; spoken = "Unread reply" }
    }
    dot.backgroundColor = dotColor
    dot.isHidden = dotColor == nil
    // Re-evaluated on every configure so a reused cell never keeps (or loses) a previous row's pulse.
    refreshPulse()
    return spoken
  }
}

final class ThreadCell: UICollectionViewListCell {
  private let indicator = StatusIndicatorView()
  private let titleLabel = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    titleLabel.numberOfLines = 1
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.font = .preferredFont(forTextStyle: .body)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    indicator.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(indicator)
    contentView.addSubview(titleLabel)
    // Titles are a single truncated line, so the indicator slot is simply centred on the title.
    NSLayoutConstraint.activate([
      indicator.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 0),
      indicator.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
      indicator.heightAnchor.constraint(equalToConstant: 20),
      titleLabel.leadingAnchor.constraint(equalTo: indicator.trailingAnchor, constant: 6),
      titleLabel.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -4),
      titleLabel.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      titleLabel.topAnchor.constraint(greaterThanOrEqualTo: contentView.topAnchor, constant: 9),
      titleLabel.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -9),
      contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
    isAccessibilityElement = true
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func updateConfiguration(using state: UICellConfigurationState) {
    // Subtle Settings/Files-style selection: small radius, horizontal inset, quiet fill (not a pill).
    var background = UIBackgroundConfiguration.clear()
    if state.isSelected || state.isHighlighted {
      background.backgroundColor = state.isSelected ? .tertiarySystemFill : .quaternarySystemFill
      background.cornerRadius = 9
    }
    background.backgroundInsets = NSDirectionalEdgeInsets(top: 1, leading: 4, bottom: 1, trailing: 4)
    backgroundConfiguration = background
  }

  func configure(_ row: ThreadRowModel) {
    contentView.alpha = row.faded == true ? 0.65 : 1
    titleLabel.text = (row.pinned == true ? "📌 " : "") + row.title
    let body = UIFont.preferredFont(forTextStyle: .body)
    let font = row.unread ? body.bold() : body
    titleLabel.font = font
    let spoken = indicator.configure(status: row.status, unread: row.unread)
    accessibilityLabel = (row.pinned == true ? "Pinned, " : "") + row.title
    accessibilityValue = spoken.isEmpty ? nil : spoken
    accessibilityTraits = .button
  }
}

final class TextRowCell: UICollectionViewListCell {
  private let label = UILabel()
  private var leading: NSLayoutConstraint!

  override init(frame: CGRect) {
    super.init(frame: frame)
    label.numberOfLines = 0
    label.font = .preferredFont(forTextStyle: .subheadline)
    label.adjustsFontForContentSizeCategory = true
    label.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(label)
    leading = label.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 30)
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
      label.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
      leading,
      label.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func configure(text: String, color: UIColor, centered: Bool, button: Bool) {
    label.text = text
    label.textColor = color
    label.textAlignment = centered ? .center : .natural
    leading.constant = centered ? 8 : 30
    isAccessibilityElement = true
    accessibilityLabel = text
    accessibilityTraits = button ? .button : .staticText
  }
}
