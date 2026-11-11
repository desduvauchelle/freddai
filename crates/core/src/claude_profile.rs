//! Copy a CLI login into an independent Claude credential namespace.
use std::{fs, path::Path};
use serde_json::Value;
use sha2::{Digest, Sha256};

fn service(home: Option<&Path>) -> String {
    let suffix = home.map(|p| format!("-{:x}", Sha256::digest(p.to_string_lossy().as_bytes()))[..9].to_owned()).unwrap_or_default();
    format!("Claude Code-credentials{suffix}")
}

pub(crate) fn copy(source: &Path, default: bool, target: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let credentials = {
        let user = std::env::var("USER").map_err(|_| "Cannot determine Claude Keychain account")?;
        match security_framework::passwords::get_generic_password(&service(if default { None } else { Some(source) }), &user) {
            Ok(bytes) => bytes,
            Err(e) if e.code() == -25300 => fs::read(source.join(".credentials.json")).map_err(|_| "No saved Claude subscription credentials found")?,
            Err(_) => return Err("Could not read Claude credentials from Keychain. Unlock your login Keychain and try again.".into()),
        }
    };
    #[cfg(not(target_os = "macos"))]
    let credentials = { let _ = default; fs::read(source.join(".credentials.json")).map_err(|_| "Could not read saved Claude credentials")? };
    validate(&credentials)?;
    crate::runtime::private_dir(target)?;
    // Only identity/onboarding metadata; never copy projects, history or executable settings.
    let config = if default { source.with_extension("json") } else { source.join(".claude.json") };
    let original: Value = fs::read(config).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut saved = serde_json::json!({"hasCompletedOnboarding":true});
    if let Some(identity) = original.get("oauthAccount") { saved["oauthAccount"] = identity.clone(); }
    fs::write(target.join(".claude.json"), serde_json::to_vec(&saved).unwrap()).map_err(|_| "Could not save Claude profile metadata")?;
    #[cfg(target_os = "macos")]
    {
        let user = std::env::var("USER").map_err(|_| "Cannot determine Claude Keychain account")?;
        security_framework::passwords::set_generic_password(&service(Some(target)), &user, &credentials).map_err(|_| "Could not save independent Claude credentials to Keychain")?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        use std::io::Write;
        let mut options = fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
        options.open(target.join(".credentials.json")).and_then(|mut f| f.write_all(&credentials)).map_err(|_| "Could not save private Claude credentials")?;
    }
    Ok(())
}
/// Preserve resume transcripts when converting an existing shared connection.
/// Copy regular files only; never follow links outside the CLI history directory.
pub(crate) fn copy_history(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() { return Ok(()); }
    crate::runtime::private_dir(target)?;
    for entry in fs::read_dir(source).map_err(|_| "Could not read Claude thread history")? {
        let entry = entry.map_err(|_| "Could not read Claude thread history")?;
        let kind = entry.file_type().map_err(|_| "Could not inspect Claude thread history")?;
        let destination = target.join(entry.file_name());
        if kind.is_dir() { copy_history(&entry.path(), &destination)?; }
        else if kind.is_file() { fs::copy(entry.path(), destination).map_err(|_| "Could not preserve Claude thread history")?; }
        else { return Err("Claude history contains a link or special file; the original connection has been kept.".into()); }
    }
    Ok(())
}

fn validate(bytes: &[u8]) -> Result<(), String> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| "Claude credentials are not valid JSON")?;
    let oauth = &value["claudeAiOauth"];
    if ["accessToken", "refreshToken"].iter().any(|k| oauth[k].as_str().is_none_or(str::is_empty)) {
        return Err("No renewable Claude subscription login found. Sign in to Claude in Terminal, then try again.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preserves_history_as_independent_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let source = root.join("source/project");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("session.jsonl"), "synthetic history").unwrap();
        copy_history(&root.join("source"), &root.join("saved")).unwrap();
        fs::write(source.join("session.jsonl"), "changed").unwrap();
        assert_eq!(fs::read_to_string(root.join("saved/project/session.jsonl")).unwrap(), "synthetic history");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn namespace_is_independent_and_matches_claude() {
        assert_eq!(service(None), "Claude Code-credentials");
        assert_eq!(service(Some(Path::new("/tmp/profile"))), format!("Claude Code-credentials-{}", &format!("{:x}", Sha256::digest(b"/tmp/profile"))[..8]));
        assert_ne!(service(Some(Path::new("/tmp/second"))), service(Some(Path::new("/tmp/profile"))));
    }
    #[test]
    fn refuses_missing_or_nonrenewable_credentials_without_disclosing_them() {
        assert!(validate(br#"{"claudeAiOauth":{"accessToken":"synthetic","refreshToken":"synthetic"}}"#).is_ok());
        assert!(validate(br#"{"claudeAiOauth":{"accessToken":"synthetic"}}"#).is_err());
        assert!(!validate(b"secret-invalid").unwrap_err().contains("secret-invalid"));
    }
}
