//! Per-user login startup; no administrator access or machine-wide service.
use std::path::Path;
const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
pub fn enabled() -> bool {
    freddai_core::platform::quiet_command("reg.exe")
        .args(["query", KEY, "/v", "FreddaiHost"])
        .output()
        .is_ok_and(|out| out.status.success())
}
pub fn configure(binary: &Path, root: &Path, enabled: bool) -> Result<(), String> {
    if !enabled && !self::enabled() {
        return Ok(());
    }
    let mut cmd = freddai_core::platform::quiet_command("reg.exe");
    if enabled {
        // Windows paths cannot contain quotes. Both are full paths from the app data directory.
        let value = format!("\"{}\" --host \"{}\"", binary.display(), root.display());
        cmd.args([
            "add",
            KEY,
            "/v",
            "FreddaiHost",
            "/t",
            "REG_SZ",
            "/d",
            &value,
            "/f",
        ]);
    } else {
        cmd.args(["delete", KEY, "/v", "FreddaiHost", "/f"]);
    }
    let result = cmd.output().map_err(|e| e.to_string())?;
    if result.status.success() {
        Ok(())
    } else {
        Err(format!(
            "Cannot change startup setting: {}",
            String::from_utf8_lossy(&result.stderr)
        ))
    }
}
