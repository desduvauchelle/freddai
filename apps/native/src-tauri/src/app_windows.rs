use tauri::Manager;

fn title_for(id: &str) -> Option<&'static str> {
    match id {
        "scout" => Some("Scout"),
        _ => None,
    }
}

pub(crate) fn window_config(
    mut config: tauri::utils::config::WindowConfig,
    id: &str,
) -> Result<tauri::utils::config::WindowConfig, String> {
    let title = title_for(id).ok_or_else(|| format!("unknown app: {id}"))?;
    config.label = format!("app-{id}");
    config.title = title.into();
    config.width = 1280.;
    config.height = 860.;
    config.visible = true;
    config.url = tauri::WebviewUrl::App(format!("index.html?app={id}").into());
    Ok(config)
}

/// Opens (or focuses) the window for another app in this package.
pub(crate) async fn open(
    app: tauri::AppHandle,
    base: tauri::utils::config::WindowConfig,
    id: String,
) -> Result<(), String> {
    // Validate before scheduling so an unknown id fails fast with a clear error.
    window_config(base.clone(), &id)?;
    let (send, receive) = tokio::sync::oneshot::channel();
    let window_app = app.clone();
    // WebKit configuration and window creation must run on the main thread,
    // including the lookup/focus so simultaneous opens cannot race on one label.
    app.run_on_main_thread(move || {
        let _ = send.send(open_on_main_thread(window_app, base, id));
    })
    .map_err(|e| format!("Could not schedule app window: {e}"))?;
    receive
        .await
        .map_err(|e| format!("App window creation interrupted: {e}"))?
}

fn open_on_main_thread(
    app: tauri::AppHandle,
    base: tauri::utils::config::WindowConfig,
    id: String,
) -> Result<(), String> {
    let config = window_config(base, &id)?;
    if let Some(window) = app.get_webview_window(&config.label) {
        window.unminimize().map_err(|e| e.to_string())?;
        window.show().map_err(|e| e.to_string())?;
        return window.set_focus().map_err(|e| e.to_string());
    }
    let builder =
        tauri::WebviewWindowBuilder::from_config(&app, &config).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    let builder = builder.with_webview_configuration(crate::writing_tools::configuration());
    let window = builder.build().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::writing_tools::install(&window).map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_app() {
        let base = tauri::utils::config::WindowConfig::default();
        assert_eq!(window_config(base, "nope").unwrap_err(), "unknown app: nope");
    }
}
