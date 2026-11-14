//! Companion (iPhone/iPad) screen-recording upload: becomes a bug walk the Mac intake analyses.
//! Operations arrive as `/v1/composer` `bug_walk_{begin,chunk,finish,status}`; see `dispatch` in companion_server.rs.
//! Chunks are standard base64. Over the relay the ciphertext is hex and capped at 300 KiB, so phones should send ~64-96 KiB over relay.

use super::{now_s, read_walk, validate_opts, walk_dir, walks_root, write_walk, Origin, Region, SendOpts, Walk};
use serde_json::{json, Value};
use std::{fs, io::{Read, Seek, SeekFrom, Write}, os::unix::fs::DirBuilderExt, path::{Path, PathBuf}};

const MAX_CHUNK: usize = 256 * 1024;
const MAX_BYTES: u64 = 400 * 1024 * 1024;
const MAX_PENDING: usize = 4;

fn uploads_dir(root: &Path) -> PathBuf { root.join("companion/bug-walk-uploads") }

fn text<'a>(p: &'a Value, k: &str) -> Result<&'a str, String> {
    p[k].as_str().ok_or_else(|| format!("Missing {k}"))
}

fn upload_dir(root: &Path, p: &Value) -> Result<PathBuf, String> {
    let id = text(p, "id")?;
    if id.len() != 64 || hex::decode(id).is_err() { return Err("Invalid upload".into()); }
    Ok(uploads_dir(root).join(id))
}

fn extension(name: &str) -> Result<&'static str, String> {
    if name.is_empty() || name.len() > 255 || name.contains(['/', '\\', '\0']) { return Err("Invalid filename".into()); }
    match Path::new(name).extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mov") => Ok("mov"),
        Some("mp4") => Ok("mp4"),
        _ => Err("Only .mov or .mp4 screen recordings are supported".into()),
    }
}

pub fn call(root: &Path, operation: &str, input: &Value) -> Result<Value, String> {
    match operation {
        "bug_walk_begin" => begin(root, input),
        "bug_walk_chunk" => chunk(root, input),
        "bug_walk_finish" => finish(root, input),
        "bug_walk_status" => status(root, input),
        _ => Err("Unknown composer operation".into()),
    }
}

fn begin(root: &Path, p: &Value) -> Result<Value, String> {
    let name = text(p, "name")?;
    extension(name)?;
    let device = text(p, "device")?.trim();
    if device.is_empty() || device.chars().count() > 80 { return Err("Invalid device name".into()); }
    let opts: SendOpts = serde_json::from_value(p["opts"].clone()).map_err(|e| format!("Invalid options: {e}"))?;
    validate_opts(&opts)?;
    let base = uploads_dir(root);
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&base).map_err(|e| e.to_string())?;
    let mut pending = 0;
    for entry in fs::read_dir(&base).map_err(|e| e.to_string())?.flatten() {
        if entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() > 86400) {
            let _ = fs::remove_dir_all(entry.path());
        } else if !entry.path().join("result").exists() {
            pending += 1;
        }
    }
    if pending >= MAX_PENDING { return Err("Too many pending screen recordings".into()); }
    let id = crate::companion_crypto::random();
    let dir = base.join(&id);
    fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|e| e.to_string())?;
    let meta = json!({"name": name, "device": device, "opts": opts, "created": now_s()});
    fs::write(dir.join("meta.json"), serde_json::to_vec(&meta).unwrap()).map_err(|e| e.to_string())?;
    fs::write(dir.join("bytes"), []).map_err(|e| e.to_string())?;
    Ok(json!({"id": id}))
}

fn chunk(root: &Path, p: &Value) -> Result<Value, String> {
    use base64::Engine;
    let dir = upload_dir(root, p)?;
    let data = text(p, "data")?;
    if data.len() > MAX_CHUNK / 3 * 4 + 8 { return Err("Chunk too large".into()); }
    let bytes = base64::engine::general_purpose::STANDARD.decode(data).map_err(|_| "Invalid chunk data")?;
    if bytes.len() > MAX_CHUNK { return Err("Chunk too large".into()); }
    let offset = p["offset"].as_u64().ok_or("Missing offset")?;
    if offset.saturating_add(bytes.len() as u64) > MAX_BYTES { return Err("Screen recording is too large (max 400 MB)".into()); }
    if dir.join("result").exists() { return Err("Upload expired".into()); }
    let mut file = fs::OpenOptions::new().read(true).write(true).open(dir.join("bytes")).map_err(|_| "Upload expired")?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len != offset {
        if !bytes.is_empty() && offset + bytes.len() as u64 == len {
            file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            let mut prior = Vec::new();
            file.read_to_end(&mut prior).map_err(|e| e.to_string())?;
            if prior == bytes { return Ok(json!({"received": len})); }
        }
        return Err("Chunk out of order".into());
    }
    file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(json!({"received": len + bytes.len() as u64}))
}

fn finish(root: &Path, p: &Value) -> Result<Value, String> {
    let dir = upload_dir(root, p)?;
    if let Ok(saved) = fs::read(dir.join("result")) {
        return serde_json::from_slice(&saved).map_err(|e| e.to_string());
    }
    let size = p["size"].as_u64().ok_or("Missing size")?;
    let len = fs::metadata(dir.join("bytes")).map_err(|_| "Upload expired")?.len();
    if size == 0 || len != size { return Err("Upload incomplete".into()); }
    let meta: Value = serde_json::from_slice(&fs::read(dir.join("meta.json")).map_err(|_| "Upload expired")?).map_err(|e| e.to_string())?;
    let ext = extension(meta["name"].as_str().unwrap_or(""))?;
    let device = meta["device"].as_str().unwrap_or("iPhone").to_string();
    let opts: SendOpts = serde_json::from_value(meta["opts"].clone()).map_err(|e| e.to_string())?;
    let walk_id = hex::encode(rand::random::<[u8; 8]>());
    let walk_path = walk_dir(root, &walk_id)?;
    fs::create_dir_all(walks_root(root)).map_err(|e| e.to_string())?;
    fs::DirBuilder::new().mode(0o700).create(&walk_path).map_err(|e| e.to_string())?;
    let written = (|| -> Result<(), String> {
        let recording = walk_path.join(format!("recording.{ext}"));
        if fs::rename(dir.join("bytes"), &recording).is_err() {
            fs::copy(dir.join("bytes"), &recording).map_err(|e| e.to_string())?;
            let _ = fs::remove_file(dir.join("bytes"));
        }
        let walk = Walk {
            id: walk_id.clone(),
            started_at: now_s(),
            origin: Origin { project: Some(opts.project.clone()), thread: opts.reply_to_thread.clone() },
            region: Region { scale: 1.0, app_name: Some(device.clone()), title: Some(format!("Screen recording from {device}")), ..Region::default() },
            duration_s: None,
            phase: "stopped".into(),
            pid: None,
            reason: None,
            source: Some("companion".into()),
            sessions: None,
        };
        write_walk(&walk_path, &walk)?;
        // send.json is the Mac intake's signal, so it lands last and atomically.
        let tmp = walk_path.join("send.json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&opts).unwrap()).map_err(|e| e.to_string())?;
        fs::rename(&tmp, walk_path.join("send.json")).map_err(|e| e.to_string())
    })();
    if let Err(e) = written {
        let _ = fs::remove_dir_all(&walk_path);
        return Err(e);
    }
    let result = json!({"id": walk_id, "phase": "stopped"});
    // Kept for the 24 h sweep so a retried finish returns the same walk id.
    fs::write(dir.join("result"), serde_json::to_vec(&result).unwrap()).map_err(|e| e.to_string())?;
    Ok(result)
}

fn status(root: &Path, p: &Value) -> Result<Value, String> {
    let id = text(p, "id")?;
    let missing = json!({"id": id, "phase": "missing"});
    let Ok(dir) = walk_dir(root, id) else { return Ok(missing) };
    match read_walk(&dir) {
        Ok(walk) if walk.source.as_deref() == Some("companion") => {
            let mut out = json!({"id": id, "phase": walk.phase, "device": walk.region.app_name});
            if let Some(r) = walk.reason { out["reason"] = json!(r); }
            if let Some(s) = walk.sessions { out["sessions"] = json!(s); }
            Ok(out)
        }
        _ => Ok(missing),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;
    fn b64(b: &[u8]) -> String { base64::engine::general_purpose::STANDARD.encode(b) }
    fn root() -> PathBuf { std::env::temp_dir().join(format!("fr-bwc-{}", crate::companion_crypto::random())) }
    fn opts() -> Value { json!({"project": "p1", "permission_mode": "ask", "split": "single", "reply_to_thread": "t1"}) }
    fn begin_ok(root: &Path, name: &str) -> String {
        call(root, "bug_walk_begin", &json!({"name": name, "device": " Denis's iPhone ", "opts": opts()})).unwrap()["id"].as_str().unwrap().to_string()
    }
    fn put(root: &Path, id: &str, offset: u64, bytes: &[u8]) -> Result<Value, String> {
        call(root, "bug_walk_chunk", &json!({"id": id, "offset": offset, "data": b64(bytes)}))
    }

    #[test]
    fn begin_validates_extension_device_and_opts() {
        let r = root();
        let bad = |v: Value| call(&r, "bug_walk_begin", &v).unwrap_err();
        assert_eq!(bad(json!({"name": "a.avi", "device": "x", "opts": opts()})), "Only .mov or .mp4 screen recordings are supported");
        assert!(bad(json!({"name": "../a.mov", "device": "x", "opts": opts()})).contains("filename"));
        assert!(bad(json!({"name": "a.mov", "device": "  ", "opts": opts()})).contains("device"));
        assert!(bad(json!({"name": "a.mov", "device": "x".repeat(81), "opts": opts()})).contains("device"));
        assert!(bad(json!({"name": "a.mov", "device": "x", "opts": {"project": " ", "permission_mode": "ask"}})).contains("project"));
        assert!(bad(json!({"name": "a.mov", "device": "x", "opts": {"project": "p", "permission_mode": "yolo"}})).contains("permission"));
        assert!(bad(json!({"name": "a.mov", "device": "x", "opts": {"project": "p", "permission_mode": "ask", "split": "many"}})).contains("split"));
        let id = begin_ok(&r, "REC.MOV");
        let meta: Value = serde_json::from_slice(&fs::read(uploads_dir(&r).join(&id).join("meta.json")).unwrap()).unwrap();
        assert_eq!(meta["device"], "Denis's iPhone");
        for _ in 0..3 { begin_ok(&r, "a.mp4"); }
        assert_eq!(call(&r, "bug_walk_begin", &json!({"name": "a.mp4", "device": "x", "opts": opts()})).unwrap_err(), "Too many pending screen recordings");
        fs::remove_dir_all(r).unwrap();
    }

    #[test]
    fn chunks_are_ordered_idempotent_and_bounded() {
        let r = root();
        let id = begin_ok(&r, "a.mov");
        assert_eq!(put(&r, &id, 0, b"hello").unwrap()["received"], 5);
        assert_eq!(put(&r, &id, 0, b"hello").unwrap()["received"], 5);
        assert_eq!(put(&r, &id, 5, b" world").unwrap()["received"], 11);
        assert_eq!(put(&r, &id, 5, b" world").unwrap()["received"], 11);
        assert_eq!(put(&r, &id, 5, b" WORLD").unwrap_err(), "Chunk out of order");
        assert_eq!(put(&r, &id, 20, b"x").unwrap_err(), "Chunk out of order");
        assert!(put(&r, &id, 11, &vec![0u8; MAX_CHUNK + 1]).is_err());
        assert_eq!(put(&r, &id, MAX_BYTES, b"x").unwrap_err(), "Screen recording is too large (max 400 MB)");
        assert!(call(&r, "bug_walk_chunk", &json!({"id": id, "offset": 11, "data": "!!"})).is_err());
        assert!(put(&r, "../escape", 0, b"x").is_err());
        assert_eq!(put(&r, &id, 11, &vec![1u8; MAX_CHUNK]).unwrap()["received"], 11 + MAX_CHUNK as u64);
        fs::remove_dir_all(r).unwrap();
    }

    #[test]
    fn finish_writes_walk_files_and_is_idempotent() {
        let r = root();
        for (name, ext) in [("a.MOV", "mov"), ("b.mp4", "mp4")] {
            let id = begin_ok(&r, name);
            put(&r, &id, 0, b"video").unwrap();
            assert_eq!(call(&r, "bug_walk_finish", &json!({"id": id, "size": 4})).unwrap_err(), "Upload incomplete");
            let done = json!({"id": id, "size": 5});
            let out = call(&r, "bug_walk_finish", &done).unwrap();
            assert_eq!(out["phase"], "stopped");
            assert_eq!(call(&r, "bug_walk_finish", &done).unwrap(), out);
            let wid = out["id"].as_str().unwrap();
            let dir = walk_dir(&r, wid).unwrap();
            assert_eq!(fs::read(dir.join(format!("recording.{ext}"))).unwrap(), b"video");
            let walk = read_walk(&dir).unwrap();
            assert_eq!(walk.source.as_deref(), Some("companion"));
            assert_eq!(walk.phase, "stopped");
            assert_eq!(walk.origin.project.as_deref(), Some("p1"));
            assert_eq!(walk.origin.thread.as_deref(), Some("t1"));
            assert_eq!(walk.region.app_name.as_deref(), Some("Denis's iPhone"));
            let sent: SendOpts = serde_json::from_slice(&fs::read(dir.join("send.json")).unwrap()).unwrap();
            assert_eq!((sent.project.as_str(), sent.permission_mode.as_str(), sent.reply_to_thread.as_deref()), ("p1", "ask", Some("t1")));
            assert!(!dir.join("send.json.tmp").exists());
            let st = call(&r, "bug_walk_status", &json!({"id": wid})).unwrap();
            assert_eq!(st["phase"], "stopped");
            assert_eq!(st["device"], "Denis's iPhone");
        }
        let empty = begin_ok(&r, "c.mov");
        assert_eq!(call(&r, "bug_walk_finish", &json!({"id": empty, "size": 0})).unwrap_err(), "Upload incomplete");
        fs::remove_dir_all(r).unwrap();
    }

    #[test]
    fn status_reports_missing_and_ignores_mac_walks() {
        let r = root();
        assert_eq!(call(&r, "bug_walk_status", &json!({"id": "deadbeef"})).unwrap(), json!({"id": "deadbeef", "phase": "missing"}));
        assert_eq!(call(&r, "bug_walk_status", &json!({"id": "../x"})).unwrap()["phase"], "missing");
        let dir = walk_dir(&r, "mac1").unwrap();
        fs::create_dir_all(&dir).unwrap();
        let mut walk = Walk { id: "mac1".into(), started_at: 1, origin: Origin::default(), region: Region::default(), duration_s: None, phase: "recording".into(), pid: None, reason: None, source: None, sessions: None };
        write_walk(&dir, &walk).unwrap();
        assert_eq!(call(&r, "bug_walk_status", &json!({"id": "mac1"})).unwrap()["phase"], "missing");
        walk.source = Some("companion".into());
        walk.phase = "done".into();
        walk.sessions = Some(vec!["s1".into()]);
        walk.reason = Some("why".into());
        write_walk(&dir, &walk).unwrap();
        let st = call(&r, "bug_walk_status", &json!({"id": "mac1"})).unwrap();
        assert_eq!((st["phase"].as_str(), st["sessions"][0].as_str(), st["reason"].as_str()), (Some("done"), Some("s1"), Some("why")));
        fs::remove_dir_all(r).unwrap();
    }
}
