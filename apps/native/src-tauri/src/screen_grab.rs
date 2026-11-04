//! Interactive screen grab through macOS `screencapture`. The PNG is only a temp file: the caller stages it
//! through the normal attachment import and then removes the directory.
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

pub const PERMISSION_HINT: &str = "Grant Freddai Screen Recording permission in System Settings > Privacy & Security > Screen Recording, then quit and reopen Freddai.";
const PNG_MAGIC: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];

#[derive(Debug, PartialEq)]
pub enum Outcome {
    Captured,
    Cancelled,
    Failed(String),
}

/// Decide what a finished `screencapture` run means. Esc exits 0 without writing a file (or leaves it empty).
pub fn classify(exit_ok: bool, status: &str, stderr: &str, size: Option<u64>, head: &[u8]) -> Outcome {
    if !exit_ok {
        let detail = stderr.trim();
        return Outcome::Failed(format!(
            "screencapture failed ({status}){}. {PERMISSION_HINT}",
            if detail.is_empty() { String::new() } else { format!(": {detail}") }
        ));
    }
    match size {
        None | Some(0) => Outcome::Cancelled,
        Some(_) if head.starts_with(&PNG_MAGIC) => Outcome::Captured,
        Some(_) => Outcome::Failed(format!("screencapture produced a file that is not a PNG. {PERMISSION_HINT}")),
    }
}

#[cfg(target_os = "macos")]
mod access {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        pub fn CGPreflightScreenCaptureAccess() -> bool;
        pub fn CGRequestScreenCaptureAccess() -> bool;
    }
}

/// Screen Recording permission is checked up front: without it screencapture silently returns wallpaper only.
#[cfg(target_os = "macos")]
fn permission_granted() -> bool {
    // SAFETY: plain CoreGraphics queries with no arguments.
    unsafe {
        if access::CGPreflightScreenCaptureAccess() {
            return true;
        }
        // Shows the system prompt (and adds Freddai to the Screen Recording list) the first time.
        access::CGRequestScreenCaptureAccess();
        false
    }
}

#[cfg(not(target_os = "macos"))]
fn permission_granted() -> bool {
    true
}

pub fn event(name: &str, detail: &str) {
    eprintln!("{}", serde_json::json!({"event": name, "detail": detail}));
}

pub fn capture(png: &Path) -> Outcome {
    if !cfg!(target_os = "macos") {
        return Outcome::Failed("Screen grab is only available on macOS.".into());
    }
    if !permission_granted() {
        return Outcome::Failed(format!("Screen Recording permission is not granted. {PERMISSION_HINT}"));
    }
    let output = match Command::new("/usr/sbin/screencapture").args(["-i", "-x"]).arg(png).output() {
        Ok(output) => output,
        Err(e) => return Outcome::Failed(format!("Could not run screencapture: {e}. {PERMISSION_HINT}")),
    };
    let size = fs::metadata(png).ok().map(|m| m.len());
    let head = fs::read(png).map(|b| b.into_iter().take(8).collect::<Vec<u8>>()).unwrap_or_default();
    classify(
        output.status.success(),
        &output.status.to_string(),
        &String::from_utf8_lossy(&output.stderr),
        size,
        &head,
    )
}

/// Private temp directory holding one capture; removed by the caller.
pub fn temp_dir() -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("freddai-screen-grab-{}-{stamp}", std::process::id()));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}

pub fn file_name() -> String {
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!("screen-grab-{secs}.png")
}

#[cfg(test)]
mod tests {
    use super::*;

    const PNG: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

    #[test]
    fn escape_is_a_cancel() {
        assert_eq!(classify(true, "exit status: 0", "", None, &[]), Outcome::Cancelled);
        assert_eq!(classify(true, "exit status: 0", "", Some(0), &[]), Outcome::Cancelled);
    }

    #[test]
    fn png_is_captured() {
        assert_eq!(classify(true, "exit status: 0", "", Some(10), PNG), Outcome::Captured);
    }

    #[test]
    fn nonzero_exit_is_a_loud_failure_with_the_permission_hint() {
        match classify(false, "exit status: 1", "could not create image", None, &[]) {
            Outcome::Failed(m) => assert!(m.contains("could not create image") && m.contains("Screen Recording")),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn non_png_is_a_failure() {
        assert!(matches!(classify(true, "ok", "", Some(4), b"junk"), Outcome::Failed(_)));
    }
}
