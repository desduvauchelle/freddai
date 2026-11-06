//! Unprivileged browsing surfaces. Never grant these labels app IPC capabilities.
use sha2::{Digest, Sha256};
use tauri::{Manager, Webview};

fn label(caller: &Webview, profile: &str) -> Result<String, String> {
    if caller.label() != "main" && !caller.label().starts_with("thread-") {
        return Err("Browser controls require a workspace window".into());
    }
    if profile.is_empty() || profile.len() > 128 { return Err("Invalid browser session".into()); }
    Ok(format!("browser-{}-{:x}", caller.label(), Sha256::digest(profile.as_bytes())))
}
fn web_url(value: &str) -> Result<tauri::Url, String> {
    let url = tauri::Url::parse(value).map_err(|e| e.to_string())?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("Enter an http or https URL".into());
    }
    Ok(url)
}
#[tauri::command]
pub async fn browser_view(caller: Webview, profile: String, url: Option<String>, bounds: Option<[f64; 4]>, action: String) -> Result<Option<String>, String> {
    let name = label(&caller, &profile)?;
    let target = url.as_deref().map(web_url).transpose()?;
    if let Some(b) = bounds {
        if b.iter().any(|v| !v.is_finite()) || b[0] < 0. || b[1] < 0. || b[2] < 1. || b[3] < 1. {
            return Err("Invalid browser bounds".into());
        }
    }
    let app = caller.app_handle().clone();
    let window = caller.window();
    let (send, receive) = tokio::sync::oneshot::channel();
    app.clone().run_on_main_thread(move || {
        let result = (|| {
            let existing = app.get_webview(&name);
            if action == "hide" {
                if let Some(view) = existing { view.hide().map_err(|e| e.to_string())?; }
                return Ok(None);
            }
            if action == "status" { return existing.map(|v| v.url().map(|u| Some(u.to_string())).map_err(|e| e.to_string())).unwrap_or(Ok(None)); }
            let view = if let Some(view) = existing { view } else {
                #[cfg(not(target_os = "macos"))]
                return Err("Embedded sessions currently require macOS 14 or later".into());
                #[cfg(target_os = "macos")]
                {
                    let version = std::process::Command::new("/usr/bin/sw_vers").arg("-productVersion").output().map_err(|e| e.to_string())?;
                    let major = String::from_utf8_lossy(&version.stdout).split('.').next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
                    if major < 14 { return Err("Isolated browser sessions require macOS 14 or later. Use Open externally on this Mac.".into()); }
                    let target = target.clone().ok_or("Open a URL first")?;
                    let b = bounds.ok_or("Browser bounds required")?;
                    let hash = Sha256::digest(format!("freddai-browser-session:{profile}").as_bytes());
                    let mut store = [0; 16]; store.copy_from_slice(&hash[..16]);
                    let builder = tauri::webview::WebviewBuilder::new(&name, tauri::WebviewUrl::External(target))
                        .data_store_identifier(store)
                        .on_navigation(|u| matches!(u.scheme(), "http" | "https"))
                        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
                    window.add_child(builder, tauri::LogicalPosition::new(b[0], b[1]), tauri::LogicalSize::new(b[2], b[3])).map_err(|e| e.to_string())?
                }
            };
            if let Some(b) = bounds {
                view.set_bounds(tauri::Rect { position: tauri::LogicalPosition::new(b[0], b[1]).into(), size: tauri::LogicalSize::new(b[2], b[3]).into() }).map_err(|e| e.to_string())?;
            }
            match action.as_str() {
                "navigate" => view.navigate(target.ok_or("URL required")?).map_err(|e| e.to_string())?,
                "back" => view.eval("history.back()").map_err(|e| e.to_string())?,
                "forward" => view.eval("history.forward()").map_err(|e| e.to_string())?,
                "reload" => view.reload().map_err(|e| e.to_string())?,
                "show" => (),
                _ => return Err("Unknown browser action".into()),
            }
            view.show().map_err(|e| e.to_string())?;
            Ok(None)
        })();
        let _ = send.send(result);
    }).map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_web_navigation() {
        for value in ["http://localhost:3000/login", "https://example.com"] { assert!(web_url(value).is_ok()); }
        for value in ["file:///etc/passwd", "javascript:alert(1)", "tauri://localhost", "data:text/html,x", "relative"] { assert!(web_url(value).is_err()); }
    }
}
