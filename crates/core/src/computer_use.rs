//! Discovery of the signed, bundled computer-use MCP helper.
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
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
pub(crate) fn helper(executable: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    bundled_helper(executable).filter(|p| p.is_file())
}
pub(crate) fn fingerprint() -> String {
    format!(
        "{:x}",
        Sha256::digest(include_bytes!(
            "../../../apps/native/computer-use/main.swift"
        ))
    )
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
}
