//! Voice settings persisted at `<root>/voice/settings.json`. Read from disk on
//! every call because the GUI and companion-server processes share the file.

use serde::{Deserialize, Serialize};
use std::{fs, path::{Path, PathBuf}, sync::Mutex};

pub const SHORTCUTS: &[&str] = &["AltRight", "MetaRight", "ControlRight", "AltLeft"];
static WRITE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceSettings {
    pub enabled: bool,
    pub active_model: Option<String>,
    pub shortcut: String,
    pub language: String,
}

impl Default for VoiceSettings {
    fn default() -> Self {
        Self { enabled: false, active_model: None, shortcut: "AltRight".into(), language: "auto".into() }
    }
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsPatch {
    pub enabled: Option<bool>,
    pub active_model: Option<String>,
    pub shortcut: Option<String>,
    pub language: Option<String>,
}

pub fn voice_dir(root: &Path) -> PathBuf {
    root.join("voice")
}
fn path(root: &Path) -> PathBuf {
    voice_dir(root).join("settings.json")
}

pub fn validate_shortcut(s: &str) -> Result<(), String> {
    if SHORTCUTS.contains(&s) {
        Ok(())
    } else {
        Err(format!("Unsupported shortcut \"{s}\" — choose one of {}", SHORTCUTS.join(", ")))
    }
}

pub fn validate_language(l: &str) -> Result<(), String> {
    let ok = l == "auto" || ((2..=3).contains(&l.len()) && l.chars().all(|c| c.is_ascii_lowercase()));
    if ok { Ok(()) } else { Err(format!("Invalid language \"{l}\" — use \"auto\" or an ISO code like \"en\"")) }
}

/// Missing file -> defaults. A corrupt file is an error, not silently reset.
pub fn load(root: &Path) -> Result<VoiceSettings, String> {
    match fs::read(path(root)) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Voice settings file is corrupt: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(VoiceSettings::default()),
        Err(e) => Err(format!("Could not read voice settings: {e}")),
    }
}

#[cfg(test)]
pub fn save(root: &Path, s: &VoiceSettings) -> Result<(), String> {
    let _g = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    save_locked(root, s)
}

fn save_locked(root: &Path, s: &VoiceSettings) -> Result<(), String> {
    let dir = voice_dir(root);
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create voice directory: {e}"))?;
    let tmp = dir.join(format!("settings.json.tmp-{}", std::process::id()));
    let json = serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| format!("Could not write voice settings: {e}"))?;
    fs::rename(&tmp, path(root)).map_err(|e| format!("Could not save voice settings: {e}"))
}

/// Read-modify-write under the in-process lock.
pub fn modify(root: &Path, f: impl FnOnce(&mut VoiceSettings) -> Result<(), String>) -> Result<VoiceSettings, String> {
    let _g = WRITE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut s = load(root)?;
    f(&mut s)?;
    save_locked(root, &s)?;
    Ok(s)
}

#[cfg(test)]
pub(crate) fn test_root(name: &str) -> PathBuf {
    let p = std::env::temp_dir().join(format!("freddai-voice-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&p);
    fs::create_dir_all(&p).unwrap();
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_roundtrip_and_camel_case() {
        let root = test_root("settings");
        assert_eq!(load(&root).unwrap(), VoiceSettings::default());
        let s = VoiceSettings { enabled: true, active_model: Some("whisper-base".into()), shortcut: "MetaRight".into(), language: "fr".into() };
        save(&root, &s).unwrap();
        assert_eq!(load(&root).unwrap(), s);
        let raw = fs::read_to_string(path(&root)).unwrap();
        assert!(raw.contains("activeModel"));
        fs::write(path(&root), "{\"enabled\":true}").unwrap();
        assert_eq!(load(&root).unwrap().shortcut, "AltRight");
        fs::write(path(&root), "garbage").unwrap();
        assert!(load(&root).is_err());
    }

    #[test]
    fn validation() {
        assert!(validate_shortcut("AltRight").is_ok() && validate_shortcut("F5").is_err());
        assert!(validate_language("auto").is_ok() && validate_language("en").is_ok());
        assert!(validate_language("English").is_err() && validate_language("").is_err());
    }
}
