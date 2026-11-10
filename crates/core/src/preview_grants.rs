//! Preview shares recorded by the `freddai_share_preview` MCP tool.
//!
//! The MCP tool runs in the background host (`--host`), but the preview grant check runs in the
//! separate `--companion-server` process, so grants cross the process boundary as a small
//! owner-only file in the workspace: `companion/preview-grants.json`. The companion server
//! imports unexpired entries into its in-memory grants (`preview_host::grant_port`), which applies
//! the port rules again. Entries expire after 12 h.
use serde_json::{json, Value};
use std::{fs, io::Write, os::unix::fs::OpenOptionsExt, path::{Path, PathBuf}};

pub const TTL_SECS: u64 = 12 * 3600;
/// Companion HTTPS listener; never shareable.
pub const COMPANION_PORT: u16 = 49744;

fn file(root: &Path) -> PathBuf { root.join("companion").join("preview-grants.json") }
fn now() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

/// Cheap checks the host can make; the companion server re-checks (including Freddai listeners).
pub fn check_port(port: u64) -> Result<u16, String> {
    let port = u16::try_from(port).map_err(|_| format!("port {port} is out of range"))?;
    if port < 1024 { return Err(format!("port {port} is below 1024")); }
    if port == COMPANION_PORT { return Err(format!("port {port} is a Freddai port")); }
    Ok(port)
}

fn read(root: &Path, now: u64) -> Vec<(u16, u64)> {
    let Ok(text) = fs::read_to_string(file(root)) else { return vec![] };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text) else { return vec![] };
    items.iter().filter_map(|v| Some((u16::try_from(v["port"].as_u64()?).ok()?, v["expires"].as_u64()?))).filter(|(_, e)| *e > now).collect()
}

/// Records a share (replacing any earlier one for the port).
pub fn record(root: &Path, port: u16) -> Result<(), String> {
    let dir = root.join("companion");
    fs::create_dir_all(&dir).map_err(|e| format!("Cannot record preview share: {e}"))?;
    let lock = fs::OpenOptions::new().create(true).truncate(false).write(true).mode(0o600).open(dir.join("preview-grants.lock")).map_err(|e| format!("Cannot record preview share: {e}"))?;
    fs2::FileExt::lock_exclusive(&lock).map_err(|e| format!("Cannot record preview share: {e}"))?;
    let now = now();
    let mut entries: Vec<_> = read(root, now).into_iter().filter(|(p, _)| *p != port).collect();
    entries.push((port, now + TTL_SECS));
    let body = json!(entries.iter().map(|(p, e)| json!({"port": p, "expires": e, "source": "mcp"})).collect::<Vec<_>>()).to_string();
    let path = file(root);
    let tmp = path.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut f = fs::OpenOptions::new().create_new(true).write(true).mode(0o600).open(&tmp)?;
        f.write_all(body.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, &path)
    })();
    result.map_err(|e| { let _ = fs::remove_file(&tmp); format!("Cannot record preview share: {e}") })
}

/// Ports with an unexpired share, for the companion server to import.
pub fn active(root: &Path) -> Vec<u16> { read(root, now()).into_iter().map(|(p, _)| p).collect() }

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn records_replaces_and_expires() {
        let root = std::env::temp_dir().join(format!("freddai-pg-{}", uuid::Uuid::new_v4()));
        assert!(active(&root).is_empty());
        record(&root, 3000).unwrap();
        record(&root, 5173).unwrap();
        record(&root, 3000).unwrap();
        let mut ports = active(&root);
        ports.sort();
        assert_eq!(ports, vec![3000, 5173]);
        fs::write(file(&root), r#"[{"port":3000,"expires":1}]"#).unwrap();
        assert!(active(&root).is_empty());
        assert!(check_port(80).is_err() && check_port(COMPANION_PORT as u64).is_err() && check_port(70000).is_err());
        assert_eq!(check_port(3000), Ok(3000));
        let _ = fs::remove_dir_all(root);
    }
}
