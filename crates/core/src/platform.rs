//! Desktop OS boundaries shared by CLI discovery, account configuration and process launch.
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

pub fn home_dir() -> Option<PathBuf> {
    home_from_env(|key| std::env::var_os(key))
}
pub(crate) fn home_from_env(get: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    #[cfg(windows)]
    if let Some(home) = get("USERPROFILE") {
        return Some(home.into());
    }
    get("HOME").map(PathBuf::from)
}
pub fn cli_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(unix)]
    dirs.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(home) = home_dir() {
        dirs.extend([
            home.join(".local/bin"),
            home.join(".opencode/bin"),
            home.join(".cursor/bin"),
        ]);
        #[cfg(windows)]
        dirs.push(home.join("scoop/shims"));
    }
    #[cfg(windows)]
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        dirs.extend(std::env::split_paths(&path));
    }
    dirs
}
pub fn cli_path() -> Result<OsString, String> {
    std::env::join_paths(cli_dirs()).map_err(|e| e.to_string())
}
pub(crate) fn executable_in(
    name: &str,
    dirs: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    #[cfg(windows)]
    let suffixes = [".exe", ".cmd", ".bat", ".com"];
    #[cfg(not(windows))]
    let suffixes = [""];
    dirs.into_iter()
        .flat_map(|dir| suffixes.map(|ext| dir.join(format!("{name}{ext}"))))
        .find(|p| is_executable(p))
}
pub(crate) fn is_executable(p: &Path) -> bool {
    let Ok(meta) = p.metadata() else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

pub fn quiet_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_console(&mut command);
    command
}
pub fn hide_console(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(not(windows))]
    let _ = command;
}

/// Launch interactive sign-in in its own Windows console; values are PowerShell literal strings,
/// and the entire script is UTF-16 encoded, so paths never become cmd.exe shell text.
#[cfg(windows)]
pub(crate) fn interactive_login(
    executable: &Path,
    home: &Path,
    env_key: &str,
    remove: &[&str],
    args: &[&str],
) -> Result<(), String> {
    use base64::Engine;
    use std::os::windows::process::CommandExt;
    fn literal(s: &str) -> String {
        format!("'{}'", s.replace('\'', "''"))
    }
    let mut script = String::from("$ErrorActionPreference = 'Stop'; ");
    for key in remove {
        script.push_str(&format!(
            "[Environment]::SetEnvironmentVariable({}, $null, 'Process'); ",
            literal(key)
        ));
    }
    script.push_str(&format!("[Environment]::SetEnvironmentVariable({}, {}, 'Process'); & {} {}; Write-Host 'Return to Freddai and choose Check sign-in.'; Read-Host 'Press Enter to close'",
        literal(env_key), literal(&home.to_string_lossy()), literal(&executable.to_string_lossy()), args.iter().map(|s|literal(s)).collect::<Vec<_>>().join(" ")));
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    let mut cmd = Command::new("powershell.exe");
    cmd.args([
        "-NoProfile",
        "-EncodedCommand",
        &base64::engine::general_purpose::STANDARD.encode(bytes),
    ])
    .env("PATH", cli_path()?)
    .creation_flags(0x00000010);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Cannot open sign-in terminal: {e}"))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn discovery_uses_platform_extensions_and_skips_directories() {
        let root = std::env::temp_dir().join(format!("freddai-discovery-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("codex.exe")).unwrap();
        let name = if cfg!(windows) { "codex.cmd" } else { "codex" };
        let file = root.join(name);
        std::fs::write(&file, "fixture").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
        assert_eq!(executable_in("codex", [root.clone()]), Some(file));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn path_roundtrips_without_unix_separators_on_windows() {
        assert_eq!(
            std::env::split_paths(&cli_path().unwrap()).collect::<Vec<_>>(),
            cli_dirs()
        );
    }
    #[cfg(windows)]
    #[test]
    fn windows_home_does_not_require_home_environment_variable() {
        assert_eq!(
            home_from_env(|key| (key == "USERPROFILE").then(|| OsString::from(r"C:\Users\A User"))),
            Some(PathBuf::from(r"C:\Users\A User"))
        );
    }

    #[cfg(windows)]
    #[test]
    fn npm_style_cmd_shim_preserves_argument_boundaries() {
        let root = std::env::temp_dir().join(format!("freddai shim {}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let script = root.join("arguments.py");
        std::fs::write(&script, "import json,sys\nprint(json.dumps(sys.argv[1:]))\n").unwrap();
        let shim = root.join("fixture.cmd");
        std::fs::write(&shim, format!("@echo off\r\npython3 \"{}\" %*\r\n", script.display())).unwrap();
        let args = ["prompt with spaces", "a&b|c<d>e", "quoted \"value\"", "Unicode café"];
        let output = quiet_command(&shim).args(args).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let actual: Vec<String> = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(actual, args);
        std::fs::remove_dir_all(root).unwrap();
    }
}
