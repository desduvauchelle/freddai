/// WKWebView configuration with Apple Writing Tools disabled, so the floating Writing Tools
/// behavior is opted out for textareas. Must be set before the webview is created.
/// Guarded with respondsToSelector so macOS older than 15.0 keeps the default behavior.
#[cfg(target_os = "macos")]
pub fn configuration() -> objc2::rc::Retained<objc2_web_kit::WKWebViewConfiguration> {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    let mtm = objc2::MainThreadMarker::new()
        .expect("webview configuration must be created on the main thread");
    let config = unsafe { objc2_web_kit::WKWebViewConfiguration::new(mtm) };
    let object: &AnyObject = &config;
    let supported: bool =
        unsafe { msg_send![object, respondsToSelector: sel!(setWritingToolsBehavior:)] };
    if supported {
        // NSWritingToolsBehaviorNone = -1
        let _: () = unsafe { msg_send![object, setWritingToolsBehavior: -1_isize] };
        eprintln!("freddai: Writing Tools disabled on WKWebViewConfiguration");
    } else {
        eprintln!("freddai: WKWebViewConfiguration lacks writingToolsBehavior (macOS < 15); Writing Tools left at default");
    }
    // macOS 27 regression: selection updates can show Siri despite the public
    // opt-out. https://bugs.webkit.org/show_bug.cgi?id=327446
    // Keep this local to this configuration. Remove once the minimum supported
    // system WebKit includes upstream fix 323726@main.
    let preferences: objc2::rc::Retained<AnyObject> = unsafe { msg_send![&config, preferences] };
    if let Some(feature) = selection_updates_feature(&preferences) {
        unsafe {
            let _: () = msg_send![&preferences, _setEnabled: false, forFeature: &*feature];
            let enabled: bool = msg_send![&preferences, _isEnabledForFeature: &*feature];
            eprintln!(
                "freddai: Siri selection-update workaround applied: {}",
                !enabled
            );
        }
    } else {
        eprintln!("freddai: Siri selection-update feature unavailable; using public Writing Tools opt-out only");
    }
    config
}

/// Private WebKit feature discovery, guarded so unsupported OS versions retain the
/// public Writing Tools opt-out. No system preferences or other apps are changed.
pub(crate) fn selection_updates_feature(
    preferences: &objc2::runtime::AnyObject,
) -> Option<objc2::rc::Retained<objc2::runtime::AnyObject>> {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject, sel};
    let class = preferences.class();
    // Signatures: WebKit's WKPreferencesPrivate.h and _WKFeature.h.
    unsafe {
        let available: bool = msg_send![class, respondsToSelector: sel!(_features)];
        let setter: bool =
            msg_send![preferences, respondsToSelector: sel!(_setEnabled:forFeature:)];
        let getter: bool = msg_send![preferences, respondsToSelector: sel!(_isEnabledForFeature:)];
        if !available || !setter || !getter {
            return None;
        }
        let features: Option<Retained<AnyObject>> = msg_send![class, _features];
        let features = features?;
        let count: usize = msg_send![&features, count];
        for index in 0..count {
            let feature: Retained<AnyObject> = msg_send![&features, objectAtIndex: index];
            let has_key: bool = msg_send![&feature, respondsToSelector: sel!(key)];
            if !has_key {
                continue;
            }
            let key: Option<Retained<AnyObject>> = msg_send![&feature, key];
            let Some(key) = key else {
                continue;
            };
            let bytes: *const std::ffi::c_char = msg_send![&key, UTF8String];
            if !bytes.is_null()
                && std::ffi::CStr::from_ptr(bytes).to_bytes()
                    == b"TextInputClientSelectionUpdatesEnabled"
            {
                return Some(feature);
            }
        }
    }
    None
}

/// Keep WebKit's runtime class intact. AppKit installs observation subclasses
/// and caches NSView metadata; changing isa after initialization corrupts that
/// bookkeeping during layout and NSWindow teardown on macOS 27. The configuration
/// above is the supported opt-out; never synthesize a subclass on a live view.
#[cfg(target_os = "macos")]
pub fn disable_affordance(_view: &objc2::runtime::AnyObject) {
    assert!(objc2::MainThreadMarker::new().is_some());
}

#[cfg(target_os = "macos")]
pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| unsafe {
        if let Some(view) = (webview.inner() as *mut objc2::runtime::AnyObject).as_ref() {
            disable_affordance(view);
        }
    })
}
