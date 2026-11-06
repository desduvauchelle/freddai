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

/// Opt Freddai's text-input client out of the native floating affordance as well.
/// macOS 27 can query this independently of the configuration/selection opt-outs.
/// Use an ivar-free subclass of the actual Wry class: existing input, navigation,
/// delegates and destruction stay inherited, and unrelated webviews are untouched.
#[cfg(target_os = "macos")]
pub fn disable_affordance(view: &objc2::runtime::AnyObject) {
    use objc2::{
        msg_send,
        runtime::{AnyClass, AnyObject, Bool, ClassBuilder, Sel},
        sel,
    };
    assert!(objc2::MainThreadMarker::new().is_some());
    unsafe {
        let supported: bool =
            msg_send![view, respondsToSelector: sel!(allowsWritingToolsAffordance)];
        if !supported {
            return;
        }
        let base = view.class();
        // AppKit can put a KVO subclass above ours. Do not replace that class
        // or install a second affordance layer around it.
        let mut ancestor = Some(base);
        while let Some(class) = ancestor {
            if class.name().to_bytes().starts_with(b"FreddaiNoWritingAffordance_") {
                return;
            }
            ancestor = class.superclass();
        }
        let name = base.name().to_string_lossy();
        let name = std::ffi::CString::new(format!("FreddaiNoWritingAffordance_{name}")).unwrap();
        let subclass = AnyClass::get(&name).unwrap_or_else(|| {
            let mut builder = ClassBuilder::new(&name, base).expect("unique affordance subclass");
            unsafe extern "C-unwind" fn disallow(_: &AnyObject, _: Sel) -> Bool {
                Bool::NO
            }
            // Preserve the class identity AppKit uses for cached dynamic view
            // properties, as KVO subclasses do. The runtime subclass still owns
            // the affordance override without invalidating NSView metadata.
            unsafe extern "C-unwind" fn original_class(view: &AnyObject, _: Sel) -> &'static AnyClass {
                // Resolve the class that owns this override, not the immediate
                // runtime class: KVO may have subclassed the instance since install.
                let mut class = view.class();
                loop {
                    if class.name().to_bytes().starts_with(b"FreddaiNoWritingAffordance_") {
                        return class.superclass().expect("affordance subclass superclass");
                    }
                    class = class.superclass().expect("affordance override ancestor");
                }
            }
            builder.add_method(
                sel!(class),
                original_class as unsafe extern "C-unwind" fn(_, _) -> &'static AnyClass,
            );
            builder.add_method(
                sel!(allowsWritingToolsAffordance),
                disallow as unsafe extern "C-unwind" fn(_, _) -> Bool,
            );
            builder.register()
        });
        // Same instance layout; main-thread-only WebKit objects cannot race here.
        assert_eq!(subclass.superclass(), Some(base));
        AnyObject::set_class(view, subclass);
        let allows: bool = msg_send![view, allowsWritingToolsAffordance];
        eprintln!(
            "freddai: native Writing Tools affordance disabled: {}",
            !allows
        );
    }
}

#[cfg(target_os = "macos")]
pub fn install(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.with_webview(|webview| unsafe {
        if let Some(view) = (webview.inner() as *mut objc2::runtime::AnyObject).as_ref() {
            disable_affordance(view);
        }
    })
}
