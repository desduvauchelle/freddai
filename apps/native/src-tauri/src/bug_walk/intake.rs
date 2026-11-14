//! Companion intake: an iPhone uploads a screen recording, the companion server writes a walk dir
//! (`<root>/bug-walks/<id>/{recording.*, walk.json, send.json}`, send.json last). This loop notices it, prepares the
//! audio and size, and runs the normal bug walk pipeline. The outcome stays in walk.json for the phone to poll.

use super::{helper, read_walk, update_walk, walks_root, Host, Mode, SendOpts, Walk};
use serde_json::json;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::AppHandle;

const POLL: Duration = Duration::from_secs(2);
const KEEP_FINISHED_S: u64 = 24 * 3600;
const CLAIMED: &str = "send.taken.json";

fn log_failed(id: &str, error: &str) {
    eprintln!("{}", json!({"event":"bug_walk.companion_intake_failed","id":id,"error":error}));
}

/// A walk ready for intake: `send.json` present, walk.json says companion + stopped.
fn is_ready(dir: &Path) -> bool {
    dir.join("send.json").is_file() && read_walk(dir).is_ok_and(|w| w.source.as_deref() == Some("companion") && w.phase == "stopped")
}

/// Atomically claims a ready walk (send.json -> send.taken.json) and returns its options.
/// `Ok(None)`: not ours / not ready / someone else claimed it.
fn claim(dir: &Path) -> Result<Option<SendOpts>, String> {
    if !is_ready(dir) { return Ok(None); }
    let taken = dir.join(CLAIMED);
    if let Err(e) = fs::rename(dir.join("send.json"), &taken) {
        // NotFound means another poll claimed it first; anything else is a real I/O problem and must not stay silent.
        if e.kind() == std::io::ErrorKind::NotFound { return Ok(None); }
        return Err(format!("could not claim send.json: {e}"));
    }
    let bytes = fs::read(&taken).map_err(|e| format!("could not read {CLAIMED}: {e}"))?;
    serde_json::from_slice(&bytes).map(Some).map_err(|e| format!("send.json is invalid: {e}"))
}

fn video_in(dir: &Path) -> Option<PathBuf> {
    ["recording.mov", "recording.mp4"].iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// Extracts audio.wav and records duration and pixel size in walk.json.
fn prepare(dir: &Path, helper_bin: &Path) -> Result<(), String> {
    let video = video_in(dir).ok_or("the uploaded recording is missing")?;
    let info = helper::audio(helper_bin, &video, &dir.join("audio.wav"))?;
    update_walk(dir, |w| {
        w.duration_s = Some(info.duration_s);
        w.region.width = info.width;
        w.region.height = info.height;
        w.region.scale = 1.0;
    });
    Ok(())
}

/// Heavy artifacts are dropped once a companion walk is finished; walk.json (and nothing else) stays.
pub(super) fn strip_artifacts(dir: &Path) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if e.file_name() == "walk.json" { continue; }
        let r = if p.is_dir() { fs::remove_dir_all(&p) } else { fs::remove_file(&p) };
        if let Err(e) = r {
            eprintln!("{}", json!({"event":"bug_walk.cleanup_failed","path":p.to_string_lossy(),"error":e.to_string()}));
        }
    }
}

/// Removes finished (done/error) companion walks older than 24 h. Returns the removed ids.
fn sweep(root: &Path, now: u64) -> Vec<String> {
    let Ok(entries) = fs::read_dir(walks_root(root)) else { return vec![] };
    let mut removed = vec![];
    for e in entries.flatten() {
        let dir = e.path();
        let Ok(w) = read_walk(&dir) else { continue };
        if w.source.as_deref() != Some("companion") || !matches!(w.phase.as_str(), "done" | "error") { continue; }
        if now.saturating_sub(w.started_at) < KEEP_FINISHED_S { continue; }
        if fs::remove_dir_all(&dir).is_ok() { removed.push(e.file_name().to_string_lossy().to_string()); }
    }
    removed
}

fn fail_walk(app: &AppHandle, dir: &Path, id: &str, error: &str) {
    log_failed(id, error);
    update_walk(dir, |w: &mut Walk| { w.phase = "error".into(); w.reason = Some(error.to_string()); });
    super::emit(app, super::StatePayload { error: Some(error.to_string()), ..super::state(id, "error") });
}

fn ready_dirs(root: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(walks_root(root)) else { return vec![] };
    entries.flatten().map(|e| e.path()).filter(|d| is_ready(d)).collect()
}

async fn take(app: &AppHandle, host: &Host, dir: PathBuf) {
    let id = dir.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let opts = match claim(&dir) {
        Ok(Some(o)) => o,
        Ok(None) => return,
        Err(e) => return fail_walk(app, &dir, &id, &e),
    };
    eprintln!("{}", json!({"event":"bug_walk.companion_intake","id":id,"project":opts.project}));
    let d = dir.clone();
    let prep = tauri::async_runtime::spawn_blocking(move || {
        let bin = helper::locate()?;
        prepare(&dir, &bin)
    }).await;
    match prep {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return fail_walk(app, &d, &id, &e),
        Err(e) => return fail_walk(app, &d, &id, &e.to_string()),
    }
    if let Err(e) = super::begin_send(app, host, &id, &opts) { return fail_walk(app, &d, &id, &e); }
    super::spawn_pipeline(app.clone(), host.clone(), id, opts, Mode::Analysis);
}

pub fn start(app: AppHandle, host: Host) {
    tauri::async_runtime::spawn(async move {
        let removed = sweep(&host.root, super::now_s());
        if !removed.is_empty() { eprintln!("{}", json!({"event":"bug_walk.companion_swept","ids":removed})); }
        loop {
            for dir in ready_dirs(&host.root) { take(&app, &host, dir).await; }
            tokio::time::sleep(POLL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bug_walk::{write_walk, Origin, Region};

    fn seed(root: &Path, id: &str, source: Option<&str>, phase: &str, started: u64, send: bool) -> PathBuf {
        let dir = walks_root(root).join(id);
        fs::create_dir_all(&dir).unwrap();
        let w = Walk {
            id: id.into(), started_at: started, origin: Origin::default(), region: Region::default(), duration_s: None,
            phase: phase.into(), pid: None, reason: None, source: source.map(Into::into), sessions: None,
        };
        write_walk(&dir, &w).unwrap();
        if send {
            fs::write(dir.join("send.json"), br#"{"project":"p","permission_mode":"ask"}"#).unwrap();
        }
        dir
    }

    fn tmp(name: &str) -> PathBuf {
        let r = std::env::temp_dir().join(format!("bugwalk-intake-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&r);
        r
    }

    #[test]
    fn claim_renames_send_json_once() {
        let root = tmp("claim");
        let dir = seed(&root, "a", Some("companion"), "stopped", 1, true);
        let opts = claim(&dir).unwrap().expect("claimed");
        assert_eq!(opts.project, "p");
        assert_eq!(opts.split, "single");
        assert!(!dir.join("send.json").exists() && dir.join(CLAIMED).exists());
        assert!(claim(&dir).unwrap().is_none(), "second claim must not succeed");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn ignores_non_companion_wrong_phase_and_missing_send() {
        let root = tmp("ignore");
        let mac = seed(&root, "mac", None, "stopped", 1, true);
        let busy = seed(&root, "busy", Some("companion"), "transcribing", 1, true);
        let unsent = seed(&root, "unsent", Some("companion"), "stopped", 1, false);
        for d in [&mac, &busy, &unsent] { assert!(claim(d).unwrap().is_none()); }
        assert!(mac.join("send.json").exists() && busy.join("send.json").exists());
        let ok = seed(&root, "ok", Some("companion"), "stopped", 1, true);
        assert_eq!(ready_dirs(&root), vec![ok]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn invalid_send_json_is_loud() {
        let root = tmp("badsend");
        let dir = seed(&root, "a", Some("companion"), "stopped", 1, false);
        fs::write(dir.join("send.json"), b"{nope").unwrap();
        assert!(claim(&dir).unwrap_err().contains("send.json is invalid"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn sweep_removes_only_old_finished_companion_walks() {
        let root = tmp("sweep");
        let now = 10 * KEEP_FINISHED_S;
        let old_done = seed(&root, "old-done", Some("companion"), "done", now - KEEP_FINISHED_S - 1, false);
        let old_err = seed(&root, "old-err", Some("companion"), "error", 5, false);
        let fresh = seed(&root, "fresh", Some("companion"), "done", now - 60, false);
        let old_stopped = seed(&root, "old-stopped", Some("companion"), "stopped", 5, true);
        let old_mac = seed(&root, "old-mac", None, "error", 5, false);
        let mut removed = sweep(&root, now);
        removed.sort();
        assert_eq!(removed, vec!["old-done", "old-err"]);
        assert!(!old_done.exists() && !old_err.exists());
        assert!(fresh.exists() && old_stopped.exists() && old_mac.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn strip_keeps_only_walk_json() {
        let root = tmp("strip");
        let dir = seed(&root, "a", Some("companion"), "done", 1, false);
        for f in ["recording.mov", "audio.wav", "report.md"] { fs::write(dir.join(f), b"x").unwrap(); }
        fs::create_dir_all(dir.join("frames")).unwrap();
        fs::write(dir.join("frames/1.png"), b"x").unwrap();
        strip_artifacts(&dir);
        let left: Vec<_> = fs::read_dir(&dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().to_string()).collect();
        assert_eq!(left, vec!["walk.json"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn header_only_wav_counts_as_no_audio() {
        let root = tmp("wav");
        let dir = seed(&root, "a", Some("companion"), "stopped", 1, false);
        assert!(!crate::bug_walk::wav_is_empty(&dir), "no wav file at all is not 'empty audio'");
        fs::write(dir.join("audio.wav"), vec![0u8; 44]).unwrap();
        assert!(crate::bug_walk::wav_is_empty(&dir));
        fs::write(dir.join("audio.wav"), vec![0u8; 44 + 3200]).unwrap();
        assert!(!crate::bug_walk::wav_is_empty(&dir));
        let _ = fs::remove_dir_all(&root);
    }
}
