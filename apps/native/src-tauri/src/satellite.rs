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
    app.restart();
}
