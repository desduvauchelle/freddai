import UIKit

/// Shared motion: a short, subtle spring (damping 0.85, 0.3s) that degrades to a quick crossfade-length ease under Reduce Motion.
enum Motion {
  static var reduced: Bool { UIAccessibility.isReduceMotionEnabled }

  static func animate(_ animations: @escaping () -> Void, completion: ((Bool) -> Void)? = nil) {
    if reduced {
      UIView.animate(withDuration: 0.15, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState], animations: animations, completion: completion)
    } else {
      UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0,
                     options: [.allowUserInteraction, .beginFromCurrentState], animations: animations, completion: completion)
    }
  }

  /// Crossfades a view's content change (text, image, tint). No-op animation when detached or Reduce Motion is on.
  static func crossfade(_ view: UIView, _ change: @escaping () -> Void) {
    guard view.window != nil, !reduced else { change(); return }
    UIView.transition(with: view, duration: 0.2, options: [.transitionCrossDissolve, .allowUserInteraction], animations: change)
  }
}

enum CompanionLayout {
  /// Use the app window, not the screen: iPad multitasking must leave enough room for both panes.
  static func showsSidebar(size: CGSize, isPad: Bool, regularWidth: Bool) -> Bool {
    isPad && regularWidth && size.width >= 900 && size.width > size.height
  }
}
