import UIKit

// MARK: Model (mirrors packages/app/src/mobile/native-threads.ts; JS is the source of truth)

struct ThreadRowModel: Decodable, Equatable {
  let id: String
  let title: String
  var scheduled: Bool?
  var pinned: Bool?
  let status: String
  let faded: Bool?
  let unread: Bool
  let updatedAt: Double
  /// Only present on "Recent" rows: the owning project's name and colour for the small tag.
  var projectLabel: String?
  var projectColor: String?
}

struct RecentModel: Decodable, Equatable {
  var threads: [ThreadRowModel] = []
  var remaining: Int = 0
  var expanded: Bool = false
}

struct ThreadGroupModel: Decodable, Equatable {
  let project: String
  let label: String
  var color: String = ""
  var canStart: Bool = true
  let threads: [ThreadRowModel]
  var olderRemaining: Int = 0
  var olderLabel: String = ""
  var olderExpanded: Bool = false
  /// "commander" marks the Commander-in-Chief project: listed first, with the mascot, opening its screen on tap.
  var kind: String? = nil
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

struct ProductUsageModel: Decodable, Equatable {
  let id: String
  let name: String
  let product: String
  let remaining: Double?
  let capacity: String
  let reset: String
  let stale: Bool
  let details: String
  // Newer payload fields; optional so older payloads still decode.
  var session: String?
  var sessionRemaining: Double?
  var weekly: String?
  var weeklyRemaining: Double?
  var status: String?

  /// Old payloads (no session/weekly/status) fall back to the single capacity/reset row.
  var isLegacy: Bool { session == nil && weekly == nil && status == nil }
  var cardHeight: CGFloat { isLegacy ? 36 : (status != nil ? 34 : 58) }
}

/// A bounded footer: product identity, remaining capacity, then reset time.
/// More than four products scroll within the footer rather than displacing threads.
final class ProductUsageFooterView: UIView {
  var onDetails: (() -> Void)?
  private let backdrop = UIVisualEffectView(effect: UIBlurEffect(style: .systemUltraThinMaterial))
  private let backdropMask = CAGradientLayer()
  private let grid = UIStackView()
  private let scroll = UIScrollView()
  private var scrollHeight: NSLayoutConstraint!
  private var headerHeight: NSLayoutConstraint!
  private var products: [ProductUsageModel] = []

  override init(frame: CGRect) {
    super.init(frame: frame)
    backdrop.isUserInteractionEnabled = false
    backdropMask.colors = [UIColor.clear.cgColor, UIColor.black.withAlphaComponent(0.8).cgColor, UIColor.black.cgColor]
    backdropMask.locations = [0, 0.3, 1]
    backdrop.layer.mask = backdropMask
    addSubview(backdrop)
    let heading = UILabel()
    heading.text = "Usage"
    heading.font = .systemFont(ofSize: 12, weight: .medium)
    heading.textColor = UIColor.label.withAlphaComponent(0.72)
    heading.accessibilityTraits = .header
    let details = UIButton(type: .system)
    details.setTitle("Details ›", for: .normal)
    details.titleLabel?.font = .systemFont(ofSize: 12)
    details.setTitleColor(UIColor.label.withAlphaComponent(0.72), for: .normal)
    details.accessibilityLabel = "Product usage details"
    details.addAction(UIAction { [weak self] _ in self?.onDetails?() }, for: .touchUpInside)
    let header = UIStackView(arrangedSubviews: [heading, details])
    header.alignment = .center
    header.distribution = .equalSpacing
    headerHeight = header.heightAnchor.constraint(equalToConstant: 28)
    grid.axis = .vertical
    grid.spacing = 4
    for child in [header, scroll, grid] { child.translatesAutoresizingMaskIntoConstraints = false }
    addSubview(header)
    addSubview(scroll)
    scroll.addSubview(grid)
    scrollHeight = scroll.heightAnchor.constraint(equalToConstant: 0)
    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: topAnchor),
      header.leadingAnchor.constraint(equalTo: leadingAnchor),
      header.trailingAnchor.constraint(equalTo: trailingAnchor),
      scroll.topAnchor.constraint(equalTo: header.bottomAnchor),
      scroll.leadingAnchor.constraint(equalTo: leadingAnchor),
      scroll.trailingAnchor.constraint(equalTo: trailingAnchor),
      scroll.bottomAnchor.constraint(equalTo: bottomAnchor), scrollHeight, headerHeight,
      grid.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
      grid.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
      grid.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
      grid.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
      grid.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor),
    ])
    headerHeight.constant = 0
    isHidden = true
    accessibilityIdentifier = "product-usage-footer"
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

  override func layoutSubviews() {
    super.layoutSubviews()
    // Extend through the drawer margins and bottom safe area; fade in above the header.
    backdrop.frame = bounds.inset(by: UIEdgeInsets(top: -12, left: -20, bottom: -48, right: -20))
    backdropMask.frame = backdrop.bounds
  }

  func update(_ products: [ProductUsageModel]) {
    guard self.products != products else { return }
    self.products = products
    grid.arrangedSubviews.forEach { grid.removeArrangedSubview($0); $0.removeFromSuperview() }
    isHidden = products.isEmpty
    headerHeight.constant = products.isEmpty ? 0 : 28
    let cardHeight = products.map(\.cardHeight).max() ?? 36
    scrollHeight.constant = CGFloat(min(2, (products.count + 1) / 2)) * cardHeight + (products.count > 2 ? 4 : 0)
    for start in stride(from: 0, to: products.count, by: 2) {
      let row = UIStackView()
      row.axis = .horizontal
      row.spacing = 8
      row.distribution = .fillEqually
      for product in products[start..<min(start + 2, products.count)] { row.addArrangedSubview(makeCard(product)) }
      if row.arrangedSubviews.count == 1 { row.addArrangedSubview(UIView()) }
      grid.addArrangedSubview(row)
    }
  }

  private func makeCard(_ product: ProductUsageModel) -> UIView {
    let card = UIView()
    card.isAccessibilityElement = true
    card.accessibilityLabel = product.isLegacy
      ? "\(product.product), \(product.name), \(product.capacity), \(product.reset)"
      : ([product.product, product.name, product.status, product.session.map { "5 hour, \($0)" }, product.weekly.map { "Week, \($0)" }].compactMap { $0 }).joined(separator: ", ")
    if !product.isLegacy { return makeUsageCard(product, card: card) }
    let identity = UILabel()
    let text = NSMutableAttributedString(string: product.product, attributes: [.font: UIFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: UIColor.label.withAlphaComponent(0.72)])
    if !product.name.isEmpty && product.name.lowercased() != product.product.lowercased() {
      text.append(NSAttributedString(string: " · " + product.name, attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: UIColor.label.withAlphaComponent(0.72)]))
    }
    identity.attributedText = text
    identity.lineBreakMode = .byTruncatingMiddle
    let capacity = UILabel()
    capacity.text = product.capacity
    capacity.font = .monospacedDigitSystemFont(ofSize: 12, weight: .medium)
    capacity.setContentCompressionResistancePriority(.required, for: .horizontal)
    capacity.textColor = product.remaining == nil ? UIColor.label.withAlphaComponent(0.72) : .label
    let progress = UIProgressView(progressViewStyle: .bar)
    progress.progress = Float((product.remaining ?? 0) / 100)
    progress.progressTintColor = ((product.remaining ?? 100) < 20 ? UIColor.systemOrange : UIColor.label.withAlphaComponent(0.5))
    progress.trackTintColor = .tertiarySystemFill
    progress.layer.cornerRadius = 2
    progress.clipsToBounds = true
    let reset = UILabel()
    reset.text = product.remaining == nil ? "" : product.stale ? "Last known" : product.reset.replacingOccurrences(of: "Resets in ", with: "Reset ")
    reset.font = .systemFont(ofSize: 12)
    reset.textColor = UIColor.label.withAlphaComponent(0.72)
    let titleRow = UIStackView(arrangedSubviews: [capacity, reset])
    titleRow.spacing = 6
    titleRow.alignment = .firstBaseline
    let content = UIStackView(arrangedSubviews: [identity, titleRow, progress])
    content.axis = .vertical
    content.spacing = 1
    content.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(content)
    NSLayoutConstraint.activate([
      card.heightAnchor.constraint(equalToConstant: 36),
      content.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      content.topAnchor.constraint(equalTo: card.topAnchor, constant: 1),
      content.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -1),
      progress.heightAnchor.constraint(equalToConstant: 2),
    ])
    return card
  }
}

extension ProductUsageFooterView {
  fileprivate func makeUsageCard(_ product: ProductUsageModel, card: UIView) -> UIView {
    let secondary = UIColor.label.withAlphaComponent(0.72)
    let identity = UILabel()
    let text = NSMutableAttributedString(string: product.product, attributes: [.font: UIFont.systemFont(ofSize: 12, weight: .medium), .foregroundColor: secondary])
    if !product.name.isEmpty && product.name.lowercased() != product.product.lowercased() {
      text.append(NSAttributedString(string: " · " + product.name, attributes: [.font: UIFont.systemFont(ofSize: 12), .foregroundColor: secondary]))
    }
    identity.attributedText = text
    identity.lineBreakMode = .byTruncatingMiddle
    let content = UIStackView(arrangedSubviews: [identity])
    content.axis = .vertical
    content.spacing = 2
    let suffix = product.stale ? " · last known" : ""
    if let status = product.status {
      let label = UILabel()
      label.text = status + suffix
      label.font = .systemFont(ofSize: 12)
      label.lineBreakMode = .byTruncatingTail
      label.textColor = status.lowercased().contains("sign-in expired") ? .systemOrange : secondary
      content.addArrangedSubview(label)
    } else {
      for (caption, value, remaining) in [("5h", product.session, product.sessionRemaining), ("Week", product.weekly, product.weeklyRemaining)] {
        guard let value else { continue }
        let cap = UILabel()
        cap.text = caption
        cap.font = .systemFont(ofSize: 12, weight: .medium)
        cap.textColor = secondary
        cap.setContentHuggingPriority(.required, for: .horizontal)
        cap.setContentCompressionResistancePriority(.required, for: .horizontal)
        let val = UILabel()
        val.text = value + suffix
        val.font = .monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        val.textColor = .label
        val.textAlignment = .right
        val.lineBreakMode = .byTruncatingTail
        let line = UIStackView(arrangedSubviews: [cap, val])
        line.spacing = 6
        line.alignment = .firstBaseline
        let progress = UIProgressView(progressViewStyle: .bar)
        let used = max(0, min(100, 100 - (remaining ?? 100)))
        progress.progress = Float(used / 100)
        progress.progressTintColor = (remaining ?? 100) < 20 ? UIColor.systemOrange : UIColor.label.withAlphaComponent(0.5)
        progress.trackTintColor = .tertiarySystemFill
        progress.layer.cornerRadius = 2
        progress.clipsToBounds = true
        progress.heightAnchor.constraint(equalToConstant: 2).isActive = true
        let group = UIStackView(arrangedSubviews: [line, progress])
        group.axis = .vertical
        group.spacing = 1
        content.addArrangedSubview(group)
      }
    }
    content.translatesAutoresizingMaskIntoConstraints = false
    card.addSubview(content)
    NSLayoutConstraint.activate([
      card.heightAnchor.constraint(equalToConstant: product.cardHeight),
      content.leadingAnchor.constraint(equalTo: card.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: card.trailingAnchor),
      content.topAnchor.constraint(equalTo: card.topAnchor, constant: 1),
    ])
    return card
  }
}

struct ThreadsModel: Decodable {
  var productUsage: [ProductUsageModel]?

  let groups: [ThreadGroupModel]
  var canReorderProjects: Bool = false
  var selectedId: String = ""
  /// "projects" or "recent"; JS owns this preference and the Recent list (computed by `selectRecentThreads`).
  var view: String = "projects"
  var recent: RecentModel = RecentModel()
  /// Always-visible "Recent" section at the bottom of the Projects view (5, +10).
  var recentSection: RecentModel = RecentModel()
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
  case recent(String)
  case recentMore
  case recentLess
  case recentEmpty
  case sectionHeader
}

// MARK: Drawer

/// Native thread list: header (title, connection, dashboard), search + filter menu, per-project sections.
final class ThreadDrawerViewController: UIViewController, UICollectionViewDelegate, UICollectionViewDragDelegate, UICollectionViewDropDelegate, UITextFieldDelegate {
  var onDashboard: (() -> Void)?
  var onSettings: (() -> Void)?
  var onSelectThread: ((String) -> Void)?
  var onSearch: ((String) -> Void)?
  var onSetFilter: ((String, String, String?) -> Void)?
  var onNewThread: ((String) -> Void)?
  var onMoveProject: ((String, String, Bool) -> Void)?
  var onShowOlder: ((String) -> Void)?
  var onShowLess: ((String) -> Void)?
  var onSetView: ((String) -> Void)?
  var onRecentPage: ((String, Bool) -> Void)?

  private var collapsedProjects = Set<String>()
  private var model: ThreadsModel?
  private var rows: [String: ThreadRowModel] = [:]
  private var groups: [String: ThreadGroupModel] = [:]
  private var recentRows: [String: ThreadRowModel] = [:]
  /// Set when the user changes the view, until JS echoes the same view back, so a stale model cannot flip it again.
  private var pendingView: String?
  private var currentView: String { pendingView ?? model?.view ?? "projects" }

  private var collectionView: UICollectionView!
  private var dataSource: UICollectionViewDiffableDataSource<String, DrawerItem>!
  private let usageFooter = ProductUsageFooterView()
  private let searchField = UISearchTextField()
  private let filterButton = UIButton(type: .system)
  private let connectionIcon = UIImageView(image: UIImage(systemName: "desktopcomputer"))
  private var searchDebounce: DispatchWorkItem?
  private let emptySection = "__empty__"
  private let recentSection = "__recent__"

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground
    let header = makeHeader()
    header.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(header)

    var layout = UICollectionLayoutListConfiguration(appearance: .sidebar)
    layout.showsSeparators = false
    layout.backgroundColor = .clear
    let fullWidthLayout = UICollectionViewCompositionalLayout { _, environment in
      let section = NSCollectionLayoutSection.list(using: layout, layoutEnvironment: environment)
      section.contentInsets.leading = 0
      section.contentInsets.trailing = 0
      return section
    }
    collectionView = UICollectionView(frame: .zero, collectionViewLayout: fullWidthLayout)
    collectionView.translatesAutoresizingMaskIntoConstraints = false
    collectionView.backgroundColor = .clear
    collectionView.delegate = self
    collectionView.dragDelegate = self
    collectionView.dropDelegate = self
    collectionView.dragInteractionEnabled = true
    collectionView.keyboardDismissMode = .onDrag
    collectionView.allowsSelection = true
    collectionView.accessibilityIdentifier = "thread-drawer-list"
    view.addSubview(collectionView)
    configureDataSource()
    usageFooter.translatesAutoresizingMaskIntoConstraints = false
    usageFooter.accessibilityIdentifier = "product-usage-footer"
    view.addSubview(usageFooter)
    usageFooter.onDetails = { [weak self] in
      guard let self = self else { return }
      let details = (self.model?.productUsage ?? []).map { $0.details }.joined(separator: "\n\n────────\n\n")
      let alert = UIAlertController(title: "Product usage", message: details, preferredStyle: .alert)
      alert.addAction(UIAlertAction(title: "Done", style: .cancel))
      self.present(alert, animated: true)
    }


    NSLayoutConstraint.activate([
      header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
      header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
      collectionView.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 6),
      collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      collectionView.bottomAnchor.constraint(equalTo: usageFooter.topAnchor, constant: 0),
      usageFooter.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
      usageFooter.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
      usageFooter.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
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
      fab.bottomAnchor.constraint(equalTo: usageFooter.topAnchor, constant: -16),
    ])
    collectionView.contentInset.bottom = 56 + 16
    collectionView.verticalScrollIndicatorInsets.bottom = 56 + 16
  }

  // MARK: Header

  private func makeHeader() -> UIView {
    let title = UILabel()
    title.text = "Freddai"
    title.font = UIFont.preferredFont(forTextStyle: .title2).bold()
    title.adjustsFontForContentSizeCategory = true
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
    filterButton.tintColor = .secondaryLabel
    filterButton.widthAnchor.constraint(equalToConstant: 40).isActive = true
    filterButton.heightAnchor.constraint(equalToConstant: 40).isActive = true
    filterButton.setPreferredSymbolConfiguration(UIImage.SymbolConfiguration(pointSize: 22, weight: .regular), forImageIn: .normal)

    let searchRow = UIStackView(arrangedSubviews: [searchField, filterButton])
    searchRow.axis = .horizontal
    searchRow.alignment = .center
    searchRow.spacing = 6

    var dashboardConfig = UIButton.Configuration.plain()
        dashboardConfig.image = UIImage(systemName: "square.grid.2x2")
    dashboardConfig.baseForegroundColor = .secondaryLabel
    dashboardConfig.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
    let dashboard = UIButton(configuration: dashboardConfig)
    dashboard.accessibilityLabel = "Dashboard"
    dashboard.widthAnchor.constraint(equalToConstant: 44).isActive = true
    dashboard.heightAnchor.constraint(equalToConstant: 44).isActive = true
    titleRow.addArrangedSubview(dashboard)
    dashboard.accessibilityIdentifier = "companion-dashboard"
    dashboard.addAction(UIAction { [weak self] _ in self?.onDashboard?() }, for: .touchUpInside)
    var settingsConfig = UIButton.Configuration.plain()
    settingsConfig.image = UIImage(systemName: "gearshape")
    settingsConfig.baseForegroundColor = .secondaryLabel
    settingsConfig.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 19, weight: .regular)
    settingsConfig.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 0, bottom: 10, trailing: 0)
    let settings = UIButton(configuration: settingsConfig)
    settings.accessibilityLabel = "Settings"
    settings.widthAnchor.constraint(equalToConstant: 44).isActive = true
    settings.accessibilityIdentifier = "companion-settings"
    settings.accessibilityHint = "Organize projects and workspaces"
    settings.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    settings.addAction(UIAction { [weak self] _ in self?.onSettings?() }, for: .touchUpInside)
    titleRow.insertArrangedSubview(settings, at: titleRow.arrangedSubviews.count - 1)
    var addConfig = UIButton.Configuration.plain()
    addConfig.title = "Project"
    addConfig.image = UIImage(systemName: "folder.badge.plus")
    addConfig.imagePadding = 8
    let addProject = UIButton(configuration: addConfig)
    addProject.accessibilityLabel = "Add project"
    addProject.accessibilityIdentifier = "companion-add-project"
    addProject.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    addProject.addAction(UIAction { [weak self] _ in self?.onNewThread?("freddai:add-project") }, for: .touchUpInside)
    let column = UIStackView(arrangedSubviews: [titleRow, addProject, searchRow])
    column.axis = .vertical
    column.spacing = 10
    return column
  }

  private func setView(_ view: String) {
    guard currentView != view else { return }
    pendingView = view
    onSetView?(view)
    if let model = model { apply(model) }
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
    let views = [("Projects", "projects"), ("Recent", "recent")].map { title, value in
      UIAction(title: title, state: value == currentView ? .on : .off) { [weak self] _ in
        self?.setView(value)
      }
    }
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
    var menus: [UIMenuElement] = [UIMenu(title: "Thread view", options: .displayInline, children: views)]
    if workspaces.count > 1 { menus.append(UIMenu(title: "Workspace", options: .displayInline, children: workspaces)) }
    filterButton.menu = UIMenu(children: menus + [
      UIMenu(title: "Project", options: .displayInline, children: projects),
      UIMenu(title: "Status", options: .displayInline, children: statuses),
    ])
    let active = !(model.filters.workspace ?? "").isEmpty || !model.filters.project.isEmpty || model.filters.status != "all"
    filterButton.setImage(UIImage(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle"), for: .normal)
    filterButton.tintColor = active ? .tintColor : .secondaryLabel
    filterButton.accessibilityValue = (currentView == "recent" ? "Recent" : "Projects") + (active ? ", filters on" : "")
  }

  // Only project headers initiate a local drag. Dropping moves the entire group through JS.
  func collectionView(_ collectionView: UICollectionView, itemsForBeginning session: UIDragSession, at indexPath: IndexPath) -> [UIDragItem] {
    guard model?.canReorderProjects == true, currentView == "projects",
          case .header(let project) = dataSource.itemIdentifier(for: indexPath), !project.isEmpty else { return [] }
    let item = UIDragItem(itemProvider: NSItemProvider(object: (groups[project]?.label ?? project) as NSString))
    item.localObject = project
    return [item]
  }

  func collectionView(_ collectionView: UICollectionView, dropSessionDidUpdate session: UIDropSession, withDestinationIndexPath destinationIndexPath: IndexPath?) -> UICollectionViewDropProposal {
    guard model?.canReorderProjects == true, currentView == "projects", session.localDragSession != nil,
          session.items.count == 1, let project = session.items.first?.localObject as? String,
          let destination = destinationIndexPath, destination.section < dataSource.snapshot().sectionIdentifiers.count,
          groups[project] != nil else { return UICollectionViewDropProposal(operation: .forbidden) }
    let target = dataSource.snapshot().sectionIdentifiers[destination.section]
    return UICollectionViewDropProposal(operation: target != project && groups[target] != nil ? .move : .forbidden, intent: .unspecified)
  }

  func collectionView(_ collectionView: UICollectionView, performDropWith coordinator: UICollectionViewDropCoordinator) {
    guard model?.canReorderProjects == true, currentView == "projects",
          let project = coordinator.items.first?.dragItem.localObject as? String,
          let destination = coordinator.destinationIndexPath,
          destination.section < dataSource.snapshot().sectionIdentifiers.count else { return }
    let target = dataSource.snapshot().sectionIdentifiers[destination.section]
    guard target != project, groups[target] != nil, groups[project] != nil else { return }
    let frame = collectionView.layoutAttributesForItem(at: destination)?.frame ?? .zero
    let after = destination.item > 0 || coordinator.session.location(in: collectionView).y > frame.midY
    onMoveProject?(project, target, after)
  }

  // MARK: Data source

  private func configureDataSource() {
    let headerReg = UICollectionView.CellRegistration<ProjectHeaderCell, String> { [weak self] cell, _, project in
      guard let self = self, let group = self.groups[project] else { return }
      cell.accessibilityIdentifier = "project-header-\(project)"
      cell.accessibilityHint = self.model?.canReorderProjects == true ? "Double tap to toggle threads. Touch and hold to drag this project." : "Double tap to toggle threads"
      cell.configure(group: group, collapsed: self.collapsedProjects.contains(project)) { [weak self] in self?.onNewThread?(project) }
    }
    let threadReg = UICollectionView.CellRegistration<ThreadCell, String> { [weak self] cell, _, id in
      if let row = self?.rows[id] { cell.configure(row) }
    }
    let olderReg = UICollectionView.CellRegistration<OlderRowCell, String> { [weak self] cell, _, project in
      let group = self?.groups[project]
      cell.configure(
        moreText: (group?.olderRemaining ?? 0) > 0 ? (group?.olderLabel ?? "Show older threads") : nil,
        showLess: group?.olderExpanded ?? false,
        onMore: { [weak self] in self?.onShowOlder?(project) },
        onLess: { [weak self] in self?.onShowLess?(project) })
    }
    let recentReg = UICollectionView.CellRegistration<ThreadCell, String> { [weak self] cell, _, id in
      if let row = self?.recentRows[id] { cell.configure(row, showProject: true) }
    }
    let moreReg = UICollectionView.CellRegistration<TextRowCell, String> { cell, _, _ in
      cell.configure(text: "Show more", color: .tintColor, centered: false, button: true)
    }
    let lessReg = UICollectionView.CellRegistration<TextRowCell, String> { cell, _, _ in
      cell.configure(text: "Show less", color: .tintColor, centered: false, button: true)
    }
    let recentEmptyReg = UICollectionView.CellRegistration<TextRowCell, String> { cell, _, _ in
      cell.configure(text: "No recent threads", color: .secondaryLabel, centered: true, button: false)
    }
    let sectionHeaderReg = UICollectionView.CellRegistration<SectionTitleCell, String> { cell, _, _ in cell.configure(text: "Recent") }
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
      case .recent(let id): return cv.dequeueConfiguredReusableCell(using: recentReg, for: indexPath, item: id)
      case .recentMore: return cv.dequeueConfiguredReusableCell(using: moreReg, for: indexPath, item: "")
      case .recentLess: return cv.dequeueConfiguredReusableCell(using: lessReg, for: indexPath, item: "")
      case .sectionHeader: return cv.dequeueConfiguredReusableCell(using: sectionHeaderReg, for: indexPath, item: "")
      case .recentEmpty: return cv.dequeueConfiguredReusableCell(using: recentEmptyReg, for: indexPath, item: "")
      }
    }
  }

  /// Applies a new model with a diff keyed by thread id, so updates do not reload the list or reset its scroll offset.
  func apply(_ new: ThreadsModel) {
    let previousRows = rows, previousGroups = groups, previousRecent = recentRows
    model = new
    rows = Dictionary(new.groups.flatMap { $0.threads }.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    groups = Dictionary(new.groups.map { ($0.project, $0) }, uniquingKeysWith: { a, _ in a })
    if pendingView == new.view { pendingView = nil }
    let recentMode = currentView == "recent"
    // Recent rows come from the Recent view, or from the bottom section of the Projects view; never both at once.
    let recentSource = recentMode ? new.recent : new.recentSection
    recentRows = Dictionary(recentSource.threads.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    guard isViewLoaded, dataSource != nil else { return }

    usageFooter.update(new.productUsage ?? [])
    var snapshot = NSDiffableDataSourceSnapshot<String, DrawerItem>()
    var seen = Set<DrawerItem>()
    var sections = Set<String>()
    for group in new.groups where !recentMode && sections.insert(group.project).inserted {
      snapshot.appendSections([group.project])
      var items: [DrawerItem] = [.header(group.project)]
      if !collapsedProjects.contains(group.project) {
        items += group.threads.map { .thread($0.id) }
        if group.olderRemaining > 0 || group.olderExpanded { items.append(.older(group.project)) }
      }
      snapshot.appendItems(items.filter { seen.insert($0).inserted }, toSection: group.project)
    }
    if recentMode {
      snapshot.appendSections([recentSection])
      var items: [DrawerItem] = new.recent.threads.map { .recent($0.id) }
      if items.isEmpty { items = [.recentEmpty] }
      if new.recent.remaining > 0 { items.append(.recentMore) }
      if new.recent.expanded { items.append(.recentLess) }
      snapshot.appendItems(items.filter { seen.insert($0).inserted }, toSection: recentSection)
    } else if !new.recentSection.threads.isEmpty {
      if new.groups.allSatisfy({ $0.threads.isEmpty }) { snapshot.appendSections([emptySection]); snapshot.appendItems([.empty], toSection: emptySection) }
      snapshot.appendSections([recentSection])
      var items: [DrawerItem] = [.sectionHeader] + new.recentSection.threads.map { .recent($0.id) }
      if new.recentSection.remaining > 0 { items.append(.recentMore) }
      if new.recentSection.expanded { items.append(.recentLess) }
      snapshot.appendItems(items.filter { seen.insert($0).inserted }, toSection: recentSection)
    } else if new.groups.allSatisfy({ $0.threads.isEmpty }) {
      snapshot.appendSections([emptySection])
      snapshot.appendItems([.empty], toSection: emptySection)
    }
    var changed: [DrawerItem] = []
    for item in snapshot.itemIdentifiers {
      switch item {
      case .thread(let id): if previousRows[id] != rows[id] { changed.append(item) }
      case .header(let p):
        changed.append(item)
      case .older(let p): if previousGroups[p]?.olderLabel != groups[p]?.olderLabel || previousGroups[p]?.olderExpanded != groups[p]?.olderExpanded || previousGroups[p]?.olderRemaining != groups[p]?.olderRemaining { changed.append(item) }
      case .empty: changed.append(item)
      case .recent(let id): if previousRecent[id] != recentRows[id] { changed.append(item) }
      case .recentMore, .recentLess, .recentEmpty, .sectionHeader: break
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
    let threads = snapshot.itemIdentifiers.filter { if case .thread = $0 { return true } else if case .recent = $0 { return true } else { return false } }
    guard !threads.isEmpty else { return }
    snapshot.reconfigureItems(threads)
    dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in self?.syncSelection() }
  }

  private func syncSelection() {
    let item: DrawerItem = currentView == "recent" ? .recent(model?.selectedId ?? "") : .thread(model?.selectedId ?? "")
    guard let selected = model?.selectedId, !selected.isEmpty, let path = dataSource.indexPath(for: item) else {
      collectionView.indexPathsForSelectedItems?.forEach { collectionView.deselectItem(at: $0, animated: false) }
      return
    }
    if collectionView.indexPathsForSelectedItems != [path] { collectionView.selectItem(at: path, animated: false, scrollPosition: []) }
  }

  // MARK: UICollectionViewDelegate

  func collectionView(_ collectionView: UICollectionView, shouldSelectItemAt indexPath: IndexPath) -> Bool {
    switch dataSource.itemIdentifier(for: indexPath) {
    case .header, .thread, .recent, .recentMore, .recentLess: return true
    default: return false
    }
  }

  func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
    switch dataSource.itemIdentifier(for: indexPath) {
    case .header(let project):
      collectionView.deselectItem(at: indexPath, animated: false)
      if groups[project]?.kind == "commander" { onSelectThread?("commander:open"); return }
      if !collapsedProjects.insert(project).inserted { collapsedProjects.remove(project) }
      if let model = model { apply(model) }
    case .thread(let id), .recent(let id): onSelectThread?(id)
    case .recentMore:
      collectionView.deselectItem(at: indexPath, animated: true)
      syncSelection()
      onRecentPage?("more", currentView != "recent")
    case .recentLess:
      collectionView.deselectItem(at: indexPath, animated: true)
      syncSelection()
      onRecentPage?("less", currentView != "recent")
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
    // The title yields before navigation controls, including during self-sizing.
    label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    chevron.contentMode = .scaleAspectFit
    for (view, width) in [(chevron, CGFloat(14)), (icon, CGFloat(18))] {
      let slot = view.widthAnchor.constraint(equalToConstant: width)
      // UIStackView adds a required zero width when Commander hides the chevron.
      slot.priority = UILayoutPriority(999)
      slot.isActive = true
      view.setContentCompressionResistancePriority(.required, for: .horizontal)
    }
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
      stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -22),
    ])
    var background = UIBackgroundConfiguration.clear()
    background.backgroundColor = .clear
    backgroundConfiguration = background
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func preferredLayoutAttributesFitting(_ layoutAttributes: UICollectionViewLayoutAttributes) -> UICollectionViewLayoutAttributes {
    let attributes = layoutAttributes.copy() as! UICollectionViewLayoutAttributes
    // List rows self-size vertically; intrinsic project names must not widen them.
    let size = contentView.systemLayoutSizeFitting(
      CGSize(width: layoutAttributes.size.width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required,
      verticalFittingPriority: .fittingSizeLevel)
    attributes.size = CGSize(width: layoutAttributes.size.width, height: ceil(size.height))
    return attributes
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    icon.layer.cornerRadius = icon.clipsToBounds ? min(icon.bounds.width, icon.bounds.height) / 2 : 0
  }

  func configure(group: ThreadGroupModel, collapsed: Bool, onAdd: @escaping () -> Void) {
    self.onAdd = onAdd
    let commander = group.kind == "commander"
    icon.backgroundColor = commander ? UIColor(red: 234.0 / 255, green: 229.0 / 255, blue: 215.0 / 255, alpha: 1) : .clear
    icon.clipsToBounds = commander
    icon.layer.cornerRadius = commander ? min(icon.bounds.width, icon.bounds.height) / 2 : 0
    chevron.isHidden = commander
    addButton.isHidden = commander
    if commander {
      icon.image = MascotImage.smallImage
      icon.preferredSymbolConfiguration = nil
      icon.tintColor = nil
      icon.accessibilityIdentifier = "drawer-commander-icon"
      accessibilityLabel = group.label
      accessibilityHint = "Opens Commander"
      accessibilityTraits = [.button, .header]
      label.text = group.label
      label.font = UIFont.preferredFont(forTextStyle: .headline)
      label.textColor = .label
      return
    }
    icon.image = UIImage(systemName: "folder.fill")
    icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
    label.font = UIFont.preferredFont(forTextStyle: .subheadline).bold()
    chevron.image = UIImage(systemName: collapsed ? "chevron.right" : "chevron.down")
    chevron.tintColor = .secondaryLabel
    chevron.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 11, weight: .semibold)
    accessibilityLabel = group.label
    accessibilityValue = collapsed ? "Collapsed" : "Expanded"
    accessibilityTraits = [.button, .header]
    label.text = group.label
    let projectColor = color(fromHex: group.color) ?? .secondaryLabel
    icon.tintColor = projectColor
    label.textColor = .secondaryLabel
    addButton.tintColor = .secondaryLabel
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
    pulsing = status == "running" || status == "starting" || status == "sending"
    switch status {
    case "running", "starting": dotColor = StatusIndicatorView.pulseColor; spoken = status == "running" ? "Running" : "Starting"
    case "sending": dotColor = StatusIndicatorView.pulseColor; spoken = "Sending"
    case "queued": dotColor = .tertiaryLabel; spoken = "Queued"
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
  private let scheduleIcon = UIImageView(image: UIImage(systemName: "calendar.badge.clock"))
  private var scheduleWidth: NSLayoutConstraint!
  private let pinIcon = UIImageView(image: UIImage(systemName: "pin.fill"))
  private var pinWidth: NSLayoutConstraint!
  private let titleLabel = UILabel()
  private let projectLabel = UILabel()
  private var pointerInside = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    projectLabel.font = .preferredFont(forTextStyle: .caption1)
    projectLabel.adjustsFontForContentSizeCategory = true
    projectLabel.numberOfLines = 1
    projectLabel.lineBreakMode = .byTruncatingTail
    projectLabel.isHidden = true
    let textStack = UIStackView(arrangedSubviews: [titleLabel, projectLabel])
    textStack.axis = .vertical
    textStack.spacing = 1
    textStack.translatesAutoresizingMaskIntoConstraints = false
    titleLabel.numberOfLines = 1
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.font = .preferredFont(forTextStyle: .body)
    titleLabel.adjustsFontForContentSizeCategory = true
    titleLabel.translatesAutoresizingMaskIntoConstraints = false
    indicator.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(indicator)
    contentView.addSubview(textStack)
    scheduleIcon.tintColor = .secondaryLabel
    scheduleIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 14)
    scheduleIcon.contentMode = .scaleAspectFit
    scheduleIcon.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(scheduleIcon)
    scheduleWidth = scheduleIcon.widthAnchor.constraint(equalToConstant: 0)
    pinIcon.tintColor = .secondaryLabel
    pinIcon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 14)
    pinIcon.contentMode = .scaleAspectFit
    pinIcon.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(pinIcon)
    pinWidth = pinIcon.widthAnchor.constraint(equalToConstant: 0)
    // Titles are a single truncated line, so the indicator slot is simply centred on the title.
    NSLayoutConstraint.activate([
      indicator.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 20),
      indicator.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
      indicator.heightAnchor.constraint(equalToConstant: 20),
      textStack.leadingAnchor.constraint(equalTo: indicator.trailingAnchor, constant: 6),
      textStack.trailingAnchor.constraint(equalTo: pinIcon.leadingAnchor, constant: -6),
      pinIcon.trailingAnchor.constraint(equalTo: scheduleIcon.leadingAnchor),
      pinIcon.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
      pinIcon.heightAnchor.constraint(equalToConstant: 20),
      pinWidth,
      scheduleIcon.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -28),
      scheduleIcon.centerYAnchor.constraint(equalTo: titleLabel.centerYAnchor),
      scheduleIcon.heightAnchor.constraint(equalToConstant: 20),
      scheduleWidth,
      textStack.centerYAnchor.constraint(equalTo: contentView.centerYAnchor),
      textStack.topAnchor.constraint(greaterThanOrEqualTo: contentView.topAnchor, constant: 9),
      textStack.bottomAnchor.constraint(lessThanOrEqualTo: contentView.bottomAnchor, constant: -9),
      contentView.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
    isAccessibilityElement = true
    addGestureRecognizer(UIHoverGestureRecognizer(target: self, action: #selector(pointerChanged(_:))))
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  @objc private func pointerChanged(_ gesture: UIHoverGestureRecognizer) {
    pointerInside = gesture.state == .began || gesture.state == .changed
    setNeedsUpdateConfiguration()
  }

  override func prepareForReuse() {
    super.prepareForReuse()
    pointerInside = false
  }

  override func updateConfiguration(using state: UICellConfigurationState) {
    // Selection and pointer hover fill the drawer width; text keeps its inset.
    var background = UIBackgroundConfiguration.clear()
    if state.isSelected || state.isHighlighted || pointerInside {
      background.backgroundColor = state.isSelected ? .tertiarySystemFill : .quaternarySystemFill
      background.cornerRadius = 0
    }
    background.backgroundInsets = NSDirectionalEdgeInsets.zero
    backgroundConfiguration = background
  }

  func configure(_ row: ThreadRowModel, showProject: Bool = false) {
    scheduleIcon.isHidden = row.scheduled != true
    scheduleWidth.constant = row.scheduled == true ? 20 : 0
    let project = showProject ? (row.projectLabel ?? "") : ""
    projectLabel.text = project
    projectLabel.textColor = color(fromHex: row.projectColor ?? "") ?? .secondaryLabel
    projectLabel.isHidden = project.isEmpty
    contentView.alpha = row.faded == true ? 0.65 : 1
    pinIcon.isHidden = row.pinned != true
    pinWidth.constant = row.pinned == true ? 20 : 0
    titleLabel.text = row.title
    let body = UIFont.preferredFont(forTextStyle: .body)
    let font = row.unread ? body.bold() : body
    titleLabel.font = font
    let spoken = indicator.configure(status: row.status, unread: row.unread)
    accessibilityLabel = (row.pinned == true ? "Pinned, " : "") + row.title + (project.isEmpty ? "" : ", \(project)")
    accessibilityValue = [spoken, row.scheduled == true ? "Scheduled task" : ""].filter { !$0.isEmpty }.joined(separator: ", ")
    accessibilityTraits = .button
  }
}

final class SectionTitleCell: UICollectionViewListCell {
  private let icon = UIImageView(image: UIImage(systemName: "clock.fill"))
  private let label = UILabel()

  override init(frame: CGRect) {
    super.init(frame: frame)
    icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 13, weight: .medium)
    icon.tintColor = .secondaryLabel
    label.font = UIFont.preferredFont(forTextStyle: .subheadline).bold()
    label.adjustsFontForContentSizeCategory = true
    label.textColor = .secondaryLabel
    label.accessibilityTraits = .header
    let stack = UIStackView(arrangedSubviews: [icon, label, UIView()])
    stack.axis = .horizontal
    stack.alignment = .center
    stack.spacing = 8
    stack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 14),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -2),
      stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 8),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
    ])
    var background = UIBackgroundConfiguration.clear()
    background.backgroundColor = .clear
    backgroundConfiguration = background
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func configure(text: String) {
    label.text = text
    isAccessibilityElement = true
    accessibilityLabel = text
    accessibilityTraits = .header
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

/// "Show more (N)" and "Show less" share one row, styled like the other text-link rows; either button is omitted when it does not apply.
final class OlderRowCell: UICollectionViewListCell {
  private let more = UIButton(type: .system)
  private let less = UIButton(type: .system)
  private var onMore: (() -> Void)?
  private var onLess: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    for (button, action) in [(more, #selector(tapMore)), (less, #selector(tapLess))] {
      button.titleLabel?.font = .preferredFont(forTextStyle: .subheadline)
      button.titleLabel?.adjustsFontForContentSizeCategory = true
      button.contentHorizontalAlignment = .leading
      button.addTarget(self, action: action, for: .touchUpInside)
    }
    let stack = UIStackView(arrangedSubviews: [more, less, UIView()])
    stack.axis = .horizontal
    stack.spacing = 16
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    contentView.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: contentView.topAnchor),
      stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 30),
      stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -8),
      more.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
      less.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
    ])
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  func configure(moreText: String?, showLess: Bool, onMore: @escaping () -> Void, onLess: @escaping () -> Void) {
    self.onMore = onMore
    self.onLess = onLess
    more.isHidden = moreText == nil
    more.setTitle(moreText, for: .normal)
    more.accessibilityLabel = moreText
    more.accessibilityIdentifier = "older-more"
    less.isHidden = !showLess
    less.setTitle("Show less", for: .normal)
    less.accessibilityLabel = "Show less"
    less.accessibilityIdentifier = "older-less"
  }

  @objc private func tapMore() { onMore?() }
  @objc private func tapLess() { onLess?() }
}
