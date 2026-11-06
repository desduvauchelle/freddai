#[cfg(target_os = "macos")]
#[path = "../src/browser.rs"]
mod browser;
#[cfg(target_os = "macos")]
#[path = "../src/writing_tools.rs"]
mod writing_tools;
#[cfg(target_os = "macos")]
fn main() {
    use tauri::Manager;
    let app = tauri::Builder::default().setup(|app| {
        let main = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("about:blank".parse().unwrap())).with_webview_configuration(writing_tools::configuration()).visible(true).focused(true).build()?;
        writing_tools::install(&main)?;
        main.with_webview(|_| unsafe {
            use objc2::{class, msg_send, runtime::AnyObject};
            let panel: *mut AnyObject = msg_send![class!(NSColorPanel), sharedColorPanel];
            let _: () = msg_send![panel, orderFront: std::ptr::null::<AnyObject>()];
        })?;
        let caller = app.get_webview("main").unwrap();
        let handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            let result = async {
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                for width in [900., 1100., 800.] {
                    main.set_size(tauri::LogicalSize::new(width, 700.)).map_err(|e| e.to_string())?;
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                let unique = format!("regression-{}", std::process::id());
                let a = format!("{unique}-a"); let b = format!("{unique}-b");
                for profile in [&a, &b] {
                    browser::browser_view(caller.clone(), profile.clone(), Some("http://127.0.0.1:9".into()), Some([0., 0., 320., 200.]), "show".into()).await?;
                }
                let views: Vec<_> = handle.webviews().into_values().filter(|v| v.label().starts_with("browser-")).collect();
                if views.len() != 2 { return Err("Expected two independent browser views".into()); }
                let cookie = tauri::webview::Cookie::build(("freddai_ui_preference", "compact")).domain("127.0.0.1").path("/").build();
                views[0].set_cookie(cookie).map_err(|e| e.to_string())?;
                let contains = |cookies: Vec<tauri::webview::Cookie<'static>>| cookies.iter().any(|c| c.name() == "freddai_ui_preference");
                // WebKit cookie writes complete asynchronously. Wait for observable evidence.
                let mut written = false;
                for _ in 0..40 {
                    if contains(views[0].cookies().map_err(|e| e.to_string())?) { written = true; break; }
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                }
                if !written { return Err("Preference cookie was not stored".into()); }
                if contains(views[1].cookies().map_err(|e| e.to_string())?) { return Err("Cookie leaked between sessions".into()); }
                // Recreate the view with the same profile ID to prove its store survives closing.
                let first_name = views[0].label().to_string();
                views[0].close().map_err(|e| e.to_string())?;
                let hash_a = format!("{:x}", sha2::Sha256::digest(a.as_bytes()));
                let chosen = if first_name.ends_with(&hash_a) { a } else { b };
                browser::browser_view(caller.clone(), chosen, Some("http://127.0.0.1:9".into()), Some([0., 0., 320., 200.]), "show".into()).await?;
                let recreated = handle.get_webview(&first_name).ok_or("Missing recreated session")?;
                if !contains(recreated.cookies().map_err(|e| e.to_string())?) { return Err("Session store did not survive recreation".into()); }
                drop(main);
                Ok::<(), String>(())
            }.await;
            match result { Ok(()) => { println!("PASS: isolated native cookie stores and persistence across view recreation"); handle.exit(0); }, Err(e) => { eprintln!("FAIL: {e}"); handle.exit(1); } }
        });
        Ok(())
    }).build(tauri::generate_context!()).expect("Browser test setup");
    app.run(|_, _| {});
}
#[cfg(target_os = "macos")]
use sha2::Digest;
#[cfg(not(target_os = "macos"))]
fn main() {}
