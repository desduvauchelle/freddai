//! Read-only, bounded previews of files explicitly referenced in a conversation.
use crate::runtime::Database;
use base64::Engine;
use serde_json::{json, Value};
use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};

pub fn chunk(db: &Database, thread: &str, href: &str, offset: u64) -> Result<Value, String> {
    let session = db.sessions.iter().find(|s| s.id == thread && !s.archived && s.deleted_at.is_none()).ok_or("Thread unavailable")?;
    if href.is_empty() || !session.messages.iter().any(|m| m.text.contains(href)) {
        return Err("File is not referenced in this conversation".into());
    }
    let raw = href.strip_prefix("sandbox:").or_else(|| href.strip_prefix("file://")).unwrap_or(href);
    // Markdown URL escapes are decoded only after checking the original reference.
    let mut bytes = Vec::new();
    let mut iter = raw.as_bytes().iter().copied();
    while let Some(b) = iter.next() {
        if b == b'%' {
            let a = iter.next().ok_or("Invalid file URL")?;
            let b = iter.next().ok_or("Invalid file URL")?;
            bytes.push(u8::from_str_radix(std::str::from_utf8(&[a,b]).map_err(|_| "Invalid file URL")?,16).map_err(|_| "Invalid file URL")?);
        } else { bytes.push(b); }
    }
    let path = String::from_utf8(bytes).map_err(|_| "Invalid file path")?;
    if path.contains('\0') || path.contains("://") { return Err("Unsupported file path".into()); }
    let base = session.working_dir.as_deref().or_else(|| db.projects.iter().find(|p| p.id == session.project).map(|p|p.path.as_str())).ok_or("Project unavailable")?;
    let path = Path::new(base).join(path);
    let mut file = File::open(&path).map_err(|_| "File unavailable on your Mac. It may have moved or been deleted.")?;
    let meta = file.metadata().map_err(|e|e.to_string())?;
    let shown = path.canonicalize().unwrap_or_else(|_| path.clone()).to_string_lossy().into_owned();
    if !meta.is_file() { return Err("Preview requires a regular file".into()); }
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let text_mime = match ext.as_str() {
        "html" | "htm" => Some("text/html"), "svg" => Some("image/svg+xml"), "txt" | "log" => Some("text/plain"),
        "md" => Some("text/markdown"), "csv" => Some("text/csv"), "json" => Some("application/json"), _ => None,
    };
    let binary_ext = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "pdf");
    if text_mime.is_none() && !binary_ext {
        // Not previewable: return the resolved path only so the UI can offer copy/open/reveal.
        return Ok(json!({"mime":"application/octet-stream","size":meta.len(),"offset":0,"data":"","path":shown,"previewable":false}));
    }
    let limit = if text_mime.is_some() { 5 * 1024 * 1024 } else { 25 * 1024 * 1024 };
    if meta.len() > limit || offset > meta.len() { return Err(format!("Preview requires a file of {} MB or smaller", limit / 1024 / 1024)); }
    let mime = if let Some(m) = text_mime {
        if offset == 0 {
            let mut all = Vec::new();
            (&mut file).take(limit + 1).read_to_end(&mut all).map_err(|e| e.to_string())?;
            if std::str::from_utf8(&all).is_err() { return Err("Preview supports UTF-8 text files only; this file is not valid UTF-8".into()); }
        }
        m
    } else {
        let mut head = [0u8; 16];
        let n = file.read(&mut head).map_err(|e| e.to_string())?;
        let head = &head[..n];
        if head.starts_with(b"\x89PNG\r\n\x1a\n") { "image/png" }
        else if head.starts_with(b"\xff\xd8\xff") { "image/jpeg" }
        else if head.starts_with(b"GIF8") { "image/gif" }
        else if head.starts_with(b"RIFF") && head.get(8..12) == Some(b"WEBP") { "image/webp" }
        else if head.starts_with(b"%PDF-") { "application/pdf" }
        else { return Err("File content does not match its PNG, JPEG, GIF, WebP or PDF extension".into()); }
    };
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    file.take(192 * 1024).read_to_end(&mut data).map_err(|e| e.to_string())?;
    Ok(json!({"mime":mime,"size":meta.len(),"offset":offset,"data":base64::engine::general_purpose::STANDARD.encode(data),"path":shown,"previewable":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn previews_only_referenced_supported_files_in_bounded_chunks() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("design.png");
        let mut bytes = vec![0u8; 300_000];
        bytes[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        std::fs::write(&path, &bytes).unwrap();
        let session = json!({"id":"t", "project":"p", "account":"a", "title":"Design", "status":"done", "updated":0, "provider_id":null, "messages":[{"id":"m", "role":"assistant", "text":"[Design](design.png) [PDF](file:///missing.pdf) [Bad](bad.png)"}], "pending":null, "error":null, "working_dir":root.to_str()});
        let db: Database = serde_json::from_value(json!({"accounts":[],"projects":[],"sessions":[session],"preferences":{"prefer_last":false}})).unwrap();
        let first = chunk(&db,"t","design.png",0).unwrap();
        assert_eq!(first["mime"], "image/png");
        let data = base64::engine::general_purpose::STANDARD.decode(first["data"].as_str().unwrap()).unwrap();
        assert_eq!(data.len(), 192 * 1024);
        let last = chunk(&db,"t","design.png",data.len() as u64).unwrap();
        let tail = base64::engine::general_purpose::STANDARD.decode(last["data"].as_str().unwrap()).unwrap();
        assert_eq!([data,tail].concat(), bytes);
        assert!(chunk(&db,"t","other.png",0).is_err());
        assert!(chunk(&db,"other","design.png",0).is_err());
        assert!(chunk(&db,"t","design.png",400_000).is_err());
        assert!(chunk(&db,"t","file:///missing.pdf",0).is_err());
        std::fs::write(root.join("bad.png"), "not an image").unwrap();
        assert!(chunk(&db,"t","bad.png",0).is_err());
        assert!(first["path"].as_str().unwrap().ends_with("design.png"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn previews_text_types_and_reports_paths_for_others() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(root.join("output")).unwrap();
        std::fs::write(root.join("output/email.html"), "<h1>Hi é</h1>").unwrap();
        std::fs::write(root.join("bad.html"), [0xffu8, 0xfe, 0x3c]).unwrap();
        std::fs::write(root.join("notes.md"), "# Notes").unwrap();
        std::fs::write(root.join("a.zip"), "PK").unwrap();
        let session = json!({"id":"t", "project":"p", "account":"a", "title":"T", "status":"done", "updated":0, "provider_id":null, "messages":[{"id":"m", "role":"assistant", "text":"[a](output/email.html) [b](bad.html) [c](notes.md) [d](a.zip) [e](secret.html)"}], "pending":null, "error":null, "working_dir":root.to_str()});
        let db: Database = serde_json::from_value(json!({"accounts":[],"projects":[],"sessions":[session],"preferences":{"prefer_last":false}})).unwrap();
        let html = chunk(&db,"t","output/email.html",0).unwrap();
        assert_eq!(html["mime"], "text/html");
        assert!(html["path"].as_str().unwrap().starts_with('/') && html["path"].as_str().unwrap().ends_with("output/email.html"));
        let text = base64::engine::general_purpose::STANDARD.decode(html["data"].as_str().unwrap()).unwrap();
        assert_eq!(String::from_utf8(text).unwrap(), "<h1>Hi é</h1>");
        assert!(chunk(&db,"t","bad.html",0).unwrap_err().contains("UTF-8"));
        assert_eq!(chunk(&db,"t","notes.md",0).unwrap()["mime"], "text/markdown");
        let zip = chunk(&db,"t","a.zip",0).unwrap();
        assert_eq!(zip["previewable"], false);
        assert!(zip["path"].as_str().unwrap().ends_with("a.zip"));
        std::fs::write(root.join("secret.html"), "x").unwrap();
        assert!(chunk(&db,"t","other.html",0).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
