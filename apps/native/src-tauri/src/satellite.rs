//! Mac execution role. Switching never terminates detached agent hosts.
use tauri::Manager;
fn mode_path() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(|home| std::path::PathBuf::from(home).join("Library/Application Support/com.freddai.desktop/satellite-mode"))
}
pub fn enabled() -> bool { mode_path().is_some_and(|path| path.is_file()) }
#[tauri::command]
pub fn satellite_mode() -> bool { enabled() }
#[tauri::command]
pub fn satellite_set_mode(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e|e.to_string())?.join("satellite-mode");
    if enabled {
        std::fs::create_dir_all(path.parent().unwrap()).map_err(|e|e.to_string())?;
        std::fs::write(&path, b"satellite\n").map_err(|e|e.to_string())?;
    } else if path.exists() { std::fs::remove_file(path).map_err(|e|e.to_string())?; }
    std::fs::write(app.path().app_data_dir().map_err(|e|e.to_string())?.join("execution-role-chosen"), b"chosen\n").map_err(|e|e.to_string())?;
    app.restart();
}

// Existing workspaces keep their role; only an unused installation offers onboarding.
#[tauri::command]
pub fn satellite_onboarding_needed(app: tauri::AppHandle) -> Result<bool, String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    if root.join("execution-role-chosen").exists() { return Ok(false); }
    match std::fs::read(root.join("workspace.json")) {
        Ok(bytes) => {
            let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
            Ok(!has_local_work(&value))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}
#[tauri::command]
pub fn satellite_finish_onboarding(app: tauri::AppHandle) -> Result<(), String> {
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    std::fs::write(root.join("execution-role-chosen"), b"local\n").map_err(|e| e.to_string())
}

fn has_local_work(value: &serde_json::Value) -> bool {
    ["accounts", "sessions"].iter().any(|key| value[*key].as_array().is_some_and(|items| !items.is_empty()))
        || value["projects"].as_array().is_some_and(|items| items.iter().any(|p| p["kind"] != "commander"))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn onboarding_preserves_existing_work_and_ignores_empty_commander() {
        use serde_json::json;
        assert!(!has_local_work(&json!({})));
        assert!(!has_local_work(&json!({"projects":[{"kind":"commander"}]})));
        for value in [json!({"projects":[{"name":"Existing"}]}), json!({"accounts":[{"id":"existing"}]}), json!({"sessions":[{"id":"existing"}]})] {
            assert!(has_local_work(&value));
        }
    }
}
