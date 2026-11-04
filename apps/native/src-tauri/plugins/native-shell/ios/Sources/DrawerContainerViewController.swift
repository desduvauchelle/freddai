import UIKit

/// Drawer surface that closes on the VoiceOver escape gesture.
final class DrawerSurfaceView: UIView {
  var onEscape: (() -> Void)?
  override func accessibilityPerformEscape() -> Bool { onEscape?(); return onEscape != nil }
}

/// Shared iPhone/iPad shell. Wide iPad landscape windows show the same drawer beside the content.
/// Otherwise, the drawer sits underneath; the content (navigation controller + web view) slides right
/// following the finger. `progress` is 0 (content in place) ... 1 (content 90% of the width to the right,
/// leaving a dimmed 10% sliver of the thread). The drawer gets a parallax from -30% of its width to 0.
final class DrawerContainerViewController: UIViewController, UIGestureRecognizerDelegate {
  let content: UIViewController
  let drawer: UIViewController
  private let dimView = UIView()
  private let drawerSurface = DrawerSurfaceView()
  private let widthFraction: CGFloat = 0.9
  private let maxDim: CGFloat = 0.15
  private let parallax: CGFloat = 0.3

  private(set) var progress: CGFloat = 0
  private var animator: UIViewPropertyAnimator?
  private var gestureStartProgress: CGFloat = 0
  private let haptic = UIImpactFeedbackGenerator(style: .light)
  private var edgePan: UIScreenEdgePanGestureRecognizer!
  private var closePan: UIPanGestureRecognizer!
  private(set) var usesSidebar = false

  /// Gestures and the drawer only work in conversation / new-thread modes.
  var drawerEnabled = false {
    didSet {
      guard drawerEnabled != oldValue, isViewLoaded else { return }
      updatePresentation()
      if !drawerEnabled { setOpen(false, animated: false) }
    }
  }
  var isOpen: Bool { progress > 0.5 }
  var onOpenChange: ((Bool) -> Void)?
  var onPresentationChange: ((Bool, Bool) -> Void)?

  private var drawerWidth: CGFloat {
    let overlayWidth = max(1, (view.bounds.width * widthFraction).rounded())
    return usesSidebar ? 320 : traitCollection.userInterfaceIdiom == .pad ? min(400, overlayWidth) : overlayWidth
  }

  init(content: UIViewController, drawer: UIViewController) {
    self.content = content
    self.drawer = drawer
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .systemBackground

    drawerSurface.backgroundColor = .systemBackground
    drawerSurface.accessibilityIdentifier = "thread-list-surface"
    drawerSurface.accessibilityViewIsModal = false
    drawerSurface.onEscape = { [weak self] in self?.setOpen(false, animated: true) }
    drawerSurface.isHidden = true
    view.addSubview(drawerSurface)
    addChild(drawer)
    drawer.view.frame = drawerSurface.bounds
    drawer.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    drawerSurface.addSubview(drawer.view)
    drawer.didMove(toParent: self)

    addChild(content)
    content.view.frame = view.bounds
    content.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    // Soft shadow on the content's left edge, cast onto the drawer beneath.
    content.view.layer.shadowColor = UIColor.black.cgColor
    content.view.layer.shadowOpacity = 0.25
    content.view.layer.shadowRadius = 12
    content.view.layer.shadowOffset = CGSize(width: -3, height: 0)
    view.addSubview(content.view)
    content.didMove(toParent: self)

    dimView.backgroundColor = .black
    dimView.alpha = 0
    dimView.isUserInteractionEnabled = false
    dimView.frame = view.bounds
    dimView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    dimView.accessibilityLabel = "Close thread list"
    dimView.accessibilityTraits = .button
    dimView.isAccessibilityElement = false
    view.addSubview(dimView)
    dimView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(dimTapped)))

    edgePan = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(edgePanned(_:)))
    edgePan.edges = .left
    edgePan.delegate = self
    edgePan.isEnabled = drawerEnabled
    view.addGestureRecognizer(edgePan)

    closePan = UIPanGestureRecognizer(target: self, action: #selector(closePanned(_:)))
    closePan.delegate = self
    closePan.isEnabled = drawerEnabled
    drawerSurface.addGestureRecognizer(closePan)
    // Panning the visible sliver of the thread closes too.
    let dimPan = UIPanGestureRecognizer(target: self, action: #selector(closePanned(_:)))
    dimPan.delegate = self
    dimView.addGestureRecognizer(dimPan)

    // The web view's own horizontal scrolling must wait for the edge gesture, which only fires at the very edge.
    (content as? UINavigationController)?.interactivePopGestureRecognizer?.isEnabled = false
    haptic.prepare()
    applyProgress(0)
  }

  /// The left-edge pan; scroll views (the web view) should wait for it to fail.
  var edgePanRecognizer: UIGestureRecognizer { loadViewIfNeeded(); return edgePan }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    updatePresentation()
    if animator == nil { applyProgress(progress) }
  }

  private func updatePresentation() {
    let sidebar = drawerEnabled && CompanionLayout.showsSidebar(
      size: view.bounds.size, isPad: traitCollection.userInterfaceIdiom == .pad,
      regularWidth: traitCollection.horizontalSizeClass == .regular)
    if sidebar != usesSidebar {
      interrupt()
      usesSidebar = sidebar
      // Entering landscape opens the sidebar; returning to a compact layout closes the overlay.
      applyProgress(sidebar ? 1 : 0)
      syncInteraction(open: sidebar)
      onOpenChange?(sidebar)
    }
    edgePan?.isEnabled = drawerEnabled && !usesSidebar
    closePan?.isEnabled = drawerEnabled && !usesSidebar
  }

  /// Selection keeps the landscape sidebar visible, but still dismisses its search keyboard.
  func dismissAfterSelection() {
    if !usesSidebar { setOpen(false, animated: true) }
  }

  func toggleThreadList() { setOpen(!isOpen, animated: true) }

  // MARK: Layout

  private func contentTransform(_ value: CGFloat) -> CGAffineTransform { CGAffineTransform(translationX: value * drawerWidth, y: 0) }
  private func drawerTransform(_ value: CGFloat) -> CGAffineTransform {
    CGAffineTransform(translationX: -parallax * drawerWidth * (1 - min(max(value, 0), 1)), y: 0)
  }

  private func applyProgress(_ value: CGFloat) {
    progress = value
    let w = drawerWidth, h = view.bounds.height
    // Reset transforms before changing frames (UIKit frames are undefined under a transform).
    content.view.transform = .identity
    dimView.transform = .identity
    let inset = usesSidebar && value > 0.5 ? w : 0
    content.view.frame = CGRect(x: inset, y: 0, width: view.bounds.width - inset, height: h)
    dimView.frame = view.bounds
    drawerSurface.bounds = CGRect(x: 0, y: 0, width: w, height: h)
    drawerSurface.center = CGPoint(x: w / 2, y: h / 2)
    if usesSidebar {
      drawerSurface.transform = .identity
      drawerSurface.isHidden = value <= 0.5
      dimView.alpha = 0
      content.view.layer.shadowOpacity = 0
      return
    }
    content.view.layer.shadowOpacity = 0.25
    drawerSurface.transform = drawerTransform(value)
    content.view.transform = contentTransform(value)
    dimView.transform = contentTransform(value)
    dimView.alpha = maxDim * min(max(value, 0), 1)
  }

  private func syncInteraction(open: Bool) {
    let modal = open && !usesSidebar
    dimView.isUserInteractionEnabled = modal
    drawerSurface.isHidden = !open && progress <= 0.001
    drawerSurface.accessibilityViewIsModal = modal
    content.view.accessibilityElementsHidden = modal
    onPresentationChange?(usesSidebar, open)
    UIAccessibility.post(notification: .screenChanged, argument: modal ? drawerSurface : nil)
  }

  // MARK: State changes

  /// Current on-screen progress, including mid-animation.
  private func visibleProgress() -> CGFloat {
    if animator != nil, let tx = content.view.layer.presentation()?.affineTransform().tx { return tx / drawerWidth }
    return progress
  }

  /// Stops any running settle animation exactly where it currently is (the finger "catches" it).
  private func interrupt() {
    guard let running = animator else { return }
    let current = visibleProgress()
    running.stopAnimation(false)
    running.finishAnimation(at: .current)
    animator = nil
    applyProgress(current)
  }

  func setOpen(_ open: Bool, animated: Bool, velocity: CGFloat = 0) {
    loadViewIfNeeded()
    guard drawerEnabled || !open else { return }
    if usesSidebar {
      interrupt()
      applyProgress(open ? 1 : 0)
      syncInteraction(open: open)
      onOpenChange?(open)
      return
    }
    if open { view.endEditing(true) }
    interrupt()
    let target: CGFloat = open ? 1 : 0
    if open { drawerSurface.isHidden = false }
    dimView.isUserInteractionEnabled = open || progress > 0.001
    guard animated, abs(target - progress) > 0.001 else {
      applyProgress(target)
      syncInteraction(open: open)
      onOpenChange?(open)
      return
    }
    let distance = (target - progress) * drawerWidth
    // UIKit wants the velocity as a fraction of the remaining distance per second.
    let relative = abs(distance) > 1 ? max(-30, min(30, velocity / distance)) : 0
    let timing = UISpringTimingParameters(dampingRatio: 0.9, initialVelocity: CGVector(dx: relative, dy: 0))
    let anim = Motion.reduced ? UIViewPropertyAnimator(duration: 0.2, curve: .easeInOut) : UIViewPropertyAnimator(duration: 0.5, timingParameters: timing)
    anim.addAnimations { [weak self] in
      guard let self = self else { return }
      self.content.view.transform = self.contentTransform(target)
      self.dimView.transform = self.contentTransform(target)
      self.drawerSurface.transform = self.drawerTransform(target)
      self.dimView.alpha = self.maxDim * target
    }
    anim.addCompletion { [weak self] position in
      guard let self = self, position == .end else { return }
      self.animator = nil
      self.progress = target
      self.syncInteraction(open: open)
      if open { self.haptic.impactOccurred(); self.haptic.prepare() }
      self.onOpenChange?(open)
    }
    animator = anim
    progress = target
    anim.startAnimation()
  }

  // MARK: Gestures

  @objc private func dimTapped() { setOpen(false, animated: true) }

  @objc private func edgePanned(_ g: UIScreenEdgePanGestureRecognizer) { handlePan(g) }
  @objc private func closePanned(_ g: UIPanGestureRecognizer) { handlePan(g) }

  /// Starts from wherever the drawer currently is, so grabbing it mid-animation continues from its on-screen position.
  private func handlePan(_ g: UIPanGestureRecognizer) {
    switch g.state {
    case .began:
      view.endEditing(true)
      let start = animator != nil ? visibleProgress() : progress
      interrupt()
      gestureStartProgress = start
      drawerSurface.isHidden = false
      dimView.isUserInteractionEnabled = true
      progress = gestureStartProgress
    case .changed:
      let raw = gestureStartProgress + g.translation(in: view).x / drawerWidth
      applyProgress(rubberBanded(raw))
    case .ended, .cancelled, .failed:
      let v = g.state == .ended ? g.velocity(in: view).x : 0
      let projected = progress + (v * 0.2) / drawerWidth
      let open = g.state == .cancelled || g.state == .failed ? progress > 0.5 : projected > 0.5
      setOpen(open, animated: true, velocity: v)
    default: break
    }
  }

  private func rubberBanded(_ p: CGFloat) -> CGFloat {
    if p < 0 { return 0 }
    if p > 1 { return 1 + (p - 1) * 0.1 }
    return p
  }

  // MARK: UIGestureRecognizerDelegate

  func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
    guard drawerEnabled, !usesSidebar else { return false }
    if g === edgePan { return true }
    guard let pan = g as? UIPanGestureRecognizer else { return true }
    // Only a mostly-horizontal drag grabs the open drawer; vertical drags scroll the list.
    let v = pan.velocity(in: view)
    return abs(v.x) > abs(v.y)
  }

  func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    // Let the drawer's list keep its vertical scroll while the close pan watches for a horizontal drag.
    g !== edgePan && other.view is UIScrollView
  }

  override func accessibilityPerformEscape() -> Bool {
    guard isOpen else { return false }
    setOpen(false, animated: true)
    return true
  }
}
