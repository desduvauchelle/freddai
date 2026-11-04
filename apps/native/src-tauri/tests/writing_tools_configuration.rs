// Run on the process main thread: WKWebViewConfiguration is main-thread-only.
#[cfg(target_os = "macos")]
#[path = "../src/writing_tools.rs"]
mod writing_tools;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    let unsupported: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
    assert!(writing_tools::selection_updates_feature(&unsupported).is_none());
    let config = writing_tools::configuration();
    let behavior: isize = unsafe { msg_send![&config, writingToolsBehavior] };
    assert_eq!(behavior, -1);
    let preferences: Retained<AnyObject> = unsafe { msg_send![&config, preferences] };
    let feature = writing_tools::selection_updates_feature(&preferences)
        .expect("this regression check requires WebKit's selection-update feature");
    let enabled: bool = unsafe { msg_send![&preferences, _isEnabledForFeature: &*feature] };
    assert!(
        !enabled,
        "Siri selection updates remain enabled despite Writing Tools opt-out"
    );
    // WebKit copies configuration during creation. Check the workaround survives copying.
    let copy: Retained<AnyObject> = unsafe { msg_send![&config, copy] };
    let copied_preferences: Retained<AnyObject> = unsafe { msg_send![&copy, preferences] };
    let enabled: bool = unsafe { msg_send![&copied_preferences, _isEnabledForFeature: &*feature] };
    assert!(!enabled);
    println!(
        "PASS: Writing Tools and Siri selection updates disabled, including copied configuration"
    );
}

#[cfg(not(target_os = "macos"))]
fn main() {}
