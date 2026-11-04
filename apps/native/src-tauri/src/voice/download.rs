//! Model files on disk and background downloads (`.partial` + Range resume + sha256).

use super::{registry::{self, ModelDef}, settings};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadState {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub error: Option<String>,
    #[serde(skip)]
    pub active: bool,
}

struct Entry {
    state: DownloadState,
    cancel: Arc<AtomicBool>,
}

static DOWNLOADS: Mutex<Option<HashMap<String, Entry>>> = Mutex::new(None);

fn with_map<R>(f: impl FnOnce(&mut HashMap<String, Entry>) -> R) -> R {
    let mut g = DOWNLOADS.lock().unwrap_or_else(|p| p.into_inner());
    f(g.get_or_insert_with(HashMap::new))
}

pub fn model_dir(root: &Path, id: &str) -> PathBuf {
    settings::voice_dir(root).join("models").join(id)
}
pub fn model_path(root: &Path, m: &ModelDef) -> PathBuf {
    model_dir(root, m.id).join(m.file)
}
fn partial_path(root: &Path, m: &ModelDef) -> PathBuf {
    model_dir(root, m.id).join(format!("{}.partial", m.file))
}

/// Installed = file exists with the exact expected size (sha256 was verified at download time).
pub fn is_installed(root: &Path, m: &ModelDef) -> bool {
    fs::metadata(model_path(root, m)).map(|md| md.len() == m.size_bytes).unwrap_or(false)
}

pub fn download_state(id: &str) -> Option<DownloadState> {
    with_map(|m| m.get(id).map(|e| e.state.clone()))
}

pub fn start(root: &Path, id: &str) -> Result<(), String> {
    let m = registry::find(id).ok_or_else(|| format!("Unknown voice model \"{id}\""))?;
    if is_installed(root, m) {
        return Ok(());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    let already = with_map(|map| {
        if map.get(id).map(|e| e.state.active).unwrap_or(false) {
            return true;
        }
        map.insert(id.to_string(), Entry {
            state: DownloadState { downloaded_bytes: 0, total_bytes: m.size_bytes, error: None, active: true },
            cancel: cancel.clone(),
        });
        false
    });
    if already {
        return Ok(());
    }
    let root = root.to_path_buf();
    std::thread::Builder::new()
        .name(format!("voice-download-{id}"))
        .spawn(move || {
            let result = run(&root, m, &cancel);
            match result {
                Ok(true) => with_map(|map| { map.remove(m.id); }),
                Ok(false) => with_map(|map| { map.remove(m.id); }), // cancelled
                Err(error) => {
                    eprintln!("voice.download.failed id={} error={}", m.id, error);
                    with_map(|map| {
                        if let Some(e) = map.get_mut(m.id) {
                            e.state.error = Some(error);
                            e.state.active = false;
                        }
                    });
                }
            }
        })
        .map_err(|e| format!("Could not start download thread: {e}"))?;
    Ok(())
}

pub fn cancel(root: &Path, id: &str) -> Result<(), String> {
    let m = registry::find(id).ok_or_else(|| format!("Unknown voice model \"{id}\""))?;
    let was_active = with_map(|map| match map.get(id) {
        Some(e) if e.state.active => { e.cancel.store(true, Ordering::SeqCst); true }
        Some(_) => { map.remove(id); false }
        None => false,
    });
    if !was_active {
        let _ = fs::remove_file(partial_path(root, m));
    }
    // An active thread deletes its own partial on observing the flag.
    Ok(())
}

pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    let m = registry::find(id).ok_or_else(|| format!("Unknown voice model \"{id}\""))?;
    cancel(root, id)?;
    match fs::remove_dir_all(model_dir(root, m.id)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Could not delete {}: {e}", m.name)),
    }
}

fn set_progress(id: &str, downloaded: u64) {
    with_map(|map| {
        if let Some(e) = map.get_mut(id) {
            e.state.downloaded_bytes = downloaded;
        }
    });
}

/// Ok(true) = installed, Ok(false) = cancelled.
fn run(root: &Path, m: &'static ModelDef, cancel: &AtomicBool) -> Result<bool, String> {
    let dir = model_dir(root, m.id);
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create model folder: {e}"))?;
    let partial = partial_path(root, m);
    let mut have = fs::metadata(&partial).map(|md| md.len()).unwrap_or(0);
    if have > m.size_bytes {
        let _ = fs::remove_file(&partial);
        have = 0;
    }
    if have < m.size_bytes {
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(20))
            .timeout(None)
            .build()
            .map_err(|e| format!("HTTP client error: {e}"))?;
        let mut req = client.get(m.url);
        if have > 0 {
            req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
        }
        let mut resp = req.send().map_err(|e| format!("Download request failed: {e}"))?;
        let status = resp.status();
        let mut file = if status == reqwest::StatusCode::PARTIAL_CONTENT && have > 0 {
            OpenOptions::new().append(true).open(&partial)
        } else if status.is_success() {
            have = 0; // server ignored Range: start over
            File::create(&partial)
        } else {
            return Err(format!("Download failed: HTTP {status} from {}", m.url));
        }
        .map_err(|e| format!("Could not open partial file: {e}"))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut downloaded = have;
        set_progress(m.id, downloaded);
        loop {
            if cancel.load(Ordering::SeqCst) {
                drop(file);
                let _ = fs::remove_file(&partial);
                return Ok(false);
            }
            let n = resp.read(&mut buf).map_err(|e| format!("Download interrupted: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| format!("Could not write model file: {e}"))?;
            downloaded += n as u64;
            set_progress(m.id, downloaded);
        }
        file.flush().map_err(|e| e.to_string())?;
    }
    let size = fs::metadata(&partial).map(|md| md.len()).unwrap_or(0);
    if size != m.size_bytes {
        return Err(format!("Download incomplete: got {size} of {} bytes — try again to resume", m.size_bytes));
    }
    let digest = sha256_file(&partial, cancel)?;
    let Some(digest) = digest else {
        let _ = fs::remove_file(&partial);
        return Ok(false);
    };
    if digest != m.sha256 {
        let _ = fs::remove_file(&partial);
        return Err(format!("Checksum mismatch for {} (expected {}, got {digest}); partial file discarded", m.file, m.sha256));
    }
    fs::rename(&partial, model_path(root, m)).map_err(|e| format!("Could not install model: {e}"))?;
    if let Err(e) = settings::modify(root, |s| {
        if s.active_model.is_none() {
            s.active_model = Some(m.id.to_string());
        }
        Ok(())
    }) {
        eprintln!("voice.download.settings_failed id={} error={}", m.id, e);
    }
    Ok(true)
}

/// None when cancelled mid-hash.
fn sha256_file(path: &Path, cancel: &AtomicBool) -> Result<Option<String>, String> {
    let mut f = File::open(path).map_err(|e| format!("Could not read model for verification: {e}"))?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let n = f.read(&mut buf).map_err(|e| format!("Verification read failed: {e}"))?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(Some(hex::encode(h.finalize())))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installed_requires_exact_size_and_unknown_id_errors() {
        let root = settings::test_root("dl");
        let m = registry::find("whisper-base").unwrap();
        assert!(!is_installed(&root, m));
        fs::create_dir_all(model_dir(&root, m.id)).unwrap();
        fs::write(model_path(&root, m), b"short").unwrap();
        assert!(!is_installed(&root, m));
        assert!(start(&root, "nope").is_err());
        assert!(delete(&root, "whisper-base").is_ok());
        assert!(!model_path(&root, m).exists());
    }

    #[test]
    fn sha256_helper_matches_known_digest() {
        let root = settings::test_root("sha");
        let p = root.join("f");
        fs::write(&p, b"abc").unwrap();
        let d = sha256_file(&p, &AtomicBool::new(false)).unwrap().unwrap();
        assert_eq!(d, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
