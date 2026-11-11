//! Locating and talking to the bundled `bugwalk-helper` (ScreenCaptureKit region picker, recorder, frame grabber).

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const MIC_HINT: &str = "Grant Freddai Microphone permission in System Settings > Privacy & Security > Microphone, then quit and reopen Freddai.";
const RELATIVE: &str = "Resources/bug-walk/Freddai Bug Walk.app/Contents/MacOS/bugwalk-helper";
pub const MISSING: &str = "bugwalk-helper-missing: run scripts/build-bug-walk.sh";

/// Same rule as `computer_use::bundled_helper`: the executable must live in `<app>/Contents/MacOS`.
pub fn bundled(executable: &Path) -> Option<PathBuf> {
    let contents = executable.parent()?.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    Some(contents.join(RELATIVE))
}

fn dev_build() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../bug-walk/.build/Freddai Bug Walk.app/Contents/MacOS/bugwalk-helper")
}

pub fn locate() -> Result<PathBuf, String> {
    if let Some(p) = std::env::var_os("FREDDAI_BUGWALK_HELPER").map(PathBuf::from).filter(|p| p.is_file()) {
        return Ok(p);
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    bundled(&exe)
        .into_iter()
        .chain(std::iter::once(dev_build()).filter(|_| cfg!(debug_assertions)))
        .find(|p| p.is_file())
        .ok_or_else(|| MISSING.to_string())
}

pub fn permission_error(code: &str) -> Option<String> {
    match code {
        "screen-recording-permission" => Some(format!("screen-recording-permission: {}", crate::screen_grab::PERMISSION_HINT)),
        "microphone-permission" => Some(format!("microphone-permission: {MIC_HINT}")),
        _ => None,
    }
}

/// Turns the helper's stderr (JSON lines `{"error":..,"detail":..}`) into the user-facing error string.
pub fn error_from_stderr(stderr: &str, fallback: &str) -> String {
    for line in stderr.lines().rev() {
        let Ok(v) = serde_json::from_str::<Value>(line.trim()) else { continue };
        let Some(code) = v["error"].as_str() else { continue };
        if let Some(e) = permission_error(code) { return e; }
        return match v["detail"].as_str().filter(|d| !d.is_empty()) {
            Some(d) => format!("{code}: {d}"),
            None => code.to_string(),
        };
    }
    let t = stderr.trim();
    if t.is_empty() { fallback.to_string() } else { format!("{fallback}: {}", t.chars().take(300).collect::<String>()) }
}

/// Permission preflight (`status` never prompts). Err carries the structured permission error.
pub fn preflight(helper: &Path) -> Result<(), String> {
    let out = Command::new(helper).arg("status").stdin(Stdio::null()).output().map_err(|e| format!("Could not run bugwalk-helper: {e}"))?;
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("bugwalk-helper status was not JSON: {e}"))?;
    if v["screen_recording"] == Value::Bool(false) {
        return Err(permission_error("screen-recording-permission").unwrap());
    }
    if v["microphone"].as_str() == Some("denied") {
        return Err(permission_error("microphone-permission").unwrap());
    }
    Ok(())
}

/// Blocking. Grabs one cursor-visible PNG per time (same order as `times`) into `out`.
pub fn frames(helper: &Path, video: &Path, out: &Path, times: &[f64]) -> Result<Vec<PathBuf>, String> {
    let list = times.iter().map(|t| format!("{t:.2}")).collect::<Vec<_>>().join(",");
    let o = Command::new(helper)
        .arg("frames").arg("--video").arg(video).arg("--out").arg(out)
        .args(["--times", &list, "--max-width", "2560"])
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not run bugwalk-helper: {e}"))?;
    if !o.status.success() {
        return Err(error_from_stderr(&String::from_utf8_lossy(&o.stderr), "frame extraction failed"));
    }
    let line = String::from_utf8_lossy(&o.stdout).lines().rev().find(|l| l.trim_start().starts_with('{')).map(str::to_owned).ok_or("bugwalk-helper frames printed no JSON")?;
    let v: Value = serde_json::from_str(&line).map_err(|e| format!("bugwalk-helper frames output was not JSON: {e}"))?;
    let paths: Vec<PathBuf> = v["frames"].as_array().ok_or("bugwalk-helper frames output has no `frames`")?.iter().filter_map(|f| f["path"].as_str().map(PathBuf::from)).collect();
    if paths.len() != times.len() {
        return Err(format!("bugwalk-helper returned {} frames for {} requested times", paths.len(), times.len()));
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_location_mirrors_computer_use() {
        let p = bundled(Path::new("/Applications/Freddai.app/Contents/MacOS/freddai-native")).unwrap();
        assert_eq!(p, Path::new("/Applications/Freddai.app/Contents/Resources/bug-walk/Freddai Bug Walk.app/Contents/MacOS/bugwalk-helper"));
        assert!(bundled(Path::new("/tmp/target/debug/freddai-native")).is_none());
    }

    #[test]
    fn stderr_maps_to_structured_errors() {
        assert!(error_from_stderr("{\"error\":\"screen-recording-permission\"}\n", "x").starts_with("screen-recording-permission: Grant Freddai Screen Recording"));
        assert!(error_from_stderr("noise\n{\"error\":\"microphone-permission\"}", "x").starts_with("microphone-permission: Grant Freddai Microphone"));
        assert_eq!(error_from_stderr("{\"error\":\"disk\",\"detail\":\"full\"}", "x"), "disk: full");
        assert_eq!(error_from_stderr("", "boom"), "boom");
        assert_eq!(error_from_stderr("weird", "boom"), "boom: weird");
    }

    /// Real helper boundary (no interaction, no permissions): `--selftest` writes a synthetic mp4, `frames` must return PNGs.
    /// Run: `FREDDAI_BUGWALK_HELPER=<dev helper> cargo test bug_walk::helper -- --ignored`
    #[test]
    #[ignore]
    fn selftest_then_frames_roundtrip() {
        let helper = locate().expect("helper (build with scripts/build-bug-walk.sh)");
        let dir = std::env::temp_dir().join(format!("bugwalk-smoke-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let video = dir.join("selftest.mp4");
        let o = Command::new(&helper).arg("--selftest").arg(&video).output().unwrap();
        assert!(o.status.success(), "selftest failed: {}", String::from_utf8_lossy(&o.stderr));
        let frames = frames(&helper, &video, &dir.join("frames"), &[0.2, 1.0, 1.8]).unwrap();
        assert_eq!(frames.len(), 3);
        for f in &frames { assert!(std::fs::metadata(f).unwrap().len() > 100, "{f:?} empty"); }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
