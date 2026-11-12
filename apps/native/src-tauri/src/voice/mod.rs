//! Local push-to-talk dictation (Whisper). Plain Rust keyed by the app data
//! `root`, no Tauri dependency, so the companion-server process can call it too.

pub mod connections;
pub mod call;
pub mod cleanup;
pub mod decode;
pub mod download;
pub mod recorder;
pub mod registry;
pub mod resample;
pub mod settings;
pub mod transcribe;
pub mod tts;

use serde::Serialize;
use settings::{SettingsPatch, VoiceSettings};
use std::path::Path;
pub use transcribe::Transcript;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: String,
    pub name: String,
    pub description: String,
    pub language_label: String,
    pub size_bytes: u64,
    pub recommended: bool,
    pub installed: bool,
    pub download: Option<download::DownloadState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub enabled: bool,
    pub active_model: Option<String>,
    pub shortcut: String,
    pub language: String,
    pub remove_filler_words: bool,
    pub ready: bool,
    pub recording: bool,
    pub models: Vec<ModelStatus>,
}

pub fn status(root: &Path) -> VoiceStatus {
    let s = settings::load(root).unwrap_or_else(|e| {
        eprintln!("voice.settings.load_failed error={e}");
        VoiceSettings::default()
    });
    let models: Vec<ModelStatus> = registry::MODELS
        .iter()
        .map(|m| ModelStatus {
            id: m.id.into(),
            name: m.name.into(),
            description: m.description.into(),
            language_label: m.language_label.into(),
            size_bytes: m.size_bytes,
            recommended: m.recommended,
            installed: download::is_installed(root, m),
            download: download::download_state(m.id),
        })
        .collect();
    let active_installed = s.active_model.as_deref().map(|a| models.iter().any(|m| m.id == a && m.installed)).unwrap_or(false);
    VoiceStatus {
        ready: connections::remote_ready(root).map(|r| r.is_some() || s.enabled && active_installed).unwrap_or(false),
        enabled: s.enabled || connections::remote_ready(root).ok().flatten().is_some(),
        active_model: s.active_model,
        shortcut: s.shortcut,
        language: s.language,
        remove_filler_words: s.remove_filler_words,
        recording: recorder::is_recording(),
        models,
    }
}

/// Returns the active model id when dictation can run.
pub fn ready(root: &Path) -> Result<String, String> {
    if let Some(model) = connections::remote_ready(root)? { return Ok(model); }
    let s = settings::load(root)?;
    if !s.enabled {
        return Err("Voice dictation is turned off on the Mac".into());
    }
    let id = s.active_model.ok_or("No voice model downloaded on the Mac")?;
    let m = registry::find(&id).ok_or_else(|| format!("Selected voice model \"{id}\" is not recognised"))?;
    if !download::is_installed(root, m) {
        return Err(format!("Voice model {} is not downloaded on the Mac", m.name));
    }
    Ok(id)
}

pub fn update_settings(root: &Path, patch: SettingsPatch) -> Result<VoiceStatus, String> {
    if let Some(s) = &patch.shortcut { settings::validate_shortcut(s)?; }
    if let Some(l) = &patch.language { settings::validate_language(l)?; }
    settings::modify(root, |s| {
        if let Some(id) = &patch.active_model {
            let m = registry::find(id).ok_or_else(|| format!("Unknown voice model \"{id}\""))?;
            if !download::is_installed(root, m) {
                return Err(format!("{} is not downloaded yet — download it first", m.name));
            }
            s.active_model = Some(id.clone());
        }
        if let Some(on) = patch.enabled {
            if on {
                let has = s.active_model.as_deref().and_then(registry::find).map(|m| download::is_installed(root, m)).unwrap_or(false);
                if !has {
                    return Err("Download a voice model before turning dictation on".into());
                }
            }
            s.enabled = on;
        }
        if let Some(sc) = &patch.shortcut { s.shortcut = sc.clone(); }
        if let Some(l) = &patch.language { s.language = l.clone(); }
        if let Some(remove) = patch.remove_filler_words { s.remove_filler_words = remove; }
        Ok(())
    })?;
    Ok(status(root))
}

pub fn download_model(root: &Path, id: &str) -> Result<VoiceStatus, String> {
    download::start(root, id)?;
    Ok(status(root))
}

pub fn cancel_download(root: &Path, id: &str) -> Result<VoiceStatus, String> {
    download::cancel(root, id)?;
    Ok(status(root))
}

pub fn delete_model(root: &Path, id: &str) -> Result<VoiceStatus, String> {
    transcribe::unload(id);
    download::delete(root, id)?;
    settings::modify(root, |s| {
        if s.active_model.as_deref() == Some(id) {
            s.active_model = None;
            s.enabled = false;
        }
        Ok(())
    })?;
    Ok(status(root))
}

pub fn start_recording(root: &Path) -> Result<(), String> {
    if call::is_active() {
        return Err("A voice call is running — end it before dictating".into());
    }
    ready(root)?;
    recorder::start()?;
    transcribe::warm(root);
    Ok(())
}

/// Blocking (transcription). Call from a blocking thread.
pub fn stop_recording(root: &Path) -> Result<Transcript, String> {
    let samples = recorder::stop()?;
    transcribe::transcribe_samples(root, &samples)
}

pub fn cancel_recording() {
    recorder::cancel();
}

/// Blocking. Decode a WAV / M4A file from the iPhone companion and transcribe it.
pub fn transcribe_file(root: &Path, path: &Path) -> Result<Transcript, String> {
    ready(root)?;
    let samples = decode::decode_to_16k_mono(path)?;
    transcribe::transcribe_samples(root, &samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_errors_and_status_shape() {
        let root = settings::test_root("ready");
        assert_eq!(ready(&root).unwrap_err(), "Voice dictation is turned off on the Mac");
        settings::modify(&root, |s| { s.enabled = true; Ok(()) }).unwrap();
        assert_eq!(ready(&root).unwrap_err(), "No voice model downloaded on the Mac");
        settings::modify(&root, |s| { s.active_model = Some("whisper-base".into()); Ok(()) }).unwrap();
        assert!(ready(&root).unwrap_err().contains("not downloaded"));
        let st = status(&root);
        assert!(!st.ready && st.models.len() == 4 && st.models.iter().all(|m| !m.installed));
        let j = serde_json::to_value(&st).unwrap();
        assert!(j["models"][0]["languageLabel"].is_string() && j["activeModel"].is_string());
    }

    #[test]
    fn update_settings_rejects_uninstalled() {
        let root = settings::test_root("update");
        let e = update_settings(&root, SettingsPatch { enabled: Some(true), ..Default::default() }).unwrap_err();
        assert!(e.contains("Download a voice model"));
        let e = update_settings(&root, SettingsPatch { active_model: Some("whisper-base".into()), ..Default::default() }).unwrap_err();
        assert!(e.contains("not downloaded"));
        assert!(update_settings(&root, SettingsPatch { shortcut: Some("F1".into()), ..Default::default() }).is_err());
        let st = update_settings(&root, SettingsPatch { shortcut: Some("MetaRight".into()), language: Some("de".into()), ..Default::default() }).unwrap();
        assert!(st.remove_filler_words);
        let st = update_settings(&root, SettingsPatch { remove_filler_words: Some(false), ..Default::default() }).unwrap();
        assert!(!st.remove_filler_words);
        assert!(!settings::load(&root).unwrap().remove_filler_words);
        assert_eq!((st.shortcut.as_str(), st.language.as_str()), ("MetaRight", "de"));
    }

    /// Real engine run: downloads whisper-base (sha256-verified), speaks with `say`,
    /// transcribes WAV and AAC m4a. `cargo test -p freddai-native --lib voice -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_engine_transcribes_wav_and_m4a() {
        use std::{process::Command, time::{Duration, Instant}};
        let root = std::env::temp_dir().join(format!("freddai-voice-real-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        assert!(ready(&root).is_err(), "ready() must fail before enabling");

        let t = Instant::now();
        download_model(&root, "whisper-base").unwrap();
        loop {
            let st = status(&root);
            let m = st.models.iter().find(|m| m.id == "whisper-base").unwrap();
            if m.installed { break; }
            match &m.download {
                Some(d) if d.error.is_some() => panic!("download failed: {:?}", d.error),
                _ => {}
            }
            assert!(t.elapsed() < Duration::from_secs(600), "download timeout");
            std::thread::sleep(Duration::from_millis(500));
        }
        println!("download+sha256 verified in {:?}", t.elapsed());
        let st = update_settings(&root, SettingsPatch { active_model: Some("whisper-base".into()), enabled: Some(true), ..Default::default() }).unwrap();
        assert!(st.ready);
        assert_eq!(ready(&root).unwrap(), "whisper-base");

        let dir = std::path::PathBuf::from("/tmp/freddai-voice-test");
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("hello.wav");
        let m4a = dir.join("hello.m4a");
        let _ = std::fs::remove_file(&m4a);
        assert!(Command::new("say").args(["-o", wav.to_str().unwrap(), "--data-format=LEI16@16000", "Hello Freddai, this is a dictation test"]).status().unwrap().success());
        assert!(Command::new("afconvert").args(["-f", "m4af", "-d", "aac", "-b", "32000", wav.to_str().unwrap(), m4a.to_str().unwrap()]).status().unwrap().success());

        for f in [&wav, &m4a] {
            let t = Instant::now();
            let tr = transcribe_file(&root, f).unwrap();
            println!("{} -> {:?} in {:?}", f.display(), tr, t.elapsed());
            assert!(format!("{tr:?}").to_lowercase().contains("dictation"), "no 'dictation' in {tr:?}");
        }
        // Free the Metal context before process exit; ggml asserts in its static destructor otherwise.
        transcribe::unload("whisper-base");
        let _ = std::fs::remove_dir_all(&root);
    }
}
