//! `<app_data>/bug-walk/settings.json`: the global shortcut and an on/off switch.

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}};

pub const DEFAULT_SHORTCUT: &str = "CommandOrControl+Shift+R";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct BugWalkSettings {
    pub shortcut: String,
    pub enabled: bool,
    /// Last chosen send-sheet split: "single" or "per_item".
    #[serde(default = "default_split")]
    pub last_split: String,
    /// Last chosen bug walk target: "zone" (drag a region) or "app" (pick a window). The hotkey reuses it.
    #[serde(default = "default_mode")]
    pub last_mode: String,
}

pub fn default_mode() -> String {
    "zone".into()
}

fn default_split() -> String {
    "single".into()
}

impl Default for BugWalkSettings {
    fn default() -> Self {
        Self { shortcut: DEFAULT_SHORTCUT.into(), enabled: true, last_split: default_split(), last_mode: default_mode() }
    }
}

fn path(root: &Path) -> PathBuf {
    root.join("bug-walk").join("settings.json")
}

pub fn validate_shortcut(s: &str) -> Result<(), String> {
    s.parse::<tauri_plugin_global_shortcut::Shortcut>().map(|_| ()).map_err(|e| format!("Invalid shortcut \"{s}\": {e}"))
}

/// A missing file is the default; a corrupt one is an error (not silently reset).
pub fn load(root: &Path) -> Result<BugWalkSettings, String> {
    match fs::read(path(root)) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("bug-walk/settings.json is corrupt: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BugWalkSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn save(root: &Path, s: &BugWalkSettings) -> Result<(), String> {
    validate_shortcut(&s.shortcut)?;
    let p = path(root);
    fs::create_dir_all(p.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_vec_pretty(s).unwrap()).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_roundtrip_and_validation() {
        let root = std::env::temp_dir().join(format!("bugwalk-settings-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        assert_eq!(load(&root).unwrap(), BugWalkSettings { shortcut: "CommandOrControl+Shift+R".into(), enabled: true, last_split: "single".into(), last_mode: "zone".into() });
        save(&root, &BugWalkSettings { shortcut: "CommandOrControl+Alt+B".into(), enabled: false, last_split: "per_item".into(), last_mode: "app".into() }).unwrap();
        assert_eq!(load(&root).unwrap().shortcut, "CommandOrControl+Alt+B");
        assert_eq!(load(&root).unwrap().last_split, "per_item");
        assert_eq!(load(&root).unwrap().last_mode, "app");
        assert!(save(&root, &BugWalkSettings { shortcut: "NotAKey++".into(), enabled: true, ..BugWalkSettings::default() }).is_err());
        fs::write(path(&root), b"{").unwrap();
        assert!(load(&root).unwrap_err().contains("corrupt"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn last_split_and_mode_default_when_absent() {
        let s: BugWalkSettings = serde_json::from_str(r#"{"shortcut":"CommandOrControl+Shift+R","enabled":true}"#).unwrap();
        assert_eq!(s.last_split, "single");
        assert_eq!(s.last_mode, "zone");
    }
}
