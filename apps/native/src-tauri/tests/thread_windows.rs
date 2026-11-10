// A real event loop is necessary: the async IPC path must create WebKit objects
// on the process main thread. No host, accounts or agent turns are used here.
#[cfg(target_os = "macos")]
#[path = "../src/thread_windows.rs"]
mod thread_windows;
#[cfg(target_os = "macos")]
#[path = "../src/writing_tools.rs"]
mod writing_tools;

#[cfg(target_os = "macos")]
fn main() {
    use tauri::Manager;
    let app = tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let base = app.config().app.windows[0].clone();
            tauri::async_runtime::spawn(async move {
                let probe = handle.clone();
                let result = tauri::async_runtime::spawn(async move {
                    thread_windows::open(probe.clone(), base.clone(), "native-window-regression".into(), "Window regression").await?;
                    let windows = probe.webview_windows();
                    if windows.len() != 1 { return Err(format!("Expected one window, got {}", windows.len())); }
                    let window = windows.values().next().unwrap();
                    if !window.is_visible().map_err(|e| e.to_string())? { return Err("Window is hidden".into()); }
                    if window.title().map_err(|e| e.to_string())? != "Window regression — Freddai" { return Err("Wrong thread title".into()); }
                    #[cfg(target_os = "macos")]
                    {
                        let (send, receive) = tokio::sync::oneshot::channel();
                        window.with_webview(move |webview| unsafe {
                            let view = &*(webview.inner() as *mut objc2::runtime::AnyObject);
                            let replaced = view.class().name().to_bytes().starts_with(b"FreddaiNoWritingAffordance_");
                            let _ = send.send(replaced);
                        }).map_err(|e| e.to_string())?;
                        if receive.await.map_err(|e| e.to_string())? { return Err("Native Wry window runtime class was replaced".into()); }
                    }
                    let url = window.url().map_err(|e| e.to_string())?;
                    if !url.query_pairs().any(|(key, value)| key == "thread" && value == "native-window-regression") { return Err(format!("Wrong route: {url}")); }
                    thread_windows::open(probe.clone(), base, "native-window-regression".into(), "Window regression").await?;
                    if probe.webview_windows().len() != 1 { return Err("Repeated open duplicated the window".into()); }
                    // Keep the event loop alive through NSWindow/WebKit teardown.
                    for cycle in 0..10 {
                        let window = probe.webview_windows().into_values().next().ok_or("Missing window before close")?;
                        window.close().map_err(|e| e.to_string())?;
                        for _ in 0..100 {
                            if probe.webview_windows().is_empty() { break; }
                            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                        }
                        if !probe.webview_windows().is_empty() { return Err("Window close timed out".into()); }
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        if cycle < 9 {
                            thread_windows::open(probe.clone(), probe.config().app.windows[0].clone(), "native-window-regression".into(), "Window regression").await?;
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                        }
                    }
                    Ok::<_, String>(())
                }).await;
                match result {
                    Ok(Ok(())) => { println!("PASS: async native thread window route, reuse and ten close/reopen teardown cycles"); handle.exit(0); }
                    failure => { eprintln!("FAIL: native thread window did not open: {failure:?}"); handle.exit(1); }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Native test app setup failed");
    app.run(|_, event| {
        if let tauri::RunEvent::ExitRequested { api, code: None, .. } = event {
            api.prevent_exit();
        }
    });
}
#[cfg(not(target_os = "macos"))]
fn main() {}
