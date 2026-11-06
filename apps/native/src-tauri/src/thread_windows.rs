use sha2::{Digest, Sha256};
use tauri::Manager;

pub(crate) fn window_config(
    mut config: tauri::utils::config::WindowConfig,
    label: String,
    session: &str,
    title: &str,
) -> Result<tauri::utils::config::WindowConfig, String> {
    config.label = label;
    config.title = format!("{title} — Freddai");
    config.width = 960.;
    config.visible = true;
    let mut url = tauri::Url::parse("http://localhost/index.html").map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("thread", session);
    config.url =
        tauri::WebviewUrl::App(format!("index.html?{}", url.query().unwrap_or_default()).into());
    Ok(config)
}

/// Called from the async IPC command after looking up the thread on the shared host.
pub(crate) async fn open(
    app: tauri::AppHandle,
    base: tauri::utils::config::WindowConfig,
    session: String,
    title: &str,
) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let window_app = app.clone();
    let title = title.to_owned();
    // IPC commands run on Tokio workers. WebKit configuration and window creation
    // must run on the main thread, including the existing-window lookup/focus so
    // simultaneous opens cannot race to create the same label.
    app.run_on_main_thread(move || {
        let result = open_on_main_thread(window_app, base, session, &title);
        let _ = send.send(result);
    })
    .map_err(|e| format!("Could not schedule thread window: {e}"))?;
    receive
        .await
        .map_err(|e| format!("Thread window creation interrupted: {e}"))?
}

fn open_on_main_thread(
    app: tauri::AppHandle,
    base: tauri::utils::config::WindowConfig,
    session: String,
    title: &str,
) -> Result<(), String> {
    // Hashing gives arbitrary host IDs a stable, valid Tauri window label.
    let label = format!("thread-{:x}", Sha256::digest(session.as_bytes()));
    if let Some(window) = app.get_webview_window(&label) {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let config = window_config(base, label, &session, title)?;
    let builder =
        tauri::WebviewWindowBuilder::from_config(&app, &config).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let builder = builder.with_webview_configuration(crate::writing_tools::configuration());
    let window = builder.build().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::writing_tools::install(&window).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
