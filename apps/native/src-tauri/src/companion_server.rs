//! Device-authorized companion. Never forwards arbitrary desktop RPC methods.
use freddai_core::{host, runtime::{Database, LaunchOptions, resolve}};
use serde_json::{json, Value};
use std::{fs, io::Read, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant}};
#[cfg(test)]
use subtle::ConstantTimeEq;
use fs2::FileExt;
use tiny_http::{Header, Method, Response, Server, SslConfig, StatusCode};

use crate::thread_list_settings::ThreadListSettings;

const PORT: u16 = 49744;
const LIMIT: u64 = 128 * 1024;

pub fn project_snapshot(db: &Database) -> Value {
    project_snapshot_selection(db, None, false)
}
/// Scoped clients fetch summaries plus only the open transcript. Legacy clients retain their full snapshot.
fn project_snapshot_selection(db: &Database, thread: Option<&str>, scoped: bool) -> Value {
    let projects: Vec<_> = db.projects.iter().map(|p| json!({
        "id":p.id, "name":p.name, "color":p.color,
        "provider":resolve(db,p,None).ok().and_then(|id|db.accounts.iter().find(|a|a.id==id).map(|a|a.provider.clone())),
        "defaultAssistant":resolve(db,p,None).ok(),
        "assistants":db.accounts.iter().map(|a|json!({"id":a.id,"name":a.name,"provider":a.provider})).collect::<Vec<_>>(),
        "canStart":!db.accounts.is_empty() && Path::new(&p.path).is_dir()
    })).collect();
    let threads: Vec<_> = db.sessions.iter().filter(|s| !s.archived && s.deleted_at.is_none() && s.status != "archived").map(|s| {
        let queue = db.queues.iter().find(|q| q.session == s.id);
        let include_history = !scoped || thread == Some(s.id.as_str());
        if !include_history {
            // Keep the searchable title index and attention/read badges, not conversation payloads.
            // An empty pending object is a presence marker; messagesLoaded=false prevents acting on it.
            return json!({"id":s.id,"project":s.project,"title":s.title,"status":s.status,
                "updated":s.updated,"read_at":s.read_at,"last_user_message_at":s.last_user_message_at,
                "messages":[],"messagesLoaded":false,"canReply":false,"error":null,
                "pending":s.pending.as_ref().map(|_|json!({})),
                "queued":queue.map(|q|q.messages.len()).unwrap_or(0)});
        }
        json!({"id":s.id,"project":s.project,"title":s.title,"status":s.status,
            "updated":s.updated,"read_at":s.read_at,"last_user_message_at":s.last_user_message_at,"messages":if include_history { json!(s.messages) } else { json!([]) },
            "tasks":if include_history { json!(s.tasks) } else { json!([]) },"messagesLoaded":include_history,"error":s.error,
            "canReply":s.pending.is_none() && s.provider_id.is_some() && db.accounts.iter().any(|a| a.id==s.account),
            "usage":s.usage,"pending":s.pending,"provider":db.accounts.iter().find(|a|a.id==s.account).map(|a|a.provider.as_str()),
            "options":{"model":s.options.model,"effort":s.options.effort,"permission_mode":s.options.permission_mode},
            "queue":queue.map(|q|q.messages.iter().map(|m|json!({"id":m.id,"prompt":m.prompt,"attachments":m.options.attachments.len()})).collect::<Vec<_>>()).unwrap_or_default(),
            "queued":queue.map(|q|q.messages.len()).unwrap_or(0),
            "queuePaused":queue.is_some_and(|q|q.paused),
            "queueError":queue.and_then(|q|q.error.clone())})
    }).collect();
    json!({"projects":projects,"threads":threads,"schedules":db.schedules})
}
fn snapshot(root: &Path) -> Result<Database, String> {
    serde_json::from_value(host::call(root,"snapshot",json!({}))?).map_err(|e|e.to_string())
}
fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    p[key].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(||format!("Missing {key}"))
}
fn new_thread_options(provider: &str, worktree: bool, options: LaunchOptions) -> LaunchOptions {
    LaunchOptions { worktree, permission_mode: options.permission_mode.or_else(|| if matches!(provider, "codex" | "claude") { Some(freddai_core::runtime::PermissionMode::Bypass) } else { None }), ..options }
}
#[cfg(test)]
mod permission_tests {
    use super::*;
    #[test]
    fn phone_start_matches_desktop_full_access_for_supported_providers() {
        for provider in ["codex", "claude"] {
            assert_eq!(new_thread_options(provider, true, LaunchOptions::default()).permission_mode,
                Some(freddai_core::runtime::PermissionMode::Bypass));
        }
        assert_eq!(new_thread_options("grok", false, LaunchOptions::default()).permission_mode, None);
    }
}
// Copy only next-message controls. Remote callers cannot set scheduling, worktrees or host paths.
fn message_options(value: &Value, request_id: &str) -> Result<LaunchOptions, String> {
    let mut options = LaunchOptions { request_id: Some(format!("phone:{request_id}")), ..Default::default() };
    if !value.is_null() {
        let requested: LaunchOptions = serde_json::from_value(value.clone()).map_err(|_|"Invalid composer settings")?;
        if requested.model.as_ref().is_some_and(|s|s.len()>200) || requested.effort.as_ref().is_some_and(|s|s.len()>40) || requested.attachments.len()>20 { return Err("Composer settings exceed limits".into()); }
        options.model = requested.model;
        options.effort = requested.effort;
        options.permission_mode = requested.permission_mode;
        options.attachments = requested.attachments;
        options.update_agent_controls = requested.update_agent_controls;
    }
    Ok(options)
}
fn composer(root: &Path, db: &Database, p: &Value) -> Result<Value,String> {
    let input = &p["input"];
    let session = input["thread"].as_str().map(|id|db.sessions.iter().find(|s|s.id==id && !s.archived && s.deleted_at.is_none() && s.status!="archived").ok_or("Thread unavailable")).transpose()?;
    match text(p,"operation")? {
        "models" => {
            let account = if let Some(s)=session {s.account.clone()} else {
                let project=db.projects.iter().find(|x|Some(x.id.as_str())==input["project"].as_str()).ok_or("Project not found")?;
                resolve(db,project,input["assistant"].as_str().map(str::to_owned))?
            };
            host::call(root,"account_models",json!({"account":account}))
        },
        "queue" => {
            let session=session.ok_or("Thread unavailable")?;
            let action=text(input,"action")?;
            if !["pause","resume","delete","clear"].contains(&action) {return Err("Unknown queue action".into());}
            host::call(root,"queue_action",json!({"session":session.id,"action":action,"message":input["message"]}))
        },
        _ => Err("Unknown composer operation".into())
    }
}
// Bounded chunks fit the existing encrypted relay envelope; only private upload files are accepted.
fn upload(root: &Path, p: &Value) -> Result<Value,String> {
    use std::{io::{Seek,SeekFrom,Write},os::unix::fs::DirBuilderExt};
    let base=root.join("companion/uploads");
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&base).map_err(|e|e.to_string())?;
    for entry in fs::read_dir(&base).map_err(|e|e.to_string())?.flatten() {
        if entry.metadata().ok().and_then(|m|m.modified().ok()).and_then(|t|t.elapsed().ok()).is_some_and(|age|age.as_secs()>86400) {let _=fs::remove_dir_all(entry.path());}
    }
    if p["action"]=="begin" {
        let name=text(p,"name")?;
        if name.len()>255 || name.contains(['/', '\\', '\0']) || name=="." || name==".." {return Err("Invalid filename".into());}
        if fs::read_dir(&base).map_err(|e|e.to_string())?.flatten().filter(|entry| !entry.path().join("result").exists()).count()>=32 {return Err("Too many unfinished attachments. Try again later.".into());}
        let id=crate::companion_crypto::random();
        let dir=base.join(&id); fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|e|e.to_string())?;
        fs::write(dir.join("name"),name).map_err(|e|e.to_string())?;
        fs::write(dir.join("bytes"),[]).map_err(|e|e.to_string())?;
        return Ok(json!(id));
    }
    let id=text(p,"id")?;
    if id.len()!=64 || hex::decode(id).is_err() {return Err("Invalid upload".into());}
    let dir=base.join(id);
    if p["action"]=="chunk" {
        let data=text(p,"data")?;
        if data.len()>48*1024 {return Err("Attachment chunk too large".into());}
        let bytes=hex::decode(data).map_err(|_|"Invalid attachment chunk")?;
        let offset=p["offset"].as_u64().ok_or("Missing attachment offset")?;
        if offset+bytes.len() as u64>25*1024*1024 {return Err("Each attachment must be 25 MB or smaller".into());}
        let mut file=fs::OpenOptions::new().read(true).write(true).open(dir.join("bytes")).map_err(|_|"Upload expired")?;
        let len=file.metadata().map_err(|e|e.to_string())?.len();
        if len!=offset {
            if len==offset+bytes.len() as u64 {file.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;let mut prior=Vec::new();file.read_to_end(&mut prior).map_err(|e|e.to_string())?;if prior==bytes {return Ok(Value::Null);}}
            return Err("Attachment upload out of order".into());
        }
        file.seek(SeekFrom::End(0)).map_err(|e|e.to_string())?;
        file.write_all(&bytes).map_err(|e|e.to_string())?;
        return Ok(Value::Null);
    }
    if p["action"]=="finish" {
        if let Ok(saved)=fs::read(dir.join("result")) {return serde_json::from_slice(&saved).map_err(|e|e.to_string());}
        let size=p["size"].as_u64().ok_or("Missing attachment size")?;
        if fs::metadata(dir.join("bytes")).map_err(|_|"Upload expired")?.len()!=size {return Err("Attachment is incomplete".into());}
        let name=fs::read_to_string(dir.join("name")).map_err(|e|e.to_string())?;
        let content=dir.join(&name);
        // A separate subdirectory avoids collisions with our bookkeeping filenames.
        let payload=dir.join("payload");fs::create_dir_all(&payload).map_err(|e|e.to_string())?;
        let content=payload.join(content.file_name().ok_or("Invalid filename")?);
        fs::copy(dir.join("bytes"),&content).map_err(|e|e.to_string())?;
        let result=freddai_core::attachments::import(root,&[content.to_string_lossy().into()])?.remove(0);
        let result=json!(result);
        fs::write(dir.join("result"),serde_json::to_vec(&result).unwrap()).map_err(|e|e.to_string())?;
        let _=fs::remove_file(dir.join("bytes"));let _=fs::remove_dir_all(payload);
        return Ok(result);
    }
    Err("Unknown upload operation".into())
}
// Phone push-to-talk dictation. The audio rides the normal upload chunks but is never imported as an attachment:
// `transcribe` consumes the unfinished upload, runs the local model and always deletes the audio.
const VOICE_MAX_BYTES: u64 = 10 * 1024 * 1024;
fn voice_upload_dir(root: &Path, input: &Value) -> Result<PathBuf,String> {
    let id=text(input,"id")?;
    if id.len()!=64 || hex::decode(id).is_err() {return Err("Invalid upload".into());}
    let dir=root.join("companion/uploads").join(id);
    if !dir.join("bytes").is_file() || dir.join("result").exists() {return Err("Upload expired".into());}
    Ok(dir)
}
/// Verifies the received bytes and moves them to a file whose extension (from the original name) lets the decoder probe the format.
fn voice_prepare_audio(dir: &Path, input: &Value) -> Result<PathBuf,String> {
    let len=fs::metadata(dir.join("bytes")).map_err(|_|"Upload expired")?.len();
    if len==0 {return Err("The recording is empty".into());}
    if len>VOICE_MAX_BYTES {return Err("The recording is too large (10 MB limit)".into());}
    if let Some(size)=input["size"].as_u64() { if size!=len {return Err("Recording upload is incomplete".into());} }
    let name=fs::read_to_string(dir.join("name")).unwrap_or_default();
    let ext=Path::new(&name).extension().and_then(|e|e.to_str()).filter(|e|!e.is_empty() && e.len()<=8 && e.chars().all(|c|c.is_ascii_alphanumeric())).unwrap_or("m4a").to_ascii_lowercase();
    let audio=dir.join(format!("audio.{ext}"));
    fs::rename(dir.join("bytes"),&audio).map_err(|e|e.to_string())?;
    Ok(audio)
}
fn voice_composer(root: &Path, p: &Value) -> Result<Value,String> {
    if p["operation"]=="voice" {
        let status=crate::voice::status(root);
        return Ok(json!({"enabled":status.enabled,"ready":status.ready}));
    }
    let input=&p["input"];
    let dir=voice_upload_dir(root,input)?;
    let started=std::time::Instant::now();
    let id=dir.file_name().and_then(|n|n.to_str()).unwrap_or("?").chars().take(8).collect::<String>();
    let bytes=fs::metadata(dir.join("bytes")).map(|m|m.len()).unwrap_or(0);
    let result=crate::voice::ready(root).and_then(|_|voice_prepare_audio(&dir,input)).and_then(|audio|crate::voice::transcribe_file(root,&audio));
    let _=fs::remove_dir_all(&dir);
    match result {
        Ok(t)=>{eprintln!("companion.transcribe id={id} bytes={bytes} result=ok model={} audio_ms={} elapsed_ms={} chars={}",t.model,t.duration_ms,started.elapsed().as_millis(),t.text.chars().count());
            Ok(json!({"text":t.text,"durationMs":t.duration_ms,"model":t.model}))},
        Err(e)=>{eprintln!("companion.transcribe id={id} bytes={bytes} result=err elapsed_ms={} error={e}",started.elapsed().as_millis());Err(e)}
    }
}
pub(crate) fn dispatch(root: &Path, route: &str, p: Value) -> Result<Value,String> {
    if route == "/v1/composer" && matches!(p["operation"].as_str(), Some("day_summary"|"summarize_day"|"save_schedule"|"schedule_action")) {
        return host::call(root, text(&p,"operation")?, p["input"].clone());
    }
    if route == "/v1/composer" && p["operation"] == "upload" { return upload(root, &p["input"]); }
    if route == "/v1/composer" && matches!(p["operation"].as_str(), Some("voice"|"transcribe")) { return voice_composer(root, &p); }
    // Network details only (hardware MACs, IPs, broadcast); no thread, account or project data.
    if route == "/v1/wake" { return crate::wake::mac::collect().map(|w| json!(w)); }
    let db = snapshot(root)?;
    if route == "/v1/composer" { return composer(root, &db, &p); }
    if route == "/v1/snapshot" {
        let mut result = project_snapshot_selection(&db,p["thread"].as_str(),p["scoped"].as_bool().unwrap_or(false));
        if let Ok(bytes) = fs::read(root.join("companion/thread-list.json")) {
            if let Ok(settings) = serde_json::from_slice::<ThreadListSettings>(&bytes) {
                result["threadList"] = json!(settings);
            }
        }
        return Ok(result);
    }
    if route=="/v1/action" {
        let thread=text(&p,"thread")?;
        let session=db.sessions.iter().find(|s|s.id==thread && !s.archived && s.deleted_at.is_none() && s.status!="archived").ok_or("Thread unavailable")?;
        let action=text(&p,"action")?;
        if !["stop","archive","delete"].contains(&action) {return Err("Unknown thread action".into());}
        let busy=matches!(session.status.as_str(),"starting"|"running"|"waiting");
        if action=="stop" && !busy {return Err("Thread is not running".into());}
        if action=="archive" && busy {return Err("Stop this thread before archiving it".into());}
        return if action=="stop" {host::call(root,"stop",json!({"session":thread}))}
            else {host::call(root,"thread_action",json!({"session":thread,"action":action,"project":null}))};
    }
    if route=="/v1/read" {
        // Read cursors only: no thread content, no status change. Same max-merge host ops as the desktop.
        if p["cursors"].is_object() {
            let cursors=p["cursors"].as_object().unwrap();
            if cursors.len()>5000 {return Err("Too many read cursors".into());}
            return host::call(root,"merge_read",json!({"cursors":p["cursors"]}));
        }
        let thread=text(&p,"thread")?;
        let at=p["at"].as_u64().ok_or("Missing read cursor")?;
        return host::call(root,"mark_read",json!({"thread":thread,"at":at}));
    }
    if route=="/v1/respond" {
        let thread=text(&p,"thread")?;
        if !db.sessions.iter().any(|s|s.id==thread && !s.archived && s.deleted_at.is_none()) {return Err("Thread unavailable".into());}
        let request_id=text(&p,"requestId")?;
        let allow=p["allow"].as_bool().ok_or("Missing decision")?;
        return host::call(root,"respond",json!({"session":thread,"requestId":request_id,"allow":allow,"answers":p["answers"]}));
    }
    let prompt = text(&p,"prompt")?;
    let request_id = text(&p,"requestId")?;
    if prompt.len()>64000 || request_id.len()>200 { return Err("Message is too long".into()); }
    let options = message_options(&p["options"], request_id)?;
    match route {
        "/v1/start" => {
            let project = db.projects.iter().find(|x|Some(x.id.as_str())==p["project"].as_str()).ok_or("Project not found")?;
            let account = resolve(&db,project,p["assistant"].as_str().map(str::to_owned))?;
            let provider = &db.accounts.iter().find(|a| a.id == account).ok_or("Account not found")?.provider;
            let options = new_thread_options(provider, db.preferences.use_worktree, options);
            host::call(root,"launch",json!({"project":project.id,"account":account,"prompt":prompt,"existing":null,"options":options}))
        }
        "/v1/reply" => {
            let s = db.sessions.iter().find(|s|Some(s.id.as_str())==p["thread"].as_str() && !s.archived && s.deleted_at.is_none() && s.status!="archived").ok_or("Thread unavailable")?;
            if s.pending.is_some() { return Err("This thread needs a decision on your Mac before continuing.".into()); }
            if s.provider_id.is_none() { return Err("This conversation cannot be resumed. Start a new thread.".into()); }
            // Always use the existing persistent FIFO; the host owns execution and retries.
            host::call(root,"queue_message",json!({"session":s.id,"prompt":prompt,"options":options}))
        }
        _=>Err("Unknown companion operation".into())
    }
}
#[cfg(test)]
fn authorized(value: &[u8], token: &[u8]) -> bool {
    value.len()==token.len() && bool::from(value.ct_eq(token))
}
pub fn start(root: PathBuf) -> Result<bool,String> {
    let dir = root.join("companion");
    if !dir.join("server.crt").exists() { return Ok(false); } // Disabled until explicit provisioning.
    let lock=fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(dir.join("listener.lock")).map_err(|e|e.to_string())?;
    match lock.try_lock_exclusive() {
        Ok(())=>{},
        Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>return Ok(false),
        Err(e)=>return Err(e.to_string()),
    }
    let lock=Arc::new(lock);
    // Record build identity so a newer desktop can replace this process after an app update.
    let identity=std::env::current_exe().map(|e|build_identity(&e)).map_err(|e|e.to_string())?;
    fs::write(dir.join("server.identity"),json!({"pid":std::process::id(),"identity":identity}).to_string()).map_err(|e|e.to_string())?;
    eprintln!("companion_server.started pid={} identity={identity:?}",std::process::id());
    let server=Server::https(format!("0.0.0.0:{PORT}"),SslConfig {
        certificate:fs::read(dir.join("server.crt")).map_err(|e|e.to_string())?,
        private_key:fs::read(dir.join("server.key")).map_err(|e|e.to_string())?,
    }).map_err(|e|format!("Cannot start companion connection: {e}"))?;
    let server=Arc::new(server);
    // Serialize dispatch so concurrent retries cannot race across snapshot/launch.
    let gate=Arc::new(Mutex::new(()));
    crate::companion_relay::start(root.clone(),gate.clone());
    for _ in 0..4 {
        let server=server.clone(); let root=root.clone(); let gate=gate.clone();
        let lock=lock.clone();
        std::thread::spawn(move || { let _lock=lock; loop {
            let Some(mut req)=server.recv_timeout(Duration::from_secs(5)).ok().flatten() else {continue};
            let auth=req.headers().iter().find(|h|h.field.equiv("Authorization")).map(|h|h.value.as_str()).unwrap_or("");
            let auth=auth.to_string();
            let route=req.url().to_string();
            let started=Instant::now();
            let mut reason=String::new();
            let pairing=["/v1/pair/request","/v1/pair/claim"].contains(&route.as_str());
            let (mut status,result)=if req.method()!=&Method::Post || !(pairing || ["/v1/snapshot","/v1/start","/v1/reply","/v1/respond","/v1/action","/v1/composer","/v1/read","/v1/wake"].contains(&route.as_str())) {reason="unknown route or method".into();(404,Err("Unknown companion operation".into()))}
            else if !pairing && crate::companion_pairing::device(&root,&auth).ok().flatten().is_none() {reason="auth failure: no paired device matches the bearer token".into();(401,Err("Device is not authorized. Pair this iPhone in Mac settings.".into()))}
            else {
                let mut body=Vec::new();
                let result=req.as_reader().take(LIMIT+1).read_to_end(&mut body);
                if result.is_err() || body.len() as u64>LIMIT {reason="request body unreadable or over limit".into();(413,Err("Request is too large".into()))}
                else {
                    let _lock=gate.lock().unwrap();
                    let caught=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||serde_json::from_slice(&body).map_err(|_|"Invalid request".to_string()).and_then(|p|match route.as_str() {
                        "/v1/pair/request"=>crate::companion_pairing::request(&root,&p),
                        "/v1/pair/claim"=>crate::companion_pairing::claim(&root,&p),
                        _=> { if crate::companion_pairing::device(&root,&auth)?.is_none() {return Err("Device revoked".into());} dispatch(&root,&route,p) },
                    })));
                    let mut panicked=false;
                    let result=caught.unwrap_or_else(|_|{panicked=true;reason="panic while handling request".into();Err("Companion server error. Check the Freddai log on your Mac.".into())});
                    match result {Ok(v)=>(200,Ok(v)), Err(e)=>{if reason.is_empty() {reason=e.clone();}(if panicked {500} else {400},Err(e))}}
                }
            };
            let payload=match result {Ok(v)=>json!({"result":v,"relay":crate::companion_pairing::edit(&root,|r|Ok(r.relay.clone())).ok().flatten()}),Err(e)=>json!({"error":e})};
            let text=match serde_json::to_string(&payload) {Ok(t)=>t,Err(e)=>{reason=format!("serialization failure: {e}");status=500;json!({"error":"Companion server could not encode the response."}).to_string()}};
            eprintln!("companion.server.request op={route} status={status} response_bytes={} duration_ms={} reason={reason:?}",text.len(),started.elapsed().as_millis());
            let response=Response::from_string(text).with_status_code(StatusCode(status))
                .with_header(Header::from_bytes("Content-Type","application/json").unwrap())
                .with_header(Header::from_bytes("Cache-Control","no-store").unwrap());
            let delivered=req.respond(response);
            eprintln!("companion.server.delivery op={route} scoped={} elapsed_ms={} delivered={} error={:?}",route=="/v1/snapshot" && payload["result"]["threads"].as_array().is_some_and(|threads|threads.iter().any(|t|t["messagesLoaded"]==false)),started.elapsed().as_millis(),delivered.is_ok(),delivered.err().map(|e|e.to_string()));
        }});
    }
    Ok(true)
}
/// Identity of one installed build: version plus the resolved binary path, size and mtime.
/// The desktop caches binaries under a content-hash name, so this changes on every new build.
pub fn build_identity(binary: &Path) -> String {
    let real=fs::canonicalize(binary).unwrap_or_else(|_|binary.to_path_buf());
    let meta=fs::metadata(&real).ok();
    let mtime=meta.as_ref().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0);
    format!("{}|{}|{}|{}",env!("CARGO_PKG_VERSION"),real.display(),meta.map(|m|m.len()).unwrap_or(0),mtime)
}
#[derive(Debug, PartialEq)]
enum ServerState { Current, Stale { pid: Option<u32>, old: String } }
/// Decides whether a running server (lock held) must be replaced. `recorded` is (pid, identity)
/// from server.identity; None means a server that predates identity recording.
fn server_state(recorded: Option<(u32,String)>, own: &str) -> ServerState {
    match recorded {
        Some((_,id)) if id==own => ServerState::Current,
        Some((pid,id)) => ServerState::Stale { pid: Some(pid), old: id },
        None => ServerState::Stale { pid: None, old: "unrecorded (pre-identity build)".into() },
    }
}
fn lock_held(path: &Path) -> bool {
    let Ok(f)=fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path) else {return false};
    match f.try_lock_exclusive() { Ok(())=>{let _=f.unlock();false}, Err(_)=>true }
}
fn lock_holders(path: &Path) -> Vec<u32> {
    let Ok(out)=std::process::Command::new("/usr/sbin/lsof").arg("-t").arg(path).output() else {return vec![]};
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l|l.trim().parse().ok()).filter(|p|*p!=std::process::id()).collect()
}
/// The companion server is a stateless HTTP front end over the host socket (agent work runs in the
/// separate `--host` process), so terminating it never interrupts agent turns.
fn replace_stale(dir: &Path, own: &str) {
    let lock=dir.join("listener.lock");
    if !lock_held(&lock) { return; }
    let recorded=fs::read_to_string(dir.join("server.identity")).ok().and_then(|t|serde_json::from_str::<Value>(&t).ok())
        .and_then(|v|Some((v["pid"].as_u64()? as u32,v["identity"].as_str()?.to_string())));
    let ServerState::Stale{pid,old}=server_state(recorded,own) else {return};
    let pids=match pid { Some(p)=>vec![p], None=>lock_holders(&lock) };
    if pids.is_empty() {
        eprintln!("companion_server.stale_replace_failed reason=\"lock held but holder pid not found\" old={old:?} new={own:?}");
        return;
    }
    eprintln!("companion_server.stale_replacing pids={pids:?} old={old:?} new={own:?}");
    for p in &pids { unsafe { libc::kill(*p as i32,libc::SIGTERM); } }
    let deadline=Instant::now()+Duration::from_secs(5);
    while Instant::now()<deadline {
        if !lock_held(&lock) {
            eprintln!("companion_server.stale_replaced pids={pids:?} old={old:?} new={own:?}");
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    eprintln!("companion_server.stale_replace_failed reason=\"old server still holds lock after SIGTERM and 5s\" pids={pids:?} old={old:?} new={own:?}");
}
pub fn ensure(root: PathBuf, binary: PathBuf) -> Result<(), String> {
    if !root.join("companion/server.crt").exists() { return Ok(()); }
    replace_stale(&root.join("companion"),&build_identity(&binary));
    let mut child=std::process::Command::new(binary).arg("--companion-server").arg(root)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit()).spawn().map_err(|e|e.to_string())?;
    std::thread::spawn(move || {let _=child.wait();});
    Ok(())
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test] fn server_replacement_decision() {
        assert_eq!(server_state(Some((1,"a".into())),"a"),ServerState::Current);
        assert_eq!(server_state(Some((7,"a".into())),"b"),ServerState::Stale{pid:Some(7),old:"a".into()});
        assert!(matches!(server_state(None,"b"),ServerState::Stale{pid:None,..}));
    }
    #[test] fn identity_changes_with_binary() {
        let d=std::env::temp_dir().join(format!("fr-id-{}",std::process::id()));fs::create_dir_all(&d).unwrap();
        let (a,b)=(d.join("a"),d.join("b"));fs::write(&a,"1").unwrap();fs::write(&b,"1").unwrap();
        assert_eq!(build_identity(&a),build_identity(&a));
        assert_ne!(build_identity(&a),build_identity(&b));
        fs::remove_dir_all(d).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn next_message_controls_are_scoped_and_preserve_explicit_approval() {
        let options=message_options(&json!({"model":"chosen","effort":"high","permission_mode":"ask","attachments":["file-id"],"update_agent_controls":true,"worktree":true,"scheduled":true,"request_id":"forged"}),"retry-1").unwrap();
        assert_eq!(options.model.as_deref(),Some("chosen"));
        assert_eq!(options.request_id.as_deref(),Some("phone:retry-1"));
        assert!(!options.worktree && !options.scheduled);
        assert!(options.update_agent_controls);
        assert_eq!(new_thread_options("codex",false,options).permission_mode,Some(freddai_core::runtime::PermissionMode::Ask));
        assert!(message_options(&json!({"attachments":vec!["a";21]}),"r").is_err());
    }
    #[test] fn phone_attachment_chunks_are_bounded_ordered_and_immutable() {
        let root=std::env::temp_dir().join(format!("fr-upload-{}",crate::companion_crypto::random()));
        assert!(upload(&root,&json!({"action":"begin","name":"../escape"})).is_err());
        let id=upload(&root,&json!({"action":"begin","name":"name"})).unwrap();
        let chunk=json!({"action":"chunk","id":id,"offset":0,"data":"686579"});
        upload(&root,&chunk).unwrap(); upload(&root,&chunk).unwrap();
        assert!(upload(&root,&json!({"action":"chunk","id":id,"offset":1,"data":"61"})).is_err());
        assert!(upload(&root,&json!({"action":"chunk","id":id,"offset":25*1024*1024,"data":"61"})).is_err());
        assert!(upload(&root,&json!({"action":"finish","id":id,"size":4})).is_err());
        let done=json!({"action":"finish","id":id,"size":3});
        let file=upload(&root,&done).unwrap();assert_eq!(upload(&root,&done).unwrap(),file);
        assert_eq!(file["name"],"name");
        let (_,bytes,path)=freddai_core::attachments::load(&root,file["id"].as_str().unwrap()).unwrap();
        assert_eq!(bytes,b"hey");fs::write(path,"changed").unwrap();
        assert!(freddai_core::attachments::load(&root,file["id"].as_str().unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn phone_dictation_validates_upload_before_transcribing() {
        let root=std::env::temp_dir().join(format!("fr-voice-{}",crate::companion_crypto::random()));
        assert!(voice_upload_dir(&root,&json!({})).is_err());
        assert!(voice_upload_dir(&root,&json!({"id":"../escape"})).is_err());
        assert!(voice_upload_dir(&root,&json!({"id":"ab".repeat(32)})).is_err());
        let id=upload(&root,&json!({"action":"begin","name":"dictation.m4a"})).unwrap();
        let id=id.as_str().unwrap();
        let input=json!({"id":id});
        let dir=voice_upload_dir(&root,&input).unwrap();
        assert!(voice_prepare_audio(&dir,&input).is_err()); // empty
        upload(&root,&json!({"action":"chunk","id":id,"offset":0,"data":"686579"})).unwrap();
        assert!(voice_prepare_audio(&dir,&json!({"id":id,"size":4})).is_err()); // size mismatch
        let audio=voice_prepare_audio(&dir,&json!({"id":id,"size":3})).unwrap();
        assert_eq!(audio.file_name().unwrap(),"audio.m4a");
        assert_eq!(fs::read(&audio).unwrap(),b"hey");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn device_auth_rejects_missing_and_wrong_credentials() {
        assert!(!authorized(b"",b"Bearer secret"));
        assert!(!authorized(b"Bearer wrong!",b"Bearer secret"));
        assert!(authorized(b"Bearer secret",b"Bearer secret"));
    }
    #[test] fn assistant_projection_exposes_only_display_metadata() {
        let mut db=Database::default();
        db.accounts.push(serde_json::from_value(json!({"id":"synthetic","name":"Test assistant","provider":"codex","color":"#aaa","config_home":"/private/test-credentials"})).unwrap());
        db.projects.push(serde_json::from_value(json!({"id":"p","name":"Project","path":std::env::temp_dir(),"color":"#aaa","policy":"inherit","account":null,"last":null})).unwrap());
        let v=project_snapshot(&db);
        assert_eq!(v["projects"][0]["assistants"],json!([{"id":"synthetic","name":"Test assistant","provider":"codex"}]));
        assert_eq!(v["projects"][0]["canStart"],true);
        assert!(resolve(&db,&db.projects[0],Some("synthetic".into())).is_ok());
        assert!(resolve(&db,&db.projects[0],Some("removed".into())).is_err());
        assert!(!v.to_string().contains("test-credentials"));
    }
    #[test] fn projection_excludes_configuration_and_archived_work() {
        let db=Database::default();
        let v=project_snapshot(&db);
        assert_eq!(v,json!({"projects":[],"threads":[],"schedules":[]}));
        assert!(v.get("accounts").is_none()); assert!(v.get("preferences").is_none());
        let session=json!({"id":"s1","project":"p1","account":"missing","title":"Synthetic thread","status":"waiting","updated":1,"last_user_message_at":7,"provider_id":null,"messages":[],"pending":{"id":7,"method":"item/tool/requestUserInput"},"error":null});
        let mut archived=session.clone(); archived["id"]=json!("archived"); archived["archived"]=json!(true);
        let mut deleted=session.clone(); deleted["id"]=json!("deleted"); deleted["deleted_at"]=json!(1);
        let db:Database=serde_json::from_value(json!({
            "accounts":[],"preferences":{"prefer_last":false,"fallback":null,"last":null},
            "projects":[{"id":"p1","name":"Synthetic project","path":"/private/not-a-real-project","color":"#aaa","policy":"inherit","account":null,"last":null}],
            "sessions":[session,archived,deleted]
        })).unwrap();
        let v=project_snapshot(&db);
        assert_eq!(v["threads"].as_array().unwrap().len(),1);
        assert_eq!(v["threads"][0]["canReply"],false);
        assert_eq!(v["threads"][0]["pending"]["id"],7);
        assert_eq!(v["threads"][0]["last_user_message_at"],7);
        assert_eq!(v["projects"][0]["canStart"],false);
        assert!(v["projects"][0].get("path").is_none());
        assert!(v["threads"][0].get("account").is_none());
        assert!(v["threads"][0].get("provider_id").is_none());
    }
}

#[cfg(test)] mod snapshot_scale_tests {
    use super::*;
    #[test] fn unopened_threads_carry_only_list_metadata_but_opened_threads_keep_every_detail() {
        let mut db=Database::default();
        db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"none","title":"Waiting task","status":"running","updated":9,"read_at":4,"last_user_message_at":7,"provider_id":null,
            "messages":[{"id":"m","role":"assistant","text":"TRANSCRIPT_DETAIL"}],
            "pending":{"id":3,"params":{"command":"APPROVAL_DETAIL"}},"error":"ERROR_DETAIL",
            "options":{"model":"MODEL_DETAIL"},"usage":{"context_tokens":42,"context_window":100}})).unwrap());
        db.queues.push(serde_json::from_value(json!({"session":"thread","paused":true,"error":"QUEUE_ERROR_DETAIL","messages":[{"id":"q","prompt":"QUEUE_PROMPT_DETAIL","options":{}}]})).unwrap());
        let overview=project_snapshot_selection(&db,None,true);
        let row=&overview["threads"][0];
        assert_eq!(row["title"],"Waiting task");
        assert_eq!(row["pending"],json!({}),"only an attention marker belongs in the title index");
        assert_eq!(row["queued"],1);
        assert_eq!(row["read_at"],4);
        assert_eq!(row["last_user_message_at"],7);
        assert_eq!(row["messagesLoaded"],false);
        assert_eq!(row["canReply"],false);
        for field in ["usage","options","queue","queueError","tasks"] { assert!(row.get(field).is_none(),"{field} belongs to the opened conversation"); }
        assert!(!overview.to_string().contains("_DETAIL"));
        let full=project_snapshot_selection(&db,Some("thread"),true);
        let full=&full["threads"][0];
        assert_eq!(full["messages"],json!(db.sessions[0].messages));
        assert_eq!(full["pending"],json!(db.sessions[0].pending));
        assert_eq!(full["usage"]["context_tokens"],42);
        assert_eq!(full["options"]["model"],"MODEL_DETAIL");
        assert_eq!(full["queue"][0]["prompt"],"QUEUE_PROMPT_DETAIL");
        assert_eq!(full["queueError"],"QUEUE_ERROR_DETAIL");
        assert_eq!(full["messagesLoaded"],true);
    }
    #[test] fn home_snapshot_does_not_download_every_conversation() {
        let mut db=Database::default();
        for n in 0..124 {
            db.sessions.push(serde_json::from_value(json!({"id":format!("thread-{n}"),"project":"p","account":"none","title":"Synthetic thread","status":"done","updated":1,"provider_id":null,"messages":[{"id":"m","role":"assistant","text":"synthetic history ".repeat(20_000)}],"pending":null,"error":null})).unwrap());
        }
        let result=project_snapshot_selection(&db,None,true);
        let bytes=serde_json::to_vec(&result).unwrap().len();
        assert!(bytes<256*1024,"Home loaded all transcripts: {bytes} bytes");
        assert_eq!(result["threads"].as_array().unwrap().len(),124);
        assert_eq!(result["threads"][0]["messagesLoaded"],false);
        let selected=project_snapshot_selection(&db,Some("thread-73"),true);
        assert!(serde_json::to_vec(&selected).unwrap().len()<1024*1024);
        assert_eq!(selected["threads"][73]["messages"],json!(db.sessions[73].messages));
        assert_eq!(selected["threads"][73]["messagesLoaded"],true);
        assert_eq!(selected["threads"][0]["messages"],json!([]));
        // Older clients continue to receive every transcript, with no silent history loss.
        assert_eq!(project_snapshot(&db)["threads"][0]["messages"],json!(db.sessions[0].messages));
        eprintln!("Scoped home snapshot: {bytes} bytes for 124 threads");
    }
}

#[cfg(test)]
mod summary_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};

    #[test]
    fn mobile_summary_commands_pass_the_guard_and_reach_the_host() {
        let root = std::env::temp_dir().join(format!("fr-sum-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let cached = json!({"date":"2026-11-04","summary":{"date":"2026-11-04","markdown":"Cached summary","generated_at":1,"provider":"","account":"","model":"","threads":2},"running":false,"threads":2,"error":null});
        let expected = cached.clone();
        let host = std::thread::spawn(move || {
            for operation in ["day_summary", "summarize_day"] {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], operation);
                assert_eq!(request["params"]["date"], "2026-11-04");
                if operation == "summarize_day" { assert_eq!(request["params"]["force"], false); }
                writeln!(connection, "{}", json!({"result":cached})).unwrap();
            }
        });
        for operation in ["day_summary", "summarize_day"] {
            crate::companion_operations::validate(operation).unwrap();
            let result = dispatch(&root, "/v1/composer", json!({"operation":operation,"input":{"date":"2026-11-04","force":false}})).unwrap();
            assert_eq!(result, expected);
        }
        host.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod schedule_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};
    #[test]
    fn schedule_commands_reach_host_without_arbitrary_rpc_access() {
        let root = std::env::temp_dir().join(format!("fr-sched-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let host = std::thread::spawn(move || {
            for operation in ["save_schedule", "schedule_action"] {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], operation);
                assert_eq!(request["params"]["schedule"], "schedule-id");
                writeln!(connection, "{}", json!({"result":null})).unwrap();
            }
        });
        for operation in ["save_schedule", "schedule_action"] {
            crate::companion_operations::validate(operation).unwrap();
            dispatch(&root, "/v1/composer", json!({"operation":operation,"input":{"schedule":"schedule-id","action":"delete"}})).unwrap();
        }
        assert!(crate::companion_operations::validate("shell").is_err());
        host.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod thread_list_settings_tests {
    use super::*;

    #[test]
    fn unread_experiment_is_backward_compatible_and_crosses_snapshot_boundary() {
        let legacy = json!({"projectOrder":[],"grouped":true,"hideRead":true,"recentFinished":5});
        let settings: ThreadListSettings = serde_json::from_value(legacy.clone()).unwrap();
        assert!(!settings.ignore_unread);
        let mut enabled = legacy;
        enabled["ignoreUnread"] = json!(true);
        let settings: ThreadListSettings = serde_json::from_value(enabled).unwrap();
        assert!(settings.ignore_unread);
        assert_eq!(serde_json::to_value(settings).unwrap()["ignoreUnread"], true);
    }
}
