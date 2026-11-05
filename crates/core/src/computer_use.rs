//! Session-local MCP wiring. Never edits account configuration or credentials.
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

fn bundled_helper(executable: &Path) -> Option<PathBuf> {
    let contents = executable.parent()?.parent()?;
    if contents.file_name()? != "Contents" {
        return None;
    }
    Some(
        contents
            .join("Resources/computer-use/Freddai Computer.app/Contents/MacOS/freddai-computer"),
    )
}

pub(crate) fn configure(command: &mut Command, provider: &str) {
    if !cfg!(target_os = "macos") {
        return;
    }
    let Some(helper) = std::env::current_exe()
        .ok()
        .and_then(|p| bundled_helper(&p))
        .filter(|p| p.is_file())
    else {
        return;
    };
    // The host cache is keyed by executable bytes. Embed a source fingerprint so
    // helper-only updates also produce a new host bundle instead of reusing old resources.
    command.env(
        "FREDDAI_COMPUTER_BUILD",
        format!(
            "{:x}",
            Sha256::digest(include_bytes!(
                "../../../apps/native/computer-use/main.swift"
            ))
        ),
    );
    add_args(command, provider, &helper);
}

fn add_args(command: &mut Command, provider: &str, helper: &Path) {
    let path = helper.to_string_lossy();
    match provider {
        "codex" => {
            // JSON string escaping is also valid for this TOML basic-string value.
            command.arg("-c").arg(format!(
                "mcp_servers.freddai_computer.command={}",
                json!(path)
            ));
        }
        "claude" => {
            command.arg("--mcp-config").arg(
                json!({"mcpServers":{"freddai_computer":{"command":path,"args":[]}}}).to_string(),
            );
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bundle_location_tracks_cached_hosts_and_installed_app() {
        for base in ["/Applications/Freddai.app", "/tmp/host-binaries/hash.app"] {
            let path =
                bundled_helper(&PathBuf::from(base).join("Contents/MacOS/freddai-native")).unwrap();
            assert!(path.starts_with(base));
            assert!(path.ends_with("Freddai Computer.app/Contents/MacOS/freddai-computer"));
        }
        assert!(bundled_helper(Path::new("/tmp/target/debug/freddai-native")).is_none());
    }
    #[test]
    fn injection_preserves_existing_arguments_and_quotes_paths() {
        let path = Path::new("/Apps/odd \" name.app/helper");
        let mut codex = Command::new("codex");
        codex.args(["app-server", "--stdio"]);
        add_args(&mut codex, "codex", path);
        let args: Vec<_> = codex
            .get_args()
            .map(|v| v.to_string_lossy().into_owned())
            .collect();
        assert_eq!(&args[..3], ["app-server", "--stdio", "-c"]);
        let parsed: toml_edit::DocumentMut = args[3].parse().unwrap();
        assert_eq!(
            parsed["mcp_servers"]["freddai_computer"]["command"].as_str(),
            path.to_str()
        );
        let mut claude = Command::new("claude");
        add_args(&mut claude, "claude", path);
        let args: Vec<_> = claude.get_args().collect();
        let value: serde_json::Value = serde_json::from_str(args[1].to_str().unwrap()).unwrap();
        assert_eq!(
            value["mcpServers"]["freddai_computer"]["command"],
            path.to_str().unwrap()
        );
    }
}
