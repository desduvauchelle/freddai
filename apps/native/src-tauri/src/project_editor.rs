//! Open registered project folders without interpreting paths as shell commands.
use std::{path::{Path, PathBuf}, process::{Command, Stdio}};
use freddai_core::runtime::Database;

fn executable(path: &Path) -> bool {
    #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; path.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0) }
    #[cfg(not(unix))] { path.is_file() }
}
fn vscode() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"));
        if let Some(home) = std::env::var_os("HOME") {
            candidates.push(PathBuf::from(home).join("Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"));
        }
        candidates.extend(["/opt/homebrew/bin/code", "/usr/local/bin/code"].map(PathBuf::from));
    }
    if let Some(path) = std::env::var_os("PATH") { candidates.extend(std::env::split_paths(&path).map(|dir| dir.join("code"))); }
    candidates.into_iter().find(|path| executable(path))
}
pub(crate) fn available() -> bool { vscode().is_some() }
pub(crate) fn open(db: &Database, id: &str) -> Result<(), String> {
    let project = db.projects.iter().find(|p| p.id == id).ok_or("Project unavailable")?;
    let folder = Path::new(&project.path).canonicalize().map_err(|_| "Project folder unavailable")?;
    if !folder.is_dir() { return Err("Project folder unavailable".into()); }
    let code = vscode().ok_or("VS Code is no longer available. Install it or add code to PATH.")?;
    let status = Command::new(code).arg("--new-window").arg(&folder)
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
        .status().map_err(|e| format!("Could not open VS Code: {e}"))?;
    if !status.success() { return Err("VS Code could not open the project folder".into()); }
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn rejects_unknown_project_before_launch() {
        assert_eq!(super::open(&Default::default(), "missing").unwrap_err(), "Project unavailable");
    }
}
