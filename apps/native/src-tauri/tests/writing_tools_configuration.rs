// Run on the process main thread: WKWebViewConfiguration is main-thread-only.
#[cfg(target_os = "macos")]
#[path = "../src/writing_tools.rs"]
mod writing_tools;

#[cfg(target_os = "macos")]
fn main() {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    let unsupported: Retained<AnyObject> = unsafe { msg_send![class!(NSObject), new] };
    assert!(writing_tools::selection_updates_feature(&unsupported).is_none());
    let original_class = unsupported.class();
    writing_tools::disable_affordance(&unsupported);
    assert_eq!(unsupported.class(), original_class);
    let config = writing_tools::configuration();
    assert_affordance_disabled(&config);
    let behavior: isize = unsafe { msg_send![&config, writingToolsBehavior] };
    assert_eq!(behavior, -1);
    let preferences: Retained<AnyObject> = unsafe { msg_send![&config, preferences] };
    let Some(feature) = writing_tools::selection_updates_feature(&preferences) else {
        // Older WebKit retains the public opt-out when this private feature is absent.
        let copy: Retained<AnyObject> = unsafe { msg_send![&config, copy] };
        let copied_behavior: isize = unsafe { msg_send![&copy, writingToolsBehavior] };
        assert_eq!(copied_behavior, -1);
        let copied_preferences: Retained<AnyObject> = unsafe { msg_send![&copy, preferences] };
        assert!(writing_tools::selection_updates_feature(&copied_preferences).is_none());
        println!("PASS: public Writing Tools opt-out survives copying on WebKit without selection updates");
        return;
    };
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

#[cfg(target_os = "macos")]
fn assert_affordance_disabled(config: &objc2_web_kit::WKWebViewConfiguration) {
    use objc2::{msg_send, runtime::AnyObject, MainThreadOnly};
    use objc2_foundation::{NSDate, NSPoint, NSRect, NSRunLoop, NSSize, NSString};
    let mtm = objc2::MainThreadMarker::new().unwrap();
    let view = unsafe {
        objc2_web_kit::WKWebView::initWithFrame_configuration(
            objc2_web_kit::WKWebView::alloc(mtm),
            NSRect::new(NSPoint::new(0., 0.), NSSize::new(800., 400.)),
            config,
        )
    };
    let runtime_class = view.class();
    let reported: &'static objc2::runtime::AnyClass = unsafe { msg_send![&view, class] };
    writing_tools::disable_affordance(&view);
    writing_tools::disable_affordance(&view);
    assert_eq!(view.class(), runtime_class, "Installation must never change WebKit isa");
    let after: &'static objc2::runtime::AnyClass = unsafe { msg_send![&view, class] };
    assert_eq!(after, reported, "Installation must preserve AppKit class identity");
    let html = NSString::from_str(
        r#"<textarea autofocus>hello composer</textarea><script>
onload = () => {
 const t = document.querySelector('textarea'); t.focus(); t.select();
 document.execCommand('insertText', false, 'first line\nsecond line');
 t.setSelectionRange(0, 5);
 document.title = document.activeElement === t && t.value === 'first line\nsecond line' && t.selectionEnd === 5 ? 'composer-pass' : 'composer-fail';
};</script>"#,
    );
    unsafe {
        let _: *mut AnyObject =
            msg_send![&view, loadHTMLString: &*html, baseURL: std::ptr::null::<AnyObject>()];
    }
    let end = NSDate::dateWithTimeIntervalSinceNow(10.);
    while end.timeIntervalSinceNow() > 0. {
        let title: Option<objc2::rc::Retained<NSString>> = unsafe { msg_send![&view, title] };
        if title.is_some_and(|title| title.to_string().starts_with("composer-")) {
            break;
        }
        NSRunLoop::currentRunLoop().runUntilDate(&NSDate::dateWithTimeIntervalSinceNow(0.02));
    }
    let title: Option<objc2::rc::Retained<NSString>> = unsafe { msg_send![&view, title] };
    assert_eq!(
        title.as_deref().map(|s| s.to_string()).as_deref(),
        Some("composer-pass"),
        "textarea must load, focus, edit multiline text and select normally"
    );
    // A separate webview keeps its own class; no global WebKit method replacement.
    let other = unsafe {
        objc2_web_kit::WKWebView::initWithFrame_configuration(
            objc2_web_kit::WKWebView::alloc(mtm),
            NSRect::ZERO,
            config,
        )
    };
    assert_eq!(other.class(), view.class());
    println!("PASS: multiline editing, selection and original WebKit runtime class preserved");
}
