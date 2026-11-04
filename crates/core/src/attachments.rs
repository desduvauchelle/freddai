use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub bytes: u64,
    pub mime: String,
    pub sha256: String,
}
fn folder(root: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid attachment ID")?;
    Ok(root.join("attachments").join(id))
}
pub fn import(root: &Path, paths: &[String]) -> Result<Vec<Attachment>, String> {
    if paths.len() > 20 {
        return Err("Attach at most 20 files per message".into());
    }
    let mut result = Vec::new();
    let mut total = 0;
    for path in paths {
        let path = Path::new(path);
        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        let meta = file.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() {
            return Err("Only regular files can be attached".into());
        }
        if meta.len() > 25 * 1024 * 1024 {
            return Err("Each attachment must be 25 MB or smaller".into());
        }
        let mut bytes = Vec::new();
        file.by_ref()
            .take(25 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        total += bytes.len();
        if bytes.len() > 25 * 1024 * 1024 || total > 100 * 1024 * 1024 {
            return Err("Attachment size limit exceeded (25 MB per file, 100 MB total)".into());
        }
        let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else if bytes.starts_with(b"\xff\xd8\xff") {
            "image/jpeg"
        } else if bytes.starts_with(b"GIF8") {
            "image/gif"
        } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            "image/webp"
        } else if bytes.starts_with(b"%PDF") {
            "application/pdf"
        } else if std::str::from_utf8(&bytes).is_ok() {
            "text/plain"
        } else {
            "application/octet-stream"
        };
        let a = Attachment {
            id: uuid::Uuid::new_v4().to_string(),
            name: path
                .file_name()
                .ok_or("Invalid filename")?
                .to_string_lossy()
                .into(),
            bytes: bytes.len() as u64,
            mime: mime.into(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
        };
        let dir = folder(root, &a.id)?;
        super::runtime::private_dir(&dir)?;
        fs::write(dir.join("content"), &bytes).map_err(|e| e.to_string())?;
        fs::write(dir.join("metadata.json"), serde_json::to_vec(&a).unwrap())
            .map_err(|e| e.to_string())?;
        result.push(a);
    }
    Ok(result)
}
pub fn load(root: &Path, id: &str) -> Result<(Attachment, Vec<u8>, PathBuf), String> {
    let dir = folder(root, id)?;
    let a: Attachment = serde_json::from_slice(
        &fs::read(dir.join("metadata.json")).map_err(|_| "Attachment metadata missing")?,
    )
    .map_err(|_| "Invalid attachment metadata")?;
    let path = dir.join("content");
    let data = fs::read(&path).map_err(|_| "Attachment file missing")?;
    if format!("{:x}", Sha256::digest(&data)) != a.sha256 {
        return Err("Attachment changed since it was added. Attach it again.".into());
    }
    Ok((a, data, path))
}
pub fn blocks(
    root: &Path,
    ids: &[String],
    provider: &str,
) -> Result<Vec<serde_json::Value>, String> {
    let mut out = Vec::new();
    for id in ids {
        let (a, data, path) = load(root, id)?;
        let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
        if a.mime.starts_with("image/") {
            if provider == "codex" {
                out.push(serde_json::json!({"type":"localImage","path":path}));
            } else if provider == "claude" {
                out.push(serde_json::json!({"type":"image","source":{"type":"base64","media_type":a.mime,"data":b64}}));
            } else {
                out.push(serde_json::json!({"type":"image","mimeType":a.mime,"data":b64}));
            }
        } else if a.mime == "text/plain" && data.len() <= 1024 * 1024 {
            out.push(serde_json::json!({"type":"text","text":format!("Attached file {} (reference data):\n{}",a.name,String::from_utf8_lossy(&data))}));
        } else if a.mime == "application/pdf" && provider == "claude" {
            out.push(serde_json::json!({"type":"document","source":{"type":"base64","media_type":"application/pdf","data":b64}}));
        } else {
            out.push(serde_json::json!({"type":"text","text":format!("Attached file {} is stored at {} ({} bytes). Read using your file tools; request access if necessary.",a.name,path.display(),a.bytes)}));
        }
    }
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn copy_is_independent_and_tampering_detected() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir_all(&root).unwrap();
        let src = root.join("example.txt");
        fs::write(&src, "first").unwrap();
        let a = import(&root, &[src.to_string_lossy().into()])
            .unwrap()
            .remove(0);
        fs::write(src, "second").unwrap();
        assert_eq!(load(&root, &a.id).unwrap().1, b"first");
        fs::write(folder(&root, &a.id).unwrap().join("content"), "tamper").unwrap();
        assert!(load(&root, &a.id).is_err());
        assert!(load(&root, "../secret").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}

/// Preview only stored raster images, using the same integrity check as delivery.
pub fn preview(root: &Path, id: &str) -> Result<String, String> {
    let (attachment, data, _) = load(root, id)?;
    if !matches!(
        attachment.mime.as_str(),
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return Err("This attachment is not a supported image".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        attachment.mime,
        base64::engine::general_purpose::STANDARD.encode(data)
    ))
}

#[cfg(test)]
mod preview_tests {
    use super::*;
    #[test]
    fn preview_uses_retained_bytes_and_rejects_changes_and_other_files() {
        let root = std::env::temp_dir().join(format!("freddai-preview-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let image = root.join("capture.png");
        let bytes = b"\x89PNG\r\n\x1a\nfixture";
        fs::write(&image, bytes).unwrap();
        let attachment = import(&root, &[image.to_string_lossy().into_owned()])
            .unwrap()
            .remove(0);
        fs::remove_file(&image).unwrap();
        assert_eq!(
            preview(&root, &attachment.id).unwrap(),
            format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes)
            )
        );
        fs::write(
            folder(&root, &attachment.id).unwrap().join("content"),
            b"changed",
        )
        .unwrap();
        assert!(preview(&root, &attachment.id)
            .unwrap_err()
            .contains("changed"));
        let text = root.join("note.txt");
        fs::write(&text, b"hello").unwrap();
        let attachment = import(&root, &[text.to_string_lossy().into_owned()])
            .unwrap()
            .remove(0);
        assert!(preview(&root, &attachment.id)
            .unwrap_err()
            .contains("not a supported image"));
        assert!(preview(&root, "../outside").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
