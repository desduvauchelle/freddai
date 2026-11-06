//! Serves a user-referenced local HTML file (and its sibling assets) to the unprivileged browser
//! panel through a private, token-addressed scheme. Pages get no scripts and no network (CSP sandbox).
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Mutex, OnceLock}};
use tauri::http::{Response, StatusCode};

pub const SCHEME: &str = "freddai-preview";
const MAX_BYTES: u64 = 25 * 1024 * 1024;
const MAX_TOKENS: usize = 256;
static TOKENS: OnceLock<Mutex<HashMap<String, PathBuf>>> = OnceLock::new();
fn tokens() -> &'static Mutex<HashMap<String, PathBuf>> { TOKENS.get_or_init(Default::default) }

fn encode(name: &str) -> String {
    name.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}
fn decode(value: &str) -> Option<String> {
    let mut out = Vec::new();
    let mut bytes = value.bytes();
    while let Some(b) = bytes.next() {
        if b == b'%' {
            let hi = bytes.next()?; let lo = bytes.next()?;
            out.push(u8::from_str_radix(std::str::from_utf8(&[hi, lo]).ok()?, 16).ok()?);
        } else { out.push(b); }
    }
    String::from_utf8(out).ok()
}
/// Registers an already-validated HTML file and returns the URL the browser panel may load.
pub fn register(path: &Path) -> Result<String, String> {
    let path = path.canonicalize().map_err(|_| "File unavailable on your Mac".to_string())?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !path.is_file() || !matches!(ext.as_str(), "html" | "htm") { return Err("Only HTML files can open in the browser panel".into()); }
    let root = path.parent().ok_or("File has no folder")?.to_path_buf();
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("Invalid file name")?.to_string();
    let token = hex::encode(rand::random::<[u8; 16]>());
    let mut map = tokens().lock().map_err(|_| "Preview registry unavailable".to_string())?;
    if map.len() >= MAX_TOKENS { map.clear(); }
    map.insert(token.clone(), root);
    Ok(format!("{SCHEME}://localhost/{token}/{}", encode(&name)))
}
fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase().as_str() {
        "html" | "htm" => "text/html; charset=utf-8", "css" => "text/css", "png" => "image/png", "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif", "webp" => "image/webp", "svg" => "image/svg+xml", "woff2" => "font/woff2", "woff" => "font/woff",
        "ttf" => "font/ttf", "otf" => "font/otf", _ => "application/octet-stream",
    }
}
fn resolve(request_path: &str) -> Result<PathBuf, StatusCode> {
    let mut parts = request_path.trim_start_matches('/').splitn(2, '/');
    let token = parts.next().unwrap_or("");
    let rest = decode(parts.next().unwrap_or("")).ok_or(StatusCode::BAD_REQUEST)?;
    let root = tokens().lock().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.get(token).cloned().ok_or(StatusCode::NOT_FOUND)?;
    if rest.is_empty() || rest.contains('\0') || Path::new(&rest).components().any(|c| matches!(c, std::path::Component::ParentDir | std::path::Component::RootDir) || c.as_os_str().to_string_lossy().starts_with('.')) {
        return Err(StatusCode::FORBIDDEN);
    }
    let file = root.join(&rest).canonicalize().map_err(|_| StatusCode::NOT_FOUND)?;
    let meta = file.metadata().map_err(|_| StatusCode::NOT_FOUND)?;
    if !file.starts_with(&root) || !meta.is_file() { return Err(StatusCode::FORBIDDEN); }
    if meta.len() > MAX_BYTES { return Err(StatusCode::PAYLOAD_TOO_LARGE); }
    Ok(file)
}
pub fn respond(request_path: &str) -> Response<Vec<u8>> {
    let build = |status: StatusCode, mime: &str, body: Vec<u8>| Response::builder().status(status).header("Content-Type", mime)
        .header("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:")
        .header("X-Content-Type-Options", "nosniff").body(body).unwrap();
    match resolve(request_path).and_then(|f| std::fs::read(&f).map(|b| (f, b)).map_err(|_| StatusCode::NOT_FOUND)) {
        Ok((file, body)) => build(StatusCode::OK, mime(&file), body),
        Err(status) => build(status, "text/plain; charset=utf-8", format!("Preview unavailable ({status})").into_bytes()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn serves_registered_folder_only() {
        let root = std::env::temp_dir().join(hex::encode(rand::random::<[u8; 8]>()));
        std::fs::create_dir_all(root.join("img")).unwrap();
        std::fs::write(root.join("e mail.html"), "<p>hi</p>").unwrap();
        std::fs::write(root.join("img/a.png"), [1u8]).unwrap();
        std::fs::write(root.join(".env"), "secret").unwrap();
        std::fs::write(root.parent().unwrap().join(format!("{}-outside.txt", root.file_name().unwrap().to_string_lossy())), "x").unwrap();
        let url = register(&root.join("e mail.html")).unwrap();
        let path = url.strip_prefix("freddai-preview://localhost").unwrap();
        let ok = respond(path);
        assert_eq!(ok.status(), StatusCode::OK);
        assert_eq!(ok.body(), b"<p>hi</p>");
        assert!(ok.headers()["Content-Security-Policy"].to_str().unwrap().starts_with("sandbox"));
        let token = path.trim_start_matches('/').split('/').next().unwrap();
        assert_eq!(respond(&format!("/{token}/img/a.png")).status(), StatusCode::OK);
        for bad in [format!("/{token}/.env"), format!("/{token}/../x"), format!("/{token}/%2e%2e/x"), "/nope/e.html".to_string()] {
            assert_ne!(respond(&bad).status(), StatusCode::OK, "{bad}");
        }
        assert!(register(&root.join(".env")).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
